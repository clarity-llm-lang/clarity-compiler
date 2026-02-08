import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "./compiler.js";
import { formatDiagnostics } from "./errors/reporter.js";

const program = new Command()
  .name("clarityc")
  .description("Clarity language compiler — optimized for LLM code generation, compiles to WASM")
  .version("0.1.0");

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

      const { instance } = await WebAssembly.instantiate(result.wasm);
      const fnName = opts.function as string;
      const fn = instance.exports[fnName];

      if (typeof fn !== "function") {
        console.error(`Function '${fnName}' not found in exports. Available: ${Object.keys(instance.exports).join(", ")}`);
        process.exit(1);
      }

      // Parse arguments as bigints for Int64, numbers for Float64
      const args = ((opts.args as string[]) ?? []).map((a) => {
        if (a.includes(".")) return parseFloat(a);
        return BigInt(a);
      });

      const resultValue = fn(...args);
      console.log(resultValue);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program.parse();
