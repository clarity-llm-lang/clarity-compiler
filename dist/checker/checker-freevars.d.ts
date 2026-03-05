import type { Expr, Pattern } from "../ast/nodes.js";
export declare function collectFreeVars(expr: Expr, bound: Set<string>): Set<string>;
export declare function walkExpr(expr: Expr, bound: Set<string>, free: Set<string>): void;
export declare function collectPatternBindings(pattern: Pattern, bound: Set<string>): void;
