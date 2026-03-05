import binaryen from "binaryen";
import type { Expr, FunctionDecl, CallExpr, CallArg, TypeNode } from "../ast/nodes.js";
import type { ClarityType, ClarityVariant } from "../checker/types.js";
import type { Checker } from "../checker/checker.js";
export interface LocalVar {
    index: number;
    wasmType: binaryen.Type;
    clarityType: ClarityType;
}
export interface CallsContext {
    readonly mod: binaryen.Module;
    locals: Map<string, LocalVar>;
    localIndex: number;
    additionalLocals: binaryen.Type[];
    readonly allFunctions: Map<string, FunctionDecl>;
    readonly allTypeDecls: Map<string, ClarityType>;
    readonly typeVarSubst: Map<string, ClarityType>;
    readonly currentModuleWasmNames: Map<string, string>;
    readonly functionTableIndices: Map<string, number>;
    readonly checker: Checker;
    readonly generatedMonomorphs: Set<string>;
    currentFunction: FunctionDecl;
    generateExpr: (expr: Expr, expectedType?: ClarityType) => binaryen.ExpressionRef;
    inferExprType: (expr: Expr) => ClarityType;
    inferWasmReturnType: (name: string) => binaryen.Type;
    readonly builtinReturnTypeMap: Map<string, ClarityType>;
}
export declare function resolveTypeRefWithTypeParams(ctx: CallsContext, node: TypeNode, typeParams: string[]): ClarityType;
export declare function generateCall(ctx: CallsContext, expr: CallExpr): binaryen.ExpressionRef;
export declare function generateMonomorphizedCall(ctx: CallsContext, expr: CallExpr, genericDecl: FunctionDecl): binaryen.ExpressionRef;
export declare function generateIndirectCall(ctx: CallsContext, expr: CallExpr, local: LocalVar, fnType: Extract<ClarityType, {
    kind: "Function";
}>): binaryen.ExpressionRef;
export declare function findConstructorType(ctx: CallsContext, name: string): {
    union: Extract<ClarityType, {
        kind: "Union";
    }>;
    variantIndex: number;
    variant: ClarityVariant;
} | null;
export declare function generateConstructorCall(ctx: CallsContext, name: string, info: {
    union: Extract<ClarityType, {
        kind: "Union";
    }>;
    variantIndex: number;
    variant: ClarityVariant;
}, args: CallArg[]): binaryen.ExpressionRef;
export declare function tryGenerateListCall(ctx: CallsContext, name: string, expr: CallExpr): binaryen.ExpressionRef | null;
export declare function tryGenerateMapCall(ctx: CallsContext, name: string, expr: CallExpr): binaryen.ExpressionRef | null;
