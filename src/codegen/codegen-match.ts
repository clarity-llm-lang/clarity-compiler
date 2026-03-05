// ---------------------------------------------------------------------------
// Match expression code generation helpers.
// Extracted from codegen.ts to keep file sizes under the 600-line limit.
// ---------------------------------------------------------------------------
import binaryen from "binaryen";
import type { Expr, MatchArm, MatchExpr, LiteralPattern, RangePattern } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
import { clarityTypeToWasm } from "./wasm-types.js";
import {
  recordLayout as _recordLayout,
  loadField as _loadField,
} from "./codegen-memory.js";

export interface MatchContext {
  readonly mod: binaryen.Module;
  locals: Map<string, { index: number; wasmType: binaryen.Type; clarityType: ClarityType }>;
  localIndex: number;
  additionalLocals: binaryen.Type[];
  readonly allTypeDecls: Map<string, ClarityType>;
  generateExpr: (expr: Expr, expectedType?: ClarityType) => binaryen.ExpressionRef;
  inferExprType: (expr: Expr) => ClarityType;
  allocStringLiteral: (value: string) => number;
}

function recordLayout(ctx: MatchContext, fields: Map<string, ClarityType>) {
  return _recordLayout(fields);
}

function loadField(ctx: MatchContext, basePtr: binaryen.ExpressionRef, offset: number, type: ClarityType) {
  return _loadField(ctx.mod, basePtr, offset, type);
}

export function generateMatch(
  ctx: MatchContext,
  matchExpr: MatchExpr,
  expectedType?: ClarityType,
): binaryen.ExpressionRef {
  const scrutinee = ctx.generateExpr(matchExpr.scrutinee);
  const scrutineeType = ctx.inferExprType(matchExpr.scrutinee);

  if (scrutineeType.kind === "Bool") {
    return generateBoolMatch(ctx, scrutinee, matchExpr.arms, expectedType);
  }

  if (scrutineeType.kind === "Union") {
    return generateUnionMatch(ctx, scrutinee, scrutineeType as Extract<ClarityType, { kind: "Union" }>, matchExpr.arms, expectedType);
  }

  return generateGenericMatch(ctx, scrutinee, scrutineeType, matchExpr.arms, expectedType);
}

export function generateBoolMatch(
  ctx: MatchContext,
  scrutinee: binaryen.ExpressionRef,
  arms: MatchArm[],
  expectedType?: ClarityType,
): binaryen.ExpressionRef {
  const hasGuards = arms.some(a => a.guard);
  if (hasGuards) {
    return generateGuardedBoolMatch(ctx, scrutinee, arms, expectedType);
  }

  let trueBody: binaryen.ExpressionRef | null = null;
  let falseBody: binaryen.ExpressionRef | null = null;
  let wildcardBody: binaryen.ExpressionRef | null = null;

  for (const arm of arms) {
    if (arm.pattern.kind === "LiteralPattern" && arm.pattern.value.kind === "BoolLiteral") {
      if (arm.pattern.value.value) {
        trueBody = ctx.generateExpr(arm.body, expectedType);
      } else {
        falseBody = ctx.generateExpr(arm.body, expectedType);
      }
    } else if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
      wildcardBody = ctx.generateExpr(arm.body, expectedType);
    }
  }

  const ifTrue = trueBody ?? wildcardBody ?? ctx.mod.unreachable();
  const ifFalse = falseBody ?? wildcardBody ?? ctx.mod.unreachable();

  return ctx.mod.if(scrutinee, ifTrue, ifFalse);
}

