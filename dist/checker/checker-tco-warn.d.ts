import type { Diagnostic } from "../errors/diagnostic.js";
import type { FunctionDecl, Expr } from "../ast/nodes.js";
export declare function tailCallees(expr: Expr): Set<string>;
export declare function warnMutualTailRecursion(diagnostics: Diagnostic[], decls: FunctionDecl[], localFuncNames: Set<string>): void;
