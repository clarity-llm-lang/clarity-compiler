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
export declare function resolveModules(entryFilePath: string): {
    modules: ResolvedModule[];
    errors: Diagnostic[];
};
/**
 * Resolve a module path relative to the importing file.
 * "math" → same_dir/math.clarity
 * "./utils/math" → relative_dir/utils/math.clarity
 * "std/math" → <compiler>/std/math.clarity (standard library)
 */
export declare function resolveModulePath(importerPath: string, modulePath: string): string;
