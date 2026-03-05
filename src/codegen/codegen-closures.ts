// ---------------------------------------------------------------------------
// Closure / lambda-lifting helpers.
// Extracted from codegen.ts to keep file sizes under the 600-line limit.
// ---------------------------------------------------------------------------
import binaryen from "binaryen";
import type { LambdaExpr, FunctionDecl } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
import { clarityTypeToWasm } from "./wasm-types.js";
import type { Checker } from "../checker/checker.js";

export interface ClosureContext {
  readonly mod: binaryen.Module;
  locals: Map<string, { index: number; wasmType: binaryen.Type; clarityType: ClarityType }>;
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
export function callAlloc(ctx: ClosureContext, size: number): binaryen.ExpressionRef {
  return ctx.mod.call("__alloc", [ctx.mod.i32.const(size)], binaryen.i32);
}

/** Add a temporary (non-param) local to the current function frame and return its index. */
export function addTempLocal(ctx: ClosureContext, wasmType: binaryen.Type): number {
  const idx = ctx.localIndex++;
  ctx.additionalLocals.push(wasmType);
  return idx;
}

/**
 * Allocate an 8-byte closure struct [func_table_idx: i32, env_ptr: i32] on the heap.
 * Returns an i32 expression that evaluates to the pointer to the closure struct.
 * `envPtrExpr` must be an i32 expression; pass `i32.const(0)` for non-capturing closures.
 */
export function buildClosureStruct(
  ctx: ClosureContext,
  tableIdx: number,
  envPtrExpr: binaryen.ExpressionRef,
): binaryen.ExpressionRef {
  const tmp = addTempLocal(ctx, binaryen.i32);
  const getPtr = () => ctx.mod.local.get(tmp, binaryen.i32);
  return ctx.mod.block(null, [
    ctx.mod.local.set(tmp, callAlloc(ctx, 8)),
    ctx.mod.i32.store(0, 4, getPtr(), ctx.mod.i32.const(tableIdx)),
    ctx.mod.i32.store(4, 4, getPtr(), envPtrExpr),
    getPtr(),
  ], binaryen.i32);
}

/**
 * Returns the function table index of the wrapper for a named function.
 * The wrapper has signature (env_ptr: i32, params...) -> ret so it can be
 * called via call_indirect with a uniform closure calling convention.
 * Wrappers are generated on demand and cached in `lambdaWrappers`.
 */
export function getOrCreateWrapper(
  ctx: ClosureContext,
  resolvedFuncName: string,
  fnType: Extract<ClarityType, { kind: "Function" }>,
): number {
  const cached = ctx.lambdaWrappers.get(resolvedFuncName);
  if (cached !== undefined) return cached;

  const wrapperName = `__wrap_${resolvedFuncName}`;
  // Signature: (env_ptr: i32, declared_params...) -> ret
  const paramWasmTypes: binaryen.Type[] = [binaryen.i32]; // env_ptr (ignored)
  const forwardArgs: binaryen.ExpressionRef[] = [];
  let localIdx = 1; // local 0 = env_ptr
  for (const paramType of fnType.params) {
    const wasmType = clarityTypeToWasm(paramType);
    paramWasmTypes.push(wasmType);
    forwardArgs.push(ctx.mod.local.get(localIdx++, wasmType));
  }
  const returnWasmType = clarityTypeToWasm(fnType.returnType);
  const body = ctx.mod.call(resolvedFuncName, forwardArgs, returnWasmType);
  ctx.mod.addFunction(wrapperName, binaryen.createType(paramWasmTypes), returnWasmType, [], body);

  const tableIdx = ctx.functionTableNames.length;
  ctx.functionTableIndices.set(wrapperName, tableIdx);
  ctx.functionTableNames.push(wrapperName);
  ctx.lambdaWrappers.set(resolvedFuncName, tableIdx);
  return tableIdx;
}

/**
 * Lift a lambda (potentially capturing) to a top-level WASM function and return
 * a pointer to its closure struct [func_table_idx: i32, env_ptr: i32].
 */
export function liftLambda(ctx: ClosureContext, lambda: LambdaExpr): binaryen.ExpressionRef {
  const name = `__lambda_${ctx.lambdaCounter++}`;
  lambda.liftedName = name;

  const captures = lambda.captures ?? [];

  // Save caller's local state
  const savedFunction = ctx.currentFunction;
  const savedLocals = ctx.locals;
  const savedLocalIndex = ctx.localIndex;
  const savedAdditionalLocals = ctx.additionalLocals;

  // Compute capture layout using the OUTER locals (before resetting).
  interface CaptureInfo {
    name: string;
    outerLocalIdx: number;
    wasmType: binaryen.Type;
    clarityType: ClarityType;
    envOffset: number;
  }
  const captureLayout: CaptureInfo[] = captures
    .filter(capName => savedLocals.has(capName))
    .map((capName, i) => {
      const outerLocal = savedLocals.get(capName)!;
      return {
        name: capName,
        outerLocalIdx: outerLocal.index,
        wasmType: outerLocal.wasmType,
        clarityType: outerLocal.clarityType,
        envOffset: i * 8,
      };
    });

  // Set up fresh local frame for the lifted function
  ctx.locals = new Map();
  ctx.localIndex = 0;
  ctx.additionalLocals = [];

  // Local 0: env_ptr (i32)
  const ENV_PTR_LOCAL = 0;
  ctx.localIndex = 1;

  // Lambda declared params (locals 1..N)
  const paramWasmTypes: binaryen.Type[] = [binaryen.i32]; // env_ptr first
  for (const param of lambda.params) {
    const ct = ctx.checker.resolveTypeRef(param.typeAnnotation) ?? { kind: "Error" } as ClarityType;
    const wasmType = clarityTypeToWasm(ct);
    ctx.locals.set(param.name, { index: ctx.localIndex, wasmType, clarityType: ct });
    paramWasmTypes.push(wasmType);
    ctx.localIndex++;
  }

  // Allocate inner locals for captures and emit load-from-env statements.
  const captureLoadStmts: binaryen.ExpressionRef[] = [];
  for (const cap of captureLayout) {
    const innerLocalIdx = ctx.localIndex++;
    ctx.additionalLocals.push(cap.wasmType);
    ctx.locals.set(cap.name, { index: innerLocalIdx, wasmType: cap.wasmType, clarityType: cap.clarityType });

    const envPtrGet = () => ctx.mod.local.get(ENV_PTR_LOCAL, binaryen.i32);
    let loadExpr: binaryen.ExpressionRef;
    if (cap.wasmType === binaryen.i64) {
      loadExpr = ctx.mod.i64.load(cap.envOffset, 8, envPtrGet());
    } else if (cap.wasmType === binaryen.f64) {
      loadExpr = ctx.mod.f64.load(cap.envOffset, 8, envPtrGet());
    } else {
      loadExpr = ctx.mod.i32.load(cap.envOffset, 4, envPtrGet());
    }
    captureLoadStmts.push(ctx.mod.local.set(innerLocalIdx, loadExpr));
  }

  const returnType = ctx.inferExprType(lambda.body);
  const returnWasmType = clarityTypeToWasm(returnType);
  const bodyExpr = ctx.generateExpr(lambda.body, returnType);

  const fullBody = captureLoadStmts.length > 0
    ? ctx.mod.block(null, [...captureLoadStmts, bodyExpr], returnWasmType)
    : bodyExpr;

  ctx.mod.addFunction(name, binaryen.createType(paramWasmTypes), returnWasmType, ctx.additionalLocals, fullBody);

  // Register in the function table.
  const tableIndex = ctx.functionTableNames.length;
  ctx.functionTableIndices.set(name, tableIndex);
  ctx.functionTableNames.push(name);

  // Restore caller's local state
  ctx.currentFunction = savedFunction;
  ctx.locals = savedLocals;
  ctx.localIndex = savedLocalIndex;
  ctx.additionalLocals = savedAdditionalLocals;

  // Build the env struct (in the OUTER function's context)
  let envPtrExpr: binaryen.ExpressionRef;
  if (captureLayout.length > 0) {
    const envSize = captureLayout.length * 8;
    const tmpEnv = addTempLocal(ctx, binaryen.i32);
    const stmts: binaryen.ExpressionRef[] = [
      ctx.mod.local.set(tmpEnv, callAlloc(ctx, envSize)),
    ];
    for (const cap of captureLayout) {
      const outerVal = ctx.mod.local.get(cap.outerLocalIdx, cap.wasmType);
      const envGet = () => ctx.mod.local.get(tmpEnv, binaryen.i32);
      let storeExpr: binaryen.ExpressionRef;
      if (cap.wasmType === binaryen.i64) {
        storeExpr = ctx.mod.i64.store(cap.envOffset, 8, envGet(), outerVal);
      } else if (cap.wasmType === binaryen.f64) {
        storeExpr = ctx.mod.f64.store(cap.envOffset, 8, envGet(), outerVal);
      } else {
        storeExpr = ctx.mod.i32.store(cap.envOffset, 4, envGet(), outerVal);
      }
      stmts.push(storeExpr);
    }
    stmts.push(ctx.mod.local.get(tmpEnv, binaryen.i32));
    envPtrExpr = ctx.mod.block(null, stmts, binaryen.i32);
  } else {
    envPtrExpr = ctx.mod.i32.const(0);
  }

  // Return a pointer to the closure struct [tableIndex, envPtr].
  return buildClosureStruct(ctx, tableIndex, envPtrExpr);
}