export function generateGuardedBoolMatch(
  ctx: MatchContext,
  scrutinee: binaryen.ExpressionRef,
  arms: MatchArm[],
  expectedType?: ClarityType,
): binaryen.ExpressionRef {
  const tempIndex = ctx.localIndex++;
  ctx.additionalLocals.push(binaryen.i32);
  const setTemp = ctx.mod.local.set(tempIndex, scrutinee);
  const getTemp = () => ctx.mod.local.get(tempIndex, binaryen.i32);

  let result: binaryen.ExpressionRef = ctx.mod.unreachable();

  for (let i = arms.length - 1; i >= 0; i--) {
    const arm = arms[i];
    const body = ctx.generateExpr(arm.body, expectedType);

    if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
      if (arm.guard) {
        const guardCond = ctx.generateExpr(arm.guard);
        result = ctx.mod.if(guardCond, body, result);
      } else {
        result = body;
      }
    } else if (arm.pattern.kind === "LiteralPattern" && arm.pattern.value.kind === "BoolLiteral") {
      let cond: binaryen.ExpressionRef;
      if (arm.pattern.value.value) {
        cond = getTemp();
      } else {
        cond = ctx.mod.i32.eqz(getTemp());
      }
      if (arm.guard) {
        cond = ctx.mod.i32.and(cond, ctx.generateExpr(arm.guard));
      }
      result = ctx.mod.if(cond, body, result);
    }
  }

  const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
  return ctx.mod.block(null, [setTemp, result], matchResultType);
}

