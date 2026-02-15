import { Lexer } from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
import { Checker } from "./checker/checker.js";
import { CodeGenerator } from "./codegen/codegen.js";
import type { Token } from "./lexer/tokens.js";
import type { ModuleDecl } from "./ast/nodes.js";
import type { Diagnostic } from "./errors/diagnostic.js";
import { resolveModules, resolveModulePath } from "./resolver/resolver.js";

export interface CompileOptions {
  checkOnly?: boolean;
  emitAst?: boolean;
  emitTokens?: boolean;
  emitWat?: boolean;
}

export interface CompileResult {
  tokens?: Token[];
  ast?: ModuleDecl;
  errors: Diagnostic[];
  wasm?: Uint8Array;
  wat?: string;
}

/**
 * Compile a single source string (no module resolution).
 * Used by tests and when source is provided directly.
 */
export function compile(
  source: string,
  filename: string,
  options: CompileOptions = {},
): CompileResult {
  // 1. Lex
  const lexer = new Lexer(source, filename);
  const tokens = lexer.tokenize();

  if (options.emitTokens) {
    return { tokens, errors: [] };
  }

  // 2. Parse
  const parser = new Parser(tokens, filename);
  const { module: ast, errors: parseErrors } = parser.parse();

  if (parseErrors.length > 0) {
    return { tokens, ast, errors: parseErrors };
  }

  if (options.emitAst) {
    return { tokens, ast, errors: [] };
  }

  // Check if this module has imports — if so, we need file-based resolution
  const hasImports = ast.declarations.some(d => d.kind === "ImportDecl");
  if (hasImports) {
    // Can't resolve imports from a raw source string without a real file path
    return {
      tokens, ast,
      errors: [{
        severity: "error",
        message: "Module has imports but was compiled from a source string. Use compileFile() for multi-file compilation.",
        span: ast.declarations.find(d => d.kind === "ImportDecl")!.span,
      }],
    };
  }

  // 3. Type Check (single module, no imports)
  const checker = new Checker();
  const checkErrors = checker.check(ast);

  if (checkErrors.length > 0) {
    return { tokens, ast, errors: checkErrors };
  }

  if (options.checkOnly) {
    return { tokens, ast, errors: [] };
  }

  // 4. Code Generation
  try {
    const codegen = new CodeGenerator();

    if (options.emitWat) {
      const wat = codegen.generateText(ast, checker);
      return { tokens, ast, errors: [], wat };
    }

    const wasm = codegen.generate(ast, checker);
    return { tokens, ast, errors: [], wasm };
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e) ?? String(e);
    return {
      tokens,
      ast,
      errors: [{
        severity: "error",
        message: `Code generation failed: ${msg}`,
        span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 }, source: filename },
      }],
    };
  }
}

/**
 * Compile a file with full module resolution.
 * Resolves imports, checks all modules, and merges into a single WASM binary.
 */
export function compileFile(
  filePath: string,
  options: CompileOptions = {},
): CompileResult {
  // 1. Resolve all modules (parse imported files recursively)
  const { modules, errors: resolveErrors } = resolveModules(filePath);
  if (resolveErrors.length > 0) {
    return { errors: resolveErrors };
  }

  if (modules.length === 0) {
    return { errors: [{ severity: "error", message: "No modules found", span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 }, source: filePath } }] };
  }

  // The entry module is last in topological order
  const entryModule = modules[modules.length - 1];

  if (options.emitAst) {
    return { ast: entryModule.ast, errors: [] };
  }

  // 2. Type check all modules in dependency order
  // Each module's exports become available to subsequent modules
  const checker = new Checker();
  const moduleExports = new Map<string, Map<string, { type: import("./checker/types.js").ClarityType; span: import("./errors/diagnostic.js").Span }>>();

  for (const mod of modules) {
    // Collect imported symbols for this module
    const importedSymbols: { name: string; type: import("./checker/types.js").ClarityType; span: import("./errors/diagnostic.js").Span }[] = [];
    const importedTypes: { name: string; type: import("./checker/types.js").ClarityType }[] = [];

    for (const decl of mod.ast.declarations) {
      if (decl.kind === "ImportDecl") {
        // Find the exporting module
        const importPath = resolveImportPath(mod.filePath, decl.from);
        const exports = moduleExports.get(importPath);
        if (!exports) {
          return {
            errors: [{
              severity: "error",
              message: `Module '${decl.from}' not found or has errors`,
              span: decl.span,
            }],
          };
        }

        for (const name of decl.names) {
          const exported = exports.get(name);
          if (!exported) {
            return {
              errors: [{
                severity: "error",
                message: `'${name}' is not exported from '${decl.from}'`,
                span: decl.span,
              }],
            };
          }
          // Functions go as symbols, types go as types
          if (exported.type.kind === "Record" || exported.type.kind === "Union") {
            importedTypes.push({ name, type: exported.type });
          } else {
            importedSymbols.push({ name, type: exported.type, span: exported.span });
          }
        }
      }
    }

    // Check this module with imported symbols available
    const checkErrors = checker.checkModule(mod.ast, importedSymbols, importedTypes);
    if (checkErrors.length > 0) {
      return { ast: mod.ast, errors: checkErrors };
    }

    // Collect this module's exports for downstream modules
    const exports = new Map<string, { type: import("./checker/types.js").ClarityType; span: import("./errors/diagnostic.js").Span }>();
    for (const decl of mod.ast.declarations) {
      if (decl.kind === "FunctionDecl" && decl.exported) {
        const sym = checker.lookupSymbol(decl.name);
        if (sym) {
          exports.set(decl.name, { type: sym.type, span: sym.defined });
        }
      } else if (decl.kind === "TypeDecl" && decl.exported) {
        const type = checker.lookupType(decl.name);
        if (type) {
          exports.set(decl.name, { type, span: decl.span });
          // Also export variant constructors for union types
          if (type.kind === "Union") {
            for (const variant of type.variants) {
              const sym = checker.lookupSymbol(variant.name);
              if (sym) {
                exports.set(variant.name, { type: sym.type, span: decl.span });
              }
            }
          }
        }
      }
    }
    moduleExports.set(mod.filePath, exports);
  }

  if (options.checkOnly) {
    return { ast: entryModule.ast, errors: [] };
  }

  // 3. Code generation: merge all module declarations into a single WASM binary
  try {
    const codegen = new CodeGenerator();
    const allModules = modules.map(m => m.ast);

    if (options.emitWat) {
      const wat = codegen.generateTextMulti(allModules, entryModule.ast, checker);
      return { ast: entryModule.ast, errors: [], wat };
    }

    const wasm = codegen.generateMulti(allModules, entryModule.ast, checker);
    return { ast: entryModule.ast, errors: [], wasm };
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e) ?? String(e);
    return {
      ast: entryModule.ast,
      errors: [{
        severity: "error",
        message: `Code generation failed: ${msg}`,
        span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 }, source: filePath },
      }],
    };
  }
}

// Re-export resolveModulePath from resolver for use in compileFile
const resolveImportPath = resolveModulePath;
