import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "./compiler.js";
import { formatDiagnostics } from "./errors/reporter.js";
import { createRuntime } from "./codegen/runtime.js";

const program = new Command()
  .name("clarityc")
  .description("Clarity language compiler — optimized for LLM code generation, compiles to WASM")
  .version("0.2.1");

program
  .command("compile <file>")
  .description("Compile a .clarity file to WASM")
  .option("-o, --output <file>", "Output .wasm file")
  .option("--emit-ast", "Print the AST as JSON")
  .option("--emit-tokens", "Print the token stream")
  .option("--emit-wat", "Print WASM text format instead of binary")
  .option("--check-only", "Type-check without generating WASM")
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const source = await readFile(file, "utf-8");
      const result = compile(source, file, {
        emitAst: !!opts.emitAst,
        emitTokens: !!opts.emitTokens,
        emitWat: !!opts.emitWat,
        checkOnly: !!opts.checkOnly,
      });

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
  .command("run <file>")
  .description("Compile and run a .clarity file")
  .option("-f, --function <name>", "Function to call", "main")
  .option("-a, --args <args...>", "Arguments to pass to the function")
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const source = await readFile(file, "utf-8");
      const result = compile(source, file);

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
      const { instance } = await WebAssembly.instantiate(result.wasm, runtime.imports);

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

      const resultValue = fn(...args);

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

program
  .command("test <file>")
  .description("Compile and run tests in a .clarity file (self-healing test runner)")
  .option("--json", "Output results as JSON for machine consumption")
  .option("--fail-fast", "Stop after the first failing test function")
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const source = await readFile(file, "utf-8");
      const result = compile(source, file);

      if (result.errors.length > 0) {
        if (opts.json) {
          console.log(JSON.stringify({
            file,
            compile_error: true,
            errors: result.errors.map(e => ({
              message: e.message,
              line: e.span.start.line,
              column: e.span.start.column,
              hint: e.hint ?? null,
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
      const { instance } = await WebAssembly.instantiate(result.wasm, runtime.imports);

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
      for (const decl of result.ast.declarations) {
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

program.parse();