export function generateUnionMatch(
  ctx: MatchContext,
  scrutinee: binaryen.ExpressionRef,
  unionType: Extract<ClarityType, { kind: "Union" }>,
  arms: MatchArm[],
  expectedType?: ClarityType,
): binaryen.ExpressionRef {
  const ptrLocal = ctx.localIndex++;
  ctx.additionalLocals.push(binaryen.i32);
  const setPtr = ctx.mod.local.set(ptrLocal, scrutinee);
  const getPtr = () => ctx.mod.local.get(ptrLocal, binaryen.i32);

  const tagLocal = ctx.localIndex++;
  ctx.additionalLocals.push(binaryen.i32);
  const setTag = ctx.mod.local.set(tagLocal, ctx.mod.i32.load(0, 4, getPtr()));
  const getTag = () => ctx.mod.local.get(tagLocal, binaryen.i32);

  const hasGuards = arms.some(a => a.guard);
  const matchResultWasmType = expectedType ? clarityTypeToWasm(expectedType) : binaryen.i32;
  let resultLocal: number | undefined;
  let getResult: (() => binaryen.ExpressionRef) | undefined;
  let setResult: ((val: binaryen.ExpressionRef) => binaryen.ExpressionRef) | undefined;
  if (hasGuards) {
    resultLocal = ctx.localIndex++;
    ctx.additionalLocals.push(matchResultWasmType);
    getResult = () => ctx.mod.local.get(resultLocal!, matchResultWasmType);
    setResult = (val: binaryen.ExpressionRef) => ctx.mod.local.set(resultLocal!, val);
  }

  let result: binaryen.ExpressionRef = ctx.mod.unreachable();

  for (let i = arms.length - 1; i >= 0; i--) {
    const arm = arms[i];

    if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
      if (arm.pattern.kind === "BindingPattern") {
        const bindLocal = ctx.localIndex++;
        ctx.additionalLocals.push(binaryen.i32);
        ctx.locals.set(arm.pattern.name, {
          index: bindLocal,
          wasmType: binaryen.i32,
          clarityType: unionType,
        });
        const bindStmt = ctx.mod.local.set(bindLocal, getPtr());
        const bodyExpr = ctx.generateExpr(arm.body, expectedType);
        if (arm.guard) {
          const guardCond = ctx.generateExpr(arm.guard);
          const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
          const guardedResult = ctx.mod.if(guardCond, bodyExpr, getResult!());
          result = ctx.mod.block(null, [setResult!(result), bindStmt, guardedResult], bodyResultType);
        } else {
          const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
          result = ctx.mod.block(null, [bindStmt, bodyExpr], bodyResultType);
        }
      } else {
        const bodyExpr = ctx.generateExpr(arm.body, expectedType);
        if (arm.guard) {
          const guardCond = ctx.generateExpr(arm.guard);
          const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
          result = ctx.mod.block(null, [
            setResult!(result),
            ctx.mod.if(guardCond, bodyExpr, getResult!()),
          ], bodyResultType);
        } else {
          result = bodyExpr;
        }
      }
    } else if (arm.pattern.kind === "ConstructorPattern") {
      const ctorPattern = arm.pattern as import("../ast/nodes.js").ConstructorPattern;
      const variantIndex = unionType.variants.findIndex((v) => v.name === ctorPattern.name);
      if (variantIndex === -1) continue;
      const variant = unionType.variants[variantIndex];

      const layout = recordLayout(ctx, variant.fields);
      const fieldEntries = [...variant.fields.entries()];

      for (let fi = 0; fi < ctorPattern.fields.length && fi < fieldEntries.length; fi++) {
        const pat = ctorPattern.fields[fi];
        if (pat.pattern.kind === "BindingPattern") {
          const fieldType = fieldEntries[fi][1];
          const wasmType = clarityTypeToWasm(fieldType);
          const localIdx = ctx.localIndex++;
          ctx.additionalLocals.push(wasmType);
          ctx.locals.set(pat.pattern.name, {
            index: localIdx,
            wasmType,
            clarityType: fieldType,
          });
        }
      }

      const bodyStmts: binaryen.ExpressionRef[] = [];
      for (let fi = 0; fi < ctorPattern.fields.length && fi < fieldEntries.length; fi++) {
        const pat = ctorPattern.fields[fi];
        if (pat.pattern.kind === "BindingPattern") {
          const fieldType = fieldEntries[fi][1];
          const fieldOffset = layout[fi].offset + 8;
          const local = ctx.locals.get(pat.pattern.name)!;
          bodyStmts.push(
            ctx.mod.local.set(local.index, loadField(ctx, getPtr(), fieldOffset, fieldType)),
          );
        }
      }

      const bodyExpr = ctx.generateExpr(arm.body, expectedType);
      const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;

      let armResult: binaryen.ExpressionRef;
      if (arm.guard) {
        const guardCond = ctx.generateExpr(arm.guard);
        const guardedBody = ctx.mod.if(guardCond, bodyExpr, getResult!());
        bodyStmts.push(guardedBody);
        armResult = ctx.mod.block(null, bodyStmts, bodyResultType);
        const cond = ctx.mod.i32.eq(getTag(), ctx.mod.i32.const(variantIndex));
        result = ctx.mod.block(null, [
          setResult!(result),
          ctx.mod.if(cond, armResult, getResult!()),
        ], bodyResultType);
      } else {
        bodyStmts.push(bodyExpr);
        armResult = bodyStmts.length === 1
          ? bodyStmts[0]
          : ctx.mod.block(null, bodyStmts, bodyResultType);

        const cond = ctx.mod.i32.eq(getTag(), ctx.mod.i32.const(variantIndex));
        result = ctx.mod.if(cond, armResult, result);
      }
    }
  }

  const numVariants = unionType.variants.length;
  const boundsCheck = ctx.mod.if(
    ctx.mod.i32.ge_u(getTag(), ctx.mod.i32.const(numVariants)),
    ctx.mod.unreachable(),
  );

  const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
  return ctx.mod.block(null, [setPtr, setTag, boundsCheck, result], matchResultType);
}

