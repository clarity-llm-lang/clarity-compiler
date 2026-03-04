import type { Token } from "./lexer/tokens.js";
import type { ModuleDecl } from "./ast/nodes.js";
import type { Diagnostic } from "./errors/diagnostic.js";
export interface CompileOptions {
    checkOnly?: boolean;
    emitAst?: boolean;
    emitTokens?: boolean;
    emitWat?: boolean;
}
export interface CompileResult {
    tokens?: Token[];
    ast?: ModuleDecl;
    /** Fatal diagnostics only (severity: "error"). Non-empty means compilation failed. */
    errors: Diagnostic[];
    /** Non-fatal diagnostics (severity: "warning" | "info"). Compilation may still succeed. */
    warnings: Diagnostic[];
    wasm?: Uint8Array;
    wat?: string;
}
/**
 * Compile a single source string (no module resolution).
 * Used by tests and when source is provided directly.
 */
export declare function compile(source: string, filename: string, options?: CompileOptions): CompileResult;
/**
 * Compile a file with full module resolution.
 * Resolves imports, checks all modules, and merges into a single WASM binary.
 */
export declare function compileFile(filePath: string, options?: CompileOptions): CompileResult;
