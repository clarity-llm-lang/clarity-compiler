import binaryen from "binaryen";
import type { Expr, MatchArm, MatchExpr, LiteralPattern, RangePattern } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
export interface MatchContext {
    readonly mod: binaryen.Module;
    locals: Map<string, {
        index: number;
        wasmType: binaryen.Type;
        clarityType: ClarityType;
    }>;
    localIndex: number;
    additionalLocals: binaryen.Type[];
    readonly allTypeDecls: Map<string, ClarityType>;
    generateExpr: (expr: Expr, expectedType?: ClarityType) => binaryen.ExpressionRef;
    inferExprType: (expr: Expr) => ClarityType;
    allocStringLiteral: (value: string) => number;
}
export declare function generateMatch(ctx: MatchContext, matchExpr: MatchExpr, expectedType?: ClarityType): binaryen.ExpressionRef;
export declare function generateBoolMatch(ctx: MatchContext, scrutinee: binaryen.ExpressionRef, arms: MatchArm[], expectedType?: ClarityType): binaryen.ExpressionRef;
export declare function generateGuardedBoolMatch(ctx: MatchContext, scrutinee: binaryen.ExpressionRef, arms: MatchArm[], expectedType?: ClarityType): binaryen.ExpressionRef;
export declare function generateUnionMatch(ctx: MatchContext, scrutinee: binaryen.ExpressionRef, unionType: Extract<ClarityType, {
    kind: "Union";
}>, arms: MatchArm[], expectedType?: ClarityType): binaryen.ExpressionRef;
export declare function generateGenericMatch(ctx: MatchContext, scrutinee: binaryen.ExpressionRef, scrutineeType: ClarityType, arms: MatchArm[], expectedType?: ClarityType): binaryen.ExpressionRef;
export declare function generatePatternCondition(ctx: MatchContext, scrutinee: binaryen.ExpressionRef, pattern: LiteralPattern, scrutineeType: ClarityType): binaryen.ExpressionRef;
export declare function generateRangePatternCondition(ctx: MatchContext, getScrutinee: () => binaryen.ExpressionRef, pattern: RangePattern): binaryen.ExpressionRef;
