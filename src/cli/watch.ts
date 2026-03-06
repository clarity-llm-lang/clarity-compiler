// clarityc watch — re-compile .clarity file on source changes.

import type { Command } from "commander";
import { watch as nodeWatch } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileFile } from "../compiler.js";
import { formatDiagnostics } from "../errors/reporter.js";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch [file]")
    .description(
      "Watch a .clarity file (and its imports) for changes and re-compile automatically.\n" +
      "Prints 'OK' with byte count on success, or error diagnostics on failure."
    )
    .option("-o, --output <file>", "Output .wasm file (default: <input>.wasm)")
    .action(async (file: string | undefined, opts: Record<string, unknown>) => {
      // Resolve the file to watch
      if (!file) {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(process.cwd());
        const found = entries.filter((f) => f.endsWith(".clarity"));
        if (found.length === 0) {
          console.error("No .clarity file found. Pass a file path explicitly.");
          process.exit(1);
        }
        if (found.length > 1) {
          console.error(`Multiple .clarity files found: ${found.join(", ")}. Pass a file path explicitly.`);
          process.exit(1);
        }
        file = path.join(process.cwd(), found[0]);
      }
      const absFile = path.resolve(file);
      const outFile = (opts.output as string | undefined) ?? absFile.replace(/\.clarity$/, ".wasm");

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let running = false;

      async function recompile(trigger: string) {
        if (running) return;
        running = true;
        const ts = new Date().toLocaleTimeString();
        process.stdout.write(`[${ts}] change detected in ${path.basename(trigger)} — compiling…\n`);
        try {
          const source = await readFile(absFile, "utf-8");
          const result = compileFile(absFile);
          if (result.errors.length > 0) {
            process.stderr.write(formatDiagnostics(source, result.errors) + "\n");
          } else if (result.wasm) {
            const { writeFile } = await import("node:fs/promises");
            await writeFile(outFile, result.wasm);
            process.stdout.write(`[${ts}] OK — ${result.wasm.length} bytes → ${path.basename(outFile)}\n`);
          }
        } catch (e) {
          process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
        } finally {
          running = false;
        }
      }

      // Perform an initial compile so the user sees the current state
      await recompile(absFile);

      // Watch the source file and its parent directory for changes
      const watchDir = path.dirname(absFile);
      process.stdout.write(`Watching ${absFile} (Ctrl+C to stop)…\n`);

      const watcher = nodeWatch(watchDir, { recursive: false }, (_event, filename) => {
        if (!filename) return;
        const changed = path.join(watchDir, filename as string);
        // Re-compile on .clarity file changes in the same directory
        if (!changed.endsWith(".clarity")) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => recompile(changed), 120);
      });

      process.on("SIGINT", () => {
        watcher.close();
        process.stdout.write("\nWatch stopped.\n");
        process.exit(0);
      });
    });
}
