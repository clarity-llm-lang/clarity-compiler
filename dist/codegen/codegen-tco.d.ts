import binaryen from "binaryen";
import type { Expr, FunctionDecl, MatchArm, MatchExpr, CallExpr } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
export interface TcoContext {
    readonly mod: binaryen.Module;
    locals: Map<string, {
        index: number;
        wasmType: binaryen.Type;
        clarityType: ClarityType;
    }>;
    localIndex: number;
    additionalLocals: binaryen.Type[];
    currentFunction: FunctionDecl;
    readonly allTypeDecls: Map<string, ClarityType>;
    generateExpr: (expr: Expr, expectedType?: ClarityType) => binaryen.ExpressionRef;
    inferExprType: (expr: Expr) => ClarityType;
    allocStringLiteral: (value: string) => number;
}
export declare function isTailRecursive(expr: Expr, funcName: string): boolean;
export declare function generateTailRecursiveBody(ctx: TcoContext, decl: FunctionDecl, returnClarityType: ClarityType, returnWasmType: binaryen.Type): binaryen.ExpressionRef;
export declare function generateExprTCO(ctx: TcoContext, expr: Expr, expectedType: ClarityType | undefined, funcName: string, loopLabel: string): binaryen.ExpressionRef;
export declare function generateTailCallUpdate(ctx: TcoContext, expr: CallExpr, funcName: string, loopLabel: string): binaryen.ExpressionRef;
export declare function generateMatchTCO(ctx: TcoContext, matchExpr: MatchExpr, expectedType: ClarityType | undefined, funcName: string, loopLabel: string): binaryen.ExpressionRef;
export declare function generateBoolMatchTCO(ctx: TcoContext, scrutinee: binaryen.ExpressionRef, arms: MatchArm[], expectedType: ClarityType | undefined, funcName: string, loopLabel: string): binaryen.ExpressionRef;
export declare function generateUnionMatchTCO(ctx: TcoContext, scrutinee: binaryen.ExpressionRef, unionType: Extract<ClarityType, {
    kind: "Union";
}>, arms: MatchArm[], expectedType: ClarityType | undefined, funcName: string, loopLabel: string): binaryen.ExpressionRef;
export declare function generateGenericMatchTCO(ctx: TcoContext, scrutinee: binaryen.ExpressionRef, scrutineeType: ClarityType, arms: MatchArm[], expectedType: ClarityType | undefined, funcName: string, loopLabel: string): binaryen.ExpressionRef;
