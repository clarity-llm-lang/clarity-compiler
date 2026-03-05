import type { Expr, FunctionDecl } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
import type { Checker } from "../checker/checker.js";
import binaryen from "binaryen";
export interface InferContext {
    readonly locals: Map<string, {
        index: number;
        wasmType: binaryen.Type;
        clarityType: ClarityType;
    }>;
    readonly allFunctions: Map<string, FunctionDecl>;
    readonly allTypeDecls: Map<string, ClarityType>;
    readonly functionTableIndices: Map<string, number>;
    readonly typeVarSubst: Map<string, ClarityType>;
    readonly currentFunction: FunctionDecl;
    readonly checker: Checker;
    readonly builtinReturnTypeMap: Map<string, ClarityType>;
}
export declare function inferExprType(ctx: InferContext, expr: Expr): ClarityType;
export declare function inferFunctionType(ctx: InferContext, decl: FunctionDecl): ClarityType;
export declare function inferFunctionReturnType(ctx: InferContext, name: string): ClarityType;
export declare function inferWasmReturnType(ctx: InferContext, name: string): binaryen.Type;
export declare function findConstructorType(ctx: InferContext, name: string): {
    union: Extract<ClarityType, {
        kind: "Union";
    }>;
    variantIndex: number;
    variant: import("../checker/types.js").ClarityVariant;
} | null;
