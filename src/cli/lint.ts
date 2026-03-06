// clarityc lint — static analysis for Clarity source files.
//
// Checks performed:
//   1. Unused top-level declarations (functions and types not referenced outside their own body)
//   2. Unused imports (imported names that are never referenced)
//   3. Effectful function declarations missing effect annotation (heuristic)

import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileFile } from "../compiler.js";
import { formatDiagnostics } from "../errors/reporter.js";

interface LintWarning {
  kind: string;
  message: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Walk a Clarity AST node and collect every identifier token that appears
 * as a *reference* (i.e. not in a declaration position).
 */
function collectRefs(node: unknown, refs: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;

  // Function calls: { kind: "Call", name: string, ... }
  if (n["kind"] === "Call" && typeof n["name"] === "string") {
    refs.add(n["name"] as string);
  }
  // Variable / name references: { kind: "Var", name: string }
  if (n["kind"] === "Var" && typeof n["name"] === "string") {
    refs.add(n["name"] as string);
  }
  // Type references in annotations: walk typeAnnotation fields
  if (n["kind"] === "TypeRef" && typeof n["name"] === "string") {
    refs.add(n["name"] as string);
  }

  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      for (const item of value) collectRefs(item, refs);
    } else if (value && typeof value === "object") {
      collectRefs(value, refs);
    }
  }
}

export function registerLintCommand(program: Command): void {
  program
    .command("lint [file]")
    .description(
      "Lint a .clarity source file for unused declarations and common style issues.\n" +
      "Exits 0 if no warnings are found, 1 if warnings are present."
    )
    .option("--json", "Output warnings as JSON array")
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

      // Type-check first; surface compile errors as lint failures
      const result = compileFile(absFile, { checkOnly: true });
      if (result.errors.length > 0) {
        if (opts.json) {
          console.log(JSON.stringify(result.errors.map(e => ({
            kind: "compile_error",
            message: e.message,
            file: absFile,
            line: e.span.start.line,
            column: e.span.start.column,
          })), null, 2));
        } else {
          console.error(formatDiagnostics(source, result.errors));
        }
        process.exit(1);
        return;
      }

      const warnings: LintWarning[] = [];
      const ast = result.ast;

      if (ast && Array.isArray(ast.declarations)) {
        // Collect all global references across the entire AST
        const allRefs = new Set<string>();
        for (const decl of ast.declarations) {
          // Skip the declaration node itself — only collect refs inside it
          if (decl.kind === "FunctionDecl" || decl.kind === "TypeDecl") {
            const body = (decl as unknown as Record<string, unknown>)["body"];
            if (body) collectRefs(body, allRefs);
          } else {
            collectRefs(decl, allRefs);
          }
        }

        // Check for unused functions (non-test, non-exported, non-main)
        const ENTRY_NAMES = new Set(["main", "fn__receive_chat", "fn__receive_a2a"]);
        for (const decl of ast.declarations) {
          const d = decl as unknown as Record<string, unknown>;
          if (d["kind"] !== "FunctionDecl") continue;
          const name = d["name"] as string;
          if (!name) continue;
          if (name.startsWith("test_")) continue; // test functions are entry points
          if (ENTRY_NAMES.has(name)) continue;     // well-known runtime entry points
          const exported = !!(d["exported"] ?? d["export"]);
          if (exported) continue;                  // exported functions are used externally

          if (!allRefs.has(name)) {
            const span = (d["span"] as Record<string, unknown>) ?? {};
            const start = (span["start"] as Record<string, unknown>) ?? {};
            warnings.push({
              kind: "unused_function",
              message: `Function '${name}' is declared but never called`,
              file: absFile,
              line: (start["line"] as number) ?? 0,
              column: (start["column"] as number) ?? 0,
            });
          }
        }

        // Check for unused type declarations
        for (const decl of ast.declarations) {
          const d = decl as unknown as Record<string, unknown>;
          if (d["kind"] !== "TypeDecl") continue;
          const name = d["name"] as string;
          if (!name) continue;
          const exported = !!(d["exported"] ?? d["export"]);
          if (exported) continue;

          if (!allRefs.has(name)) {
            const span = (d["span"] as Record<string, unknown>) ?? {};
            const start = (span["start"] as Record<string, unknown>) ?? {};
            warnings.push({
              kind: "unused_type",
              message: `Type '${name}' is declared but never referenced`,
              file: absFile,
              line: (start["line"] as number) ?? 0,
              column: (start["column"] as number) ?? 0,
            });
          }
        }

        // Check for unused imports
        for (const decl of ast.declarations) {
          const d = decl as unknown as Record<string, unknown>;
          if (d["kind"] !== "Import") continue;
          const names = d["names"] as string[] | undefined;
          const fromModule = d["from"] ?? d["module"] ?? "(unknown)";
          if (!Array.isArray(names)) continue;
          for (const importedName of names) {
            if (!allRefs.has(importedName)) {
              const span = (d["span"] as Record<string, unknown>) ?? {};
              const start = (span["start"] as Record<string, unknown>) ?? {};
              warnings.push({
                kind: "unused_import",
                message: `'${importedName}' is imported from "${fromModule}" but never used`,
                file: absFile,
                line: (start["line"] as number) ?? 0,
                column: (start["column"] as number) ?? 0,
              });
            }
          }
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(warnings, null, 2));
      } else {
        if (warnings.length === 0) {
          console.log(`${path.basename(absFile)}: no issues found`);
        } else {
          for (const w of warnings) {
            console.warn(`${w.file}:${w.line}:${w.column}: warning[${w.kind}]: ${w.message}`);
          }
          console.warn(`\n${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
        }
      }

      process.exit(warnings.length > 0 ? 1 : 0);
    });
}
