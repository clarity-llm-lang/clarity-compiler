#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compile, compileFile } from "./compiler.js";
import { formatDiagnostics } from "./errors/reporter.js";
import { createRuntime } from "./codegen/runtime.js";
import { CLARITY_BUILTINS, EFFECT_DEFINITIONS } from "./registry/builtins-registry.js";
import { typeToString } from "./checker/types.js";

async function resolveDefaultFile(file: string | undefined): Promise<string> {
  if (file) return file;
  const entries = await readdir(process.cwd());
  const found = entries.filter(f => f.endsWith(".clarity"));
  if (found.length === 0) {
    throw new Error("No .clarity file found in the current directory. Pass a file path explicitly.");
  }
  if (found.length > 1) {
    throw new Error(`Multiple .clarity files found: ${found.join(", ")}. Pass a file path explicitly.`);
  }
  return path.join(process.cwd(), found[0]);
}

const program = new Command()
  .name("clarityc")
  .description("Clarity language compiler — optimized for LLM code generation, compiles to WASM")
  .version("0.9.0");

const DEFAULT_DAEMON_URL = process.env.CLARITYD_URL ?? "http://localhost:4707";

async function emitAgentEvent(
  daemonUrl: string,
  authToken: string | undefined,
  event: {
    kind: string;
    message: string;
    runId: string;
    stepId?: string;
    agent?: string;
    level?: "info" | "warn" | "error";
    data?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (authToken) {
      headers["x-clarity-token"] = authToken;
    }
    const payload: Record<string, unknown> = {
      kind: event.kind,
      message: event.message,
      runId: event.runId,
      level: event.level ?? "info",
      data: {
        ...(event.data ?? {}),
        runId: event.runId,
        ...(event.stepId ? { stepId: event.stepId } : {}),
        ...(event.agent ? { agent: event.agent } : {})
      }
    };
    if (event.stepId) {
      payload.stepId = event.stepId;
    }
    if (event.agent) {
      payload.agent = event.agent;
    }
    await fetch(`${daemonUrl.replace(/\/+$/, "")}/api/agents/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch {
    // Telemetry emission is best-effort and must not break compile/start flows.
  }
}

program
  .command("compile [file]")
  .description("Compile a .clarity file to WASM (defaults to the single .clarity file in the current directory)")
  .option("-o, --output <file>", "Output .wasm file")
  .option("--emit-ast", "Print the AST as JSON")
  .option("--emit-tokens", "Print the token stream")
  .option("--emit-wat", "Print WASM text format instead of binary")
  .option("--check-only", "Type-check without generating WASM")
  .action(async (file: string | undefined, opts: Record<string, unknown>) => {
    try {
      file = await resolveDefaultFile(file);
      const options = {
        emitAst: !!opts.emitAst,
        emitTokens: !!opts.emitTokens,
        emitWat: !!opts.emitWat,
        checkOnly: !!opts.checkOnly,
      };

      // Use compileFile for file-based compilation (supports imports)
      const source = await readFile(file, "utf-8");
      const result = opts.emitTokens
        ? compile(source, file, options)
        : compileFile(file, options);

      if (result.errors.length > 0) {
        console.error(formatDiagnostics(source, result.errors));
        process.exit(1);
      }

      if (opts.emitTokens && result.tokens) {
        for (const tok of result.tokens) {
          console.log(`${tok.kind}\t${JSON.stringify(tok.value)}\t${tok.span.start.line}:${tok.span.start.column}`);
        }
        return;
      }

      if (opts.emitAst && result.ast) {
        console.log(JSON.stringify(result.ast, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
          2,
        ));
        return;
      }

      if (opts.emitWat && result.wat) {
        console.log(result.wat);
        return;
      }

      if (result.wasm) {
        const outputFile = (opts.output as string) ?? file.replace(/\.clarity$/, ".wasm");
        await writeFile(outputFile, result.wasm);
        console.log(`Compiled ${file} -> ${outputFile} (${result.wasm.length} bytes)`);
      }
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command("run [file]")
  .description("Compile and run a .clarity file (defaults to the single .clarity file in the current directory)")
  .option("-f, --function <name>", "Function to call", "main")
  .option("-a, --args <args...>", "Arguments to pass to the function")
  .action(async (file: string | undefined, opts: Record<string, unknown>) => {
    try {
      file = await resolveDefaultFile(file);
      const source = await readFile(file, "utf-8");
      const result = compileFile(file);

      if (result.errors.length > 0) {
        console.error(formatDiagnostics(source, result.errors));
        process.exit(1);
      }

      if (!result.wasm) {
        console.error("No WASM output produced");
        process.exit(1);
      }

      // Create runtime with host functions for strings, print, logging
      // Pass CLI args through so Clarity programs can access them via get_args()
      const cliArgs = (opts.args as string[]) ?? [];
      const runtime = createRuntime({ argv: cliArgs });
      const { instance } = await WebAssembly.instantiate(result.wasm! as BufferSource, runtime.imports);

      // Bind to the WASM module's exported memory
      const exportedMemory = instance.exports.memory as WebAssembly.Memory;
      if (exportedMemory) {
        runtime.bindMemory(exportedMemory);
      }

      // Set heap pointer past the static data segments
      const heapBase = instance.exports.__heap_base;
      if (heapBase && typeof (heapBase as WebAssembly.Global).value === "number") {
        runtime.setHeapBase((heapBase as WebAssembly.Global).value);
      }

      const fnName = opts.function as string;
      const fn = instance.exports[fnName];

      if (typeof fn !== "function") {
        const available = Object.keys(instance.exports).filter(k => typeof instance.exports[k] === "function");
        console.error(`Function '${fnName}' not found in exports. Available: ${available.join(", ")}`);
        process.exit(1);
      }

      // Parse arguments: "str" for strings, 1.5 for floats, 42 for ints
      const args = ((opts.args as string[]) ?? []).map((a) => {
        if (a.startsWith('"') && a.endsWith('"')) {
          // String argument — write to WASM memory, pass pointer
          return runtime.writeString(a.slice(1, -1));
        }
        if (a.includes(".")) return parseFloat(a);
        return BigInt(a);
      });

      const resultValue = (fn as Function)(...args);

      // Don't print undefined/void results (Unit return type)
      if (resultValue === undefined) return;

      // If result is an i32, it might be a string pointer — try to read it
      if (typeof resultValue === "number" && resultValue > 0 && resultValue < runtime.memory.buffer.byteLength) {
        try {
          const str = runtime.readString(resultValue);
          if (str.length > 0 && str.length < 10000) {
            console.log(str);
            return;
          }
        } catch {
          // Not a valid string pointer, print as number
        }
      }
      console.log(resultValue);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

// clarity.json schema loaded by `clarityc start`
interface ClarityProjectMeta {
  name?: string;
  version?: string;
  entry?: string;
  module?: string;
  service_type?: string;
  agent?: {
    id?: string;
    name?: string;
    role?: string;
    objective?: string;
    inputs?: string[];
    outputs?: string[];
    mcp_tools?: string[];
    llm_providers?: string[];
    handoff_targets?: string[];
    depends_on?: string[];
    version?: string;
  };
}

async function loadProjectMeta(sourceFile: string): Promise<ClarityProjectMeta> {
  const dir = path.dirname(path.resolve(sourceFile));
  const metaPath = path.join(dir, "clarity.json");
  try {
    const raw = await readFile(metaPath, "utf-8");
    return JSON.parse(raw) as ClarityProjectMeta;
  } catch {
    return {};
  }
}

program
  .command("start [file]")
  .description(
    "Register and start a .clarity service in Clarity Runtime.\n" +
    "Project metadata (service type, agent config, entry point, etc.) is read from clarity.json\n" +
    "in the same directory as the source file."
  )
  .option("-o, --output <file>", "Compiled .wasm output path")
  .option("--daemon-url <url>", "Clarity Runtime daemon URL (default: CLARITYD_URL or http://localhost:4707)")
  .option("--auth-token <token>", "Runtime auth token (default: CLARITYD_AUTH_TOKEN env var)")
  .action(async (file: string | undefined, opts: Record<string, unknown>) => {
    const daemonUrl = (opts.daemonUrl as string | undefined) ?? DEFAULT_DAEMON_URL;
    const authToken = (opts.authToken as string | undefined) ?? process.env.CLARITYD_AUTH_TOKEN ?? process.env.CLARITY_API_TOKEN;
    const runId = `run_${randomUUID()}`;
    const agentTelemetry = "clarityc";
    const stepId = "clarityctl_add";
    let sourceFile: string;
    try {
      file = await resolveDefaultFile(file);
      sourceFile = path.resolve(file);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
      return;
    }
    try {
      const meta = await loadProjectMeta(sourceFile);
      const serviceType = String(meta.service_type ?? "mcp").trim().toLowerCase();
      if (serviceType !== "mcp" && serviceType !== "agent") {
        throw new Error(`clarity.json: service_type must be 'mcp' or 'agent', got '${serviceType}'`);
      }
      if (serviceType === "agent") {
        if (!meta.agent?.role?.trim()) {
          throw new Error("clarity.json: agent.role is required when service_type is 'agent'");
        }
        if (!meta.agent?.objective?.trim()) {
          throw new Error("clarity.json: agent.objective is required when service_type is 'agent'");
        }
      }

      await emitAgentEvent(daemonUrl, authToken, {
        kind: "agent.run_created",
        message: `clarityc start created run for ${sourceFile}`,
        runId,
        agent: agentTelemetry,
        data: { command: "clarityc start", sourceFile }
      });
      await emitAgentEvent(daemonUrl, authToken, {
        kind: "agent.step_started",
        message: "Delegating to clarityctl add",
        runId,
        stepId,
        agent: agentTelemetry,
        data: { command: "clarityctl add", sourceFile }
      });

      const clarityctlBin = process.env.CLARITYCTL_BIN ?? "clarityctl";
      const compilerBin = process.env.CLARITYC_BIN ?? "clarityc";

      const args: string[] = ["--daemon-url", daemonUrl];
      if (authToken) args.push("--auth-token", authToken);
      args.push("add", sourceFile);
      if (meta.module) args.push("--module", meta.module);
      if (opts.output) args.push("--wasm", path.resolve(String(opts.output)));
      if (meta.entry) args.push("--entry", meta.entry);
      if (meta.name) args.push("--name", meta.name);
      args.push("--service-type", serviceType);
      if (meta.agent?.id) args.push("--agent-id", meta.agent.id);
      if (meta.agent?.name) args.push("--agent-name", meta.agent.name);
      if (meta.agent?.role) args.push("--agent-role", meta.agent.role);
      if (meta.agent?.objective) args.push("--agent-objective", meta.agent.objective);
      if (meta.agent?.inputs?.length) args.push("--agent-inputs", meta.agent.inputs.join(","));
      if (meta.agent?.outputs?.length) args.push("--agent-outputs", meta.agent.outputs.join(","));
      if (meta.agent?.mcp_tools?.length) args.push("--agent-mcp-tools", meta.agent.mcp_tools.join(","));
      if (meta.agent?.llm_providers?.length) args.push("--agent-llm-providers", meta.agent.llm_providers.join(","));
      if (meta.agent?.handoff_targets?.length) args.push("--agent-handoff-targets", meta.agent.handoff_targets.join(","));
      if (meta.agent?.depends_on?.length) args.push("--agent-depends-on", meta.agent.depends_on.join(","));
      if (meta.agent?.version) args.push("--agent-version", meta.agent.version);
      args.push("--compiler-bin", compilerBin);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(clarityctlBin, args, {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer | string) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk: Buffer | string) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(stderr.trim() || `clarityctl exited with code ${code ?? "unknown"}`));
            return;
          }
          if (stdout.trim().length > 0) process.stdout.write(`${stdout.trim()}\n`);
          resolve();
        });
      });

      await emitAgentEvent(daemonUrl, authToken, {
        kind: "agent.run_completed",
        message: `clarityc start completed for ${sourceFile}`,
        runId,
        agent: agentTelemetry,
        data: { command: "clarityc start", sourceFile }
      });
    } catch (e) {
      await emitAgentEvent(daemonUrl, authToken, {
        kind: "agent.run_failed",
        message: `clarityc start failed for ${sourceFile}`,
        runId,
        agent: agentTelemetry,
        level: "error",
        data: { command: "clarityc start", sourceFile, error: e instanceof Error ? e.message : String(e) }
      });
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command("test <file>")
  .description("Compile and run tests in a .clarity file (self-healing test runner)")
  .option("--json", "Output results as JSON for machine consumption")
  .option("--fail-fast", "Stop after the first failing test function")
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const source = await readFile(file, "utf-8");
      const result = compileFile(file);

      if (result.errors.length > 0) {
        if (opts.json) {
          console.log(JSON.stringify({
            file,
            compile_error: true,
            errors: result.errors.map(e => ({
              message: e.message,
              line: e.span.start.line,
              column: e.span.start.column,
              hint: e.help ?? null,
            })),
          }, null, 2));
        } else {
          console.error(formatDiagnostics(source, result.errors));
        }
        process.exit(1);
      }

      if (!result.wasm || !result.ast) {
        console.error("No WASM output produced");
        process.exit(1);
      }

      // Create runtime and instantiate
      const runtime = createRuntime();
      const { instance } = await WebAssembly.instantiate(result.wasm! as BufferSource, runtime.imports);

      const exportedMemory = instance.exports.memory as WebAssembly.Memory;
      if (exportedMemory) {
        runtime.bindMemory(exportedMemory);
      }
      const heapBase = instance.exports.__heap_base;
      if (heapBase && typeof (heapBase as WebAssembly.Global).value === "number") {
        runtime.setHeapBase((heapBase as WebAssembly.Global).value);
      }

      // Discover test functions: must have test_ prefix, effect[Test], and zero params
      const testFunctions: { name: string; line: number }[] = [];
      for (const decl of result.ast!.declarations) {
        if (
          decl.kind === "FunctionDecl" &&
          decl.name.startsWith("test_") &&
          decl.effects.includes("Test") &&
          decl.params.length === 0 &&
          typeof instance.exports[decl.name] === "function"
        ) {
          testFunctions.push({ name: decl.name, line: decl.span.start.line });
        }
      }

      if (testFunctions.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ file, total: 0, passed: 0, failed: 0, results: [] }, null, 2));
        } else {
          console.log("No test functions found.");
          console.log('Test functions must start with "test_" and declare effect[Test].');
        }
        process.exit(0);
      }

      // Run each test, accumulate results
      let passed = 0;
      let failed = 0;
      const allResults: unknown[] = [];

      for (const testFn of testFunctions) {
        runtime.resetTestState();
        runtime.setCurrentTest(testFn.name);

        let runtimeError: string | null = null;
        try {
          const fn = instance.exports[testFn.name] as Function;
          fn();
        } catch (e) {
          runtimeError = e instanceof Error ? e.message : String(e);
        }

        const results = runtime.getTestResults();

        if (runtimeError) {
          failed++;
          const entry = {
            name: testFn.name,
            status: "FAIL",
            runtime_error: runtimeError,
            assertions: results.total,
            location: `${file}:${testFn.line}`,
          };
          allResults.push(entry);
          if (!opts.json) {
            console.log(`[FAIL] ${testFn.name}`);
            console.log(`  runtime_error: ${runtimeError}`);
            console.log(`  location: ${file}:${testFn.line}`);
            console.log(`  fix_hint: "Function ${testFn.name} threw a runtime error: ${runtimeError}. Check for division by zero, out-of-bounds access, or infinite recursion."`);
          }
          if (opts.failFast) break;
        } else if (results.failures.length > 0) {
          failed++;
          const entry = {
            name: testFn.name,
            status: "FAIL",
            assertions: results.total,
            location: `${file}:${testFn.line}`,
            failures: results.failures,
          };
          allResults.push(entry);
          if (!opts.json) {
            console.log(`[FAIL] ${testFn.name}`);
            for (const f of results.failures) {
              console.log(`  assertion_failed: ${f.kind}`);
              console.log(`  actual: ${f.actual}`);
              console.log(`  expected: ${f.expected}`);
              console.log(`  location: ${file}:${testFn.line}`);
              console.log(`  function: ${testFn.name}`);
              console.log(`  fix_hint: "${generateFixHint(f)}"`);
            }
          }
          if (opts.failFast) break;
        } else {
          passed++;
          allResults.push({
            name: testFn.name,
            status: "PASS",
            assertions: results.total,
          });
          if (!opts.json) {
            console.log(`[PASS] ${testFn.name} (${results.total} assertions)`);
          }
        }
      }

      // Summary
      if (opts.json) {
        console.log(JSON.stringify({ file, total: testFunctions.length, passed, failed, results: allResults }, null, 2));
      } else {
        console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
      }

      process.exit(failed > 0 ? 1 : 0);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

function generateFixHint(failure: { kind: string; actual: string; expected: string }): string {
  switch (failure.kind) {
    case "assert_eq":
      return `Expected Int64 value ${failure.expected} but got ${failure.actual}. Check arithmetic logic and edge cases.`;
    case "assert_eq_float":
      return `Expected Float64 value ${failure.expected} but got ${failure.actual}. Check for precision issues or incorrect formulas.`;
    case "assert_eq_string":
      return `Expected string ${failure.expected} but got ${failure.actual}. Check string construction or concatenation logic.`;
    case "assert_true":
      return `Expected condition to be True but it was False. Check comparison operators and logical conditions.`;
    case "assert_false":
      return `Expected condition to be False but it was True. Check comparison operators and logical conditions.`;
    default:
      return `Assertion failed. Review the test logic.`;
  }
}

program
  .command("repl")
  .description("Start an interactive Clarity REPL")
  .action(async () => {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Accumulated declarations for the REPL session
    const declarations: string[] = [];
    let evalCounter = 0;

    console.log("Clarity REPL v0.9.0 — Type expressions or declarations. Ctrl+D to exit.");

    const prompt = () => new Promise<string | null>((resolve) => {
      rl.question("clarity> ", (answer) => resolve(answer));
      rl.once("close", () => resolve(null));
    });

    while (true) {
      const line = await prompt();
      if (line === null) { console.log("\nBye!"); break; }
      const input = line.trim();
      if (!input) continue;

      // Determine if input is a declaration or an expression
      const isDecl = /^(export\s+)?(function|type|effect\[)/.test(input);

      if (isDecl) {
        declarations.push(input);
        const moduleSource = `module REPL\n${declarations.join("\n")}\n`;
        const checkResult = compile(moduleSource, "<repl>", { checkOnly: true });
        if (checkResult.errors.length > 0) {
          declarations.pop();
          for (const err of checkResult.errors) {
            console.error(`error: ${err.message}`);
          }
        } else {
          console.log("(defined)");
        }
      } else {
        // Treat as expression — wrap in a temporary eval function
        const evalFnName = `__repl_eval_${evalCounter++}`;

        // Try common return types until one compiles
        let compiled = false;
        for (const retType of ["Int64", "Float64", "String", "Bool", "Timestamp", "Bytes", "Unit"]) {
          const trySource = `module REPL\n${declarations.join("\n")}\nfunction ${evalFnName}() -> ${retType} {\n  ${input}\n}\n`;
          const tryResult = compile(trySource, "<repl>");
          if (tryResult.errors.length === 0 && tryResult.wasm) {
            await runReplEval(tryResult.wasm, evalFnName);
            compiled = true;
            break;
          }
        }

        if (!compiled) {
          const errSource = `module REPL\n${declarations.join("\n")}\nfunction ${evalFnName}() -> Int64 {\n  ${input}\n}\n`;
          const errResult = compile(errSource, "<repl>");
          for (const err of errResult.errors) {
            console.error(`error: ${err.message}`);
          }
        }
      }
    }

    rl.close();
    process.exit(0);

    async function runReplEval(wasm: Uint8Array, fnName: string) {
      try {
        const runtime = createRuntime();
        const { instance } = await WebAssembly.instantiate(wasm as BufferSource, runtime.imports);
        const exportedMemory = instance.exports.memory as WebAssembly.Memory;
        if (exportedMemory) runtime.bindMemory(exportedMemory);
        const heapBase = instance.exports.__heap_base;
        if (heapBase && typeof (heapBase as WebAssembly.Global).value === "number") {
          runtime.setHeapBase((heapBase as WebAssembly.Global).value);
        }
        const fn = instance.exports[fnName] as Function;
        if (!fn) { console.error("(eval function not found)"); return; }
        const result = fn();
        if (result === undefined) return; // Unit
        if (typeof result === "number" && result > 0 && result < runtime.memory.buffer.byteLength) {
          try {
            const str = runtime.readString(result);
            if (str.length > 0 && str.length < 10000) {
              console.log(`"${str}"`);
              return;
            }
          } catch { /* not a string pointer */ }
        }
        if (typeof result === "bigint") {
          console.log(result.toString());
        } else {
          console.log(result);
        }
      } catch (e) {
        console.error(`runtime error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });

program
  .command("pack [file]")
  .description(
    "Compile a .clarity file and bundle it as a standalone Node.js launcher script.\n" +
    "Produces a single self-contained .js file (WASM embedded as base64) that can be\n" +
    "run directly or shipped as an npm package bin entry.\n\n" +
    "The launcher requires clarity-lang to be installed in node_modules at runtime.\n" +
    "Add it to your package.json dependencies: npm install clarity-lang"
  )
  .option("-o, --output <file>", "Output launcher .js file (default: <input>.js)")
  .option("-f, --function <name>", "Entry function to call", "main")
  .action(async (file: string | undefined, opts: Record<string, unknown>) => {
    try {
      file = await resolveDefaultFile(file);
      const result = compileFile(file);

      if (result.errors.length > 0) {
        const source = await readFile(file, "utf-8");
        console.error(formatDiagnostics(source, result.errors));
        process.exit(1);
      }
      if (!result.wasm) {
        console.error("No WASM output produced");
        process.exit(1);
      }

      const entryFn = opts.function as string;
      const wasmB64 = Buffer.from(result.wasm).toString("base64");
      const outFile = (opts.output as string) ?? file.replace(/\.clarity$/, ".js");

      const launcher = `#!/usr/bin/env node
// Clarity native application launcher — generated by clarityc pack
// Entry function: ${entryFn}
// Source: ${path.basename(file)}
"use strict";

const wasmB64 = "${wasmB64}";

async function run() {
  // Locate the clarity-lang runtime.  Checked in order:
  //   1. node_modules in the script's own directory
  //   2. node_modules in the current working directory
  //   3. require.resolve (handles global installs / workspaces)
  const nodePath = require("path");
  const fs   = require("fs");
  const candidates = [
    nodePath.join(nodePath.dirname(process.argv[1]), "node_modules", "clarity-lang", "dist", "codegen", "runtime.js"),
    nodePath.join(process.cwd(), "node_modules", "clarity-lang", "dist", "codegen", "runtime.js"),
  ];
  let runtimePath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { runtimePath = c; break; }
  }
  if (!runtimePath) {
    try { runtimePath = require.resolve("clarity-lang/dist/codegen/runtime.js"); } catch {}
  }
  if (!runtimePath) {
    process.stderr.write(
      "clarity-lang runtime not found.\\n" +
      "Install it with: npm install clarity-lang\\n"
    );
    process.exit(1);
  }

  const { createRuntime } = await import("file://" + runtimePath);
  const wasmBytes = Buffer.from(wasmB64, "base64");
  const rt = createRuntime({ argv: process.argv.slice(2) });
  const { instance } = await WebAssembly.instantiate(wasmBytes, rt.imports);
  const mem = instance.exports.memory;
  if (mem) rt.bindMemory(mem);
  const heap = instance.exports.__heap_base;
  if (heap && typeof heap.value === "number") rt.setHeapBase(heap.value);

  const fn = instance.exports["${entryFn}"];
  if (typeof fn !== "function") {
    const available = Object.keys(instance.exports).filter(k => typeof instance.exports[k] === "function");
    process.stderr.write(
      "Entry function '${entryFn}' not found.\\n" +
      "Available exports: " + available.join(", ") + "\\n"
    );
    process.exit(1);
  }
  fn();
}

run().catch(e => {
  process.stderr.write((e instanceof Error ? e.message : String(e)) + "\\n");
  process.exit(1);
});
`;

      await writeFile(outFile, launcher, { mode: 0o755 });
      console.log(
        `Packed ${file} -> ${outFile}  ` +
        `(${result.wasm.length} bytes WASM, ${Buffer.byteLength(launcher)} bytes launcher, entry: ${entryFn})`
      );
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command("introspect")
  .description("Output language capabilities as JSON (for LLM consumption)")
  .option("--builtins", "Show only built-in functions")
  .option("--effects", "Show only effects")
  .option("--types", "Show only built-in types")
  .action((opts: Record<string, unknown>) => {
    const builtins = CLARITY_BUILTINS.map((b) => ({
      name: b.name,
      params: b.params.map(typeToString),
      returnType: typeToString(b.returnType),
      effects: b.effects.length > 0 ? b.effects : undefined,
      doc: b.doc,
      category: b.category,
    }));

    const effects = EFFECT_DEFINITIONS.map((e) => ({
      name: e.name,
      description: e.description,
      functions: CLARITY_BUILTINS.filter((b) => b.effects.includes(e.name)).map((b) => b.name),
    }));

    const types = [
      "Int64", "Float64", "String", "Bool", "Bytes", "Timestamp", "Unit",
      "List<T>", "Option<T>",
    ];

    if (opts.builtins) {
      console.log(JSON.stringify({ builtins }, null, 2));
    } else if (opts.effects) {
      console.log(JSON.stringify({ effects }, null, 2));
    } else if (opts.types) {
      console.log(JSON.stringify({ types }, null, 2));
    } else {
      console.log(JSON.stringify({ version: "0.9.0", builtins, effects, types }, null, 2));
    }
  });

program.parse();
