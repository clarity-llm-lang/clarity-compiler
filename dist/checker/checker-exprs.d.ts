import type { Diagnostic } from "../errors/diagnostic.js";
import type { Expr, Pattern, TypeNode } from "../ast/nodes.js";
import type { ClarityType } from "./types.js";
import type { Environment } from "./environment.js";
/** Minimal context that checkExprInner and checkPattern need from Checker. */
export interface CheckerContext {
    readonly env: Environment;
    readonly diagnostics: Diagnostic[];
    readonly currentEffects: Set<string>;
    makeOptionType(inner: ClarityType): ClarityType;
    makeResultType(okType: ClarityType, errType: ClarityType): ClarityType;
    resultToUnion(t: Extract<ClarityType, {
        kind: "Result";
    }>): ClarityType & {
        kind: "Union";
    };
    resolveTypeRef(node: TypeNode): ClarityType | null;
    findRecordType(fieldNames: Set<string>, fieldTypes?: Map<string, ClarityType>): (ClarityType & {
        kind: "Record";
    }) | null;
    checkExpr(expr: Expr): ClarityType;
    checkPattern(pattern: Pattern, expectedType: ClarityType): void;
}
export declare function checkExprInner(ctx: CheckerContext, expr: Expr): ClarityType;
export declare function checkPattern(ctx: CheckerContext, pattern: Pattern, expectedType: ClarityType): void;
