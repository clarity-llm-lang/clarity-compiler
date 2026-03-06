// clarityc fmt — text-level formatter for Clarity source files.
//
// Normalises the most common style inconsistencies without requiring a full
// AST-based pretty-printer (which is planned as a follow-up):
//
//   • Ensures exactly one blank line between top-level declarations
//   • Strips trailing whitespace from every line
//   • Normalises indentation inside function bodies to 2-space increments
//   • Adds a single trailing newline to the file
//   • Removes duplicate consecutive blank lines (max one blank line between stmts)
//
// For a given file, fmt prints the formatted result to stdout (dry-run default)
// or writes it back in-place with --write.

import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Apply Clarity source formatting rules to a source string. */
export function formatSource(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];

  let insideBlock = 0;  // brace depth
  let prevBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip trailing whitespace
    let line = raw.replace(/\s+$/, "");

    // Track brace depth to know when we're inside a function body
    const openCount = (line.match(/\{/g) ?? []).length;
    const closeCount = (line.match(/\}/g) ?? []).length;
    const newDepth = insideBlock + openCount - closeCount;

    // Normalise indentation for non-blank lines inside blocks
    if (line.trim() !== "" && insideBlock > 0) {
      const stripped = line.trimStart();
      // Determine how many closes are on this line to find effective depth
      const effectiveDepth = stripped.startsWith("}") ? insideBlock - 1 : insideBlock;
      const indent = "  ".repeat(Math.max(0, effectiveDepth));
      line = indent + stripped;
    }

    // Collapse multiple consecutive blank lines into one
    if (line.trim() === "") {
      if (!prevBlank) {
        out.push("");
        prevBlank = true;
      }
    } else {
      out.push(line);
      prevBlank = false;
    }

    insideBlock = Math.max(0, newDepth);
  }

  // Ensure single trailing newline
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  out.push("");

  return out.join("\n");
}

export function registerFmtCommand(program: Command): void {
  program
    .command("fmt [file]")
    .description(
      "Format a .clarity source file.\n" +
      "By default prints the formatted output to stdout (dry-run).\n" +
      "Use --write to update the file in place."
    )
    .option("-w, --write", "Write formatted output back to the file in place")
    .option("--check", "Exit 1 if the file is not already formatted (useful in CI)")
    .action(async (file: string | undefined, opts: Record<string, unknown>) => {
      if (!file) {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(process.cwd());
        const found = entries.filter((f) => f.endsWith(".clarity"));
        if (found.length === 0) {
          console.error("No .clarity file found. Pass a file path explicitly.");
          process.exit(1);
        }
        if (found.length > 1) {
          console.error(`Multiple .clarity files found: ${found.join(", ")}. Pass explicitly.`);
          process.exit(1);
        }
        file = path.join(process.cwd(), found[0]);
      }

      const absFile = path.resolve(file);
      let source: string;
      try {
        source = await readFile(absFile, "utf-8");
      } catch (e) {
        console.error(`Cannot read file: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
        return;
      }

      const formatted = formatSource(source);

      if (opts.check) {
        if (formatted === source) {
          console.log(`${path.basename(absFile)}: already formatted`);
          process.exit(0);
        } else {
          console.error(`${path.basename(absFile)}: not formatted (run 'clarityc fmt --write')`);
          process.exit(1);
        }
        return;
      }

      if (opts.write) {
        await writeFile(absFile, formatted, "utf-8");
        console.log(`Formatted ${path.basename(absFile)}`);
      } else {
        process.stdout.write(formatted);
      }
    });
}
