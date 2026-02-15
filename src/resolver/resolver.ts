import * as path from "path";
import * as fs from "fs";
import { Lexer } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import type { ModuleDecl } from "../ast/nodes.js";
import type { Diagnostic } from "../errors/diagnostic.js";

export interface ResolvedModule {
  /** The absolute path to the .clarity file */
  filePath: string;
  /** The parsed AST */
  ast: ModuleDecl;
  /** Parse errors (if any) */
  errors: Diagnostic[];
}

/**
 * Resolves and parses all modules transitively imported by the entry file.
 * Returns modules in dependency order (dependencies before dependents).
 */
export function resolveModules(
  entryFilePath: string,
): { modules: ResolvedModule[]; errors: Diagnostic[] } {
  const absEntry = path.resolve(entryFilePath);
  const resolved = new Map<string, ResolvedModule>();
  const allErrors: Diagnostic[] = [];

  function resolve(filePath: string, importSpan?: Diagnostic["span"]): void {
    const abs = path.resolve(filePath);
    if (resolved.has(abs)) return;

    // Read and parse the file
    let source: string;
    try {
      source = fs.readFileSync(abs, "utf-8");
    } catch {
      if (importSpan) {
        allErrors.push({
          severity: "error",
          message: `Cannot find module '${filePath}'`,
          span: importSpan,
        });
      }
      return;
    }

    const lexer = new Lexer(source, abs);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, abs);
    const { module: ast, errors: parseErrors } = parser.parse();

    if (parseErrors.length > 0) {
      allErrors.push(...parseErrors);
      return;
    }

    // Register before recursing (prevents cycles)
    const mod: ResolvedModule = { filePath: abs, ast, errors: [] };
    resolved.set(abs, mod);

    // Recursively resolve imports
    for (const decl of ast.declarations) {
      if (decl.kind === "ImportDecl") {
        const importPath = resolveModulePath(abs, decl.from);
        resolve(importPath, decl.span);
      }
    }
  }

  resolve(absEntry);

  if (allErrors.length > 0) {
    return { modules: [], errors: allErrors };
  }

  // Topological sort: dependencies before dependents
  const order = topologicalSort(absEntry, resolved);
  return { modules: order, errors: [] };
}

/**
 * Resolve a module path relative to the importing file.
 * "math" → same_dir/math.clarity
 * "./utils/math" → relative_dir/utils/math.clarity
 */
export function resolveModulePath(importerPath: string, modulePath: string): string {
  const dir = path.dirname(importerPath);
  // Add .clarity extension if not present
  const withExt = modulePath.endsWith(".clarity") ? modulePath : modulePath + ".clarity";
  return path.resolve(dir, withExt);
}

/**
 * Topological sort of modules (Kahn's algorithm).
 * Returns modules in dependency order.
 */
function topologicalSort(
  entryPath: string,
  resolved: Map<string, ResolvedModule>,
): ResolvedModule[] {
  // Build adjacency list
  const deps = new Map<string, Set<string>>();
  for (const [filePath, mod] of resolved) {
    const imports = new Set<string>();
    for (const decl of mod.ast.declarations) {
      if (decl.kind === "ImportDecl") {
        const importPath = resolveModulePath(filePath, decl.from);
        if (resolved.has(importPath)) {
          imports.add(importPath);
        }
      }
    }
    deps.set(filePath, imports);
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const filePath of resolved.keys()) {
    inDegree.set(filePath, 0);
  }
  for (const imports of deps.values()) {
    for (const dep of imports) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Wait — in-degree should count how many modules depend ON this module.
  // Actually, Kahn's algorithm: in-degree = number of dependencies (edges pointing TO this node).
  // We want to process dependencies first, so nodes with 0 dependencies go first.
  // Let's redo: in-degree = number of dependencies this module has.
  const depCount = new Map<string, number>();
  for (const [filePath, imports] of deps) {
    depCount.set(filePath, imports.size);
  }

  const queue: string[] = [];
  for (const [filePath, count] of depCount) {
    if (count === 0) queue.push(filePath);
  }

  const order: ResolvedModule[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(resolved.get(current)!);

    // For each module that depends on current, decrement its dep count
    for (const [filePath, imports] of deps) {
      if (imports.has(current)) {
        const newCount = (depCount.get(filePath) ?? 1) - 1;
        depCount.set(filePath, newCount);
        if (newCount === 0) {
          queue.push(filePath);
        }
      }
    }
  }

  if (order.length !== resolved.size) {
    // Cycle detected — just return in whatever order for now
    return [...resolved.values()];
  }

  return order;
}
