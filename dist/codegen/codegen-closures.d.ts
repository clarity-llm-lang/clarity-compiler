import binaryen from "binaryen";
import type { LambdaExpr, FunctionDecl } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
import type { Checker } from "../checker/checker.js";
export interface ClosureContext {
    readonly mod: binaryen.Module;
    locals: Map<string, {
        index: number;
        wasmType: binaryen.Type;
        clarityType: ClarityType;
    }>;
    localIndex: number;
    additionalLocals: binaryen.Type[];
    currentFunction: FunctionDecl;
    readonly functionTableNames: string[];
    readonly functionTableIndices: Map<string, number>;
    readonly lambdaWrappers: Map<string, number>;
    readonly checker: Checker;
    lambdaCounter: number;
    generateExpr: (expr: import("../ast/nodes.js").Expr, expectedType?: ClarityType) => binaryen.ExpressionRef;
    inferExprType: (expr: import("../ast/nodes.js").Expr) => ClarityType;
}
/** Allocate `size` bytes on the runtime heap. */
export declare function callAlloc(ctx: ClosureContext, size: number): binaryen.ExpressionRef;
/** Add a temporary (non-param) local to the current function frame and return its index. */
export declare function addTempLocal(ctx: ClosureContext, wasmType: binaryen.Type): number;
/**
 * Allocate an 8-byte closure struct [func_table_idx: i32, env_ptr: i32] on the heap.
 * Returns an i32 expression that evaluates to the pointer to the closure struct.
 * `envPtrExpr` must be an i32 expression; pass `i32.const(0)` for non-capturing closures.
 */
export declare function buildClosureStruct(ctx: ClosureContext, tableIdx: number, envPtrExpr: binaryen.ExpressionRef): binaryen.ExpressionRef;
/**
 * Returns the function table index of the wrapper for a named function.
 * The wrapper has signature (env_ptr: i32, params...) -> ret so it can be
 * called via call_indirect with a uniform closure calling convention.
 * Wrappers are generated on demand and cached in `lambdaWrappers`.
 */
export declare function getOrCreateWrapper(ctx: ClosureContext, resolvedFuncName: string, fnType: Extract<ClarityType, {
    kind: "Function";
}>): number;
/**
 * Lift a lambda (potentially capturing) to a top-level WASM function and return
 * a pointer to its closure struct [func_table_idx: i32, env_ptr: i32].
 */
export declare function liftLambda(ctx: ClosureContext, lambda: LambdaExpr): binaryen.ExpressionRef;