export function generateGenericMatch(
  ctx: MatchContext,
  scrutinee: binaryen.ExpressionRef,
  scrutineeType: ClarityType,
  arms: MatchArm[],
  expectedType?: ClarityType,
): binaryen.ExpressionRef {
  const wasmType = clarityTypeToWasm(scrutineeType);
  const tempIndex = ctx.localIndex++;
  ctx.additionalLocals.push(wasmType);
  const setTemp = ctx.mod.local.set(tempIndex, scrutinee);
  const getTemp = () => ctx.mod.local.get(tempIndex, wasmType);

  let result: binaryen.ExpressionRef = ctx.mod.unreachable();

  for (let i = arms.length - 1; i >= 0; i--) {
    const arm = arms[i];
    const body = ctx.generateExpr(arm.body, expectedType);

    if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
      if (arm.pattern.kind === "BindingPattern") {
        const bindIndex = ctx.localIndex++;
        ctx.additionalLocals.push(wasmType);
        ctx.locals.set(arm.pattern.name, {
          index: bindIndex,
          wasmType,
          clarityType: scrutineeType,
        });
        const bindStmt = ctx.mod.local.set(bindIndex, getTemp());
        if (arm.guard) {
          const guardCond = ctx.generateExpr(arm.guard);
          const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
          const guardedResult = ctx.mod.if(guardCond, body, result);
          result = ctx.mod.block(null, [bindStmt, guardedResult], bodyResultType);
        } else {
          const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
          result = ctx.mod.block(null, [bindStmt, body], bodyResultType);
        }
      } else {
        if (arm.guard) {
          const guardCond = ctx.generateExpr(arm.guard);
          result = ctx.mod.if(guardCond, body, result);
        } else {
          result = body;
        }
      }
    } else if (arm.pattern.kind === "LiteralPattern") {
      let cond = generatePatternCondition(ctx, getTemp(), arm.pattern as LiteralPattern, scrutineeType);
      if (arm.guard) {
        const guardCond = ctx.generateExpr(arm.guard);
        cond = ctx.mod.i32.and(cond, guardCond);
      }
      result = ctx.mod.if(cond, body, result);
    } else if (arm.pattern.kind === "RangePattern") {
      let cond = generateRangePatternCondition(ctx, getTemp, arm.pattern as RangePattern);
      if (arm.guard) {
        const guardCond = ctx.generateExpr(arm.guard);
        cond = ctx.mod.i32.and(cond, guardCond);
      }
      result = ctx.mod.if(cond, body, result);
    }
  }

  const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
  return ctx.mod.block(null, [setTemp, result], matchResultType);
}

export function generatePatternCondition(
  ctx: MatchContext,
  scrutinee: binaryen.ExpressionRef,
  pattern: LiteralPattern,
  scrutineeType: ClarityType,
): binaryen.ExpressionRef {
  if (pattern.value.kind === "IntLiteral" && scrutineeType.kind === "Int64") {
    const val = pattern.value.value;
    const low = Number(val & BigInt(0xFFFFFFFF));
    const high = Number((val >> BigInt(32)) & BigInt(0xFFFFFFFF));
    return ctx.mod.i64.eq(scrutinee, ctx.mod.i64.const(low, high));
  }
  if (pattern.value.kind === "BoolLiteral") {
    return ctx.mod.i32.eq(scrutinee, ctx.mod.i32.const(pattern.value.value ? 1 : 0));
  }
  if (pattern.value.kind === "StringLiteral" && scrutineeType.kind === "String") {
    const ptr = ctx.allocStringLiteral(pattern.value.value);
    return ctx.mod.call("string_eq", [scrutinee, ctx.mod.i32.const(ptr)], binaryen.i32);
  }
  return ctx.mod.i32.const(1);
}

export function generateRangePatternCondition(
  ctx: MatchContext,
  getScrutinee: () => binaryen.ExpressionRef,
  pattern: RangePattern,
): binaryen.ExpressionRef {
  const startVal = pattern.start.value;
  const endVal = pattern.end.value;
  const startLow = Number(startVal & BigInt(0xFFFFFFFF));
  const startHigh = Number((startVal >> BigInt(32)) & BigInt(0xFFFFFFFF));
  const endLow = Number(endVal & BigInt(0xFFFFFFFF));
  const endHigh = Number((endVal >> BigInt(32)) & BigInt(0xFFFFFFFF));
  const gteStart = ctx.mod.i64.ge_s(getScrutinee(), ctx.mod.i64.const(startLow, startHigh));
  const lteEnd = ctx.mod.i64.le_s(getScrutinee(), ctx.mod.i64.const(endLow, endHigh));
  return ctx.mod.i32.and(gteStart, lteEnd);
}
