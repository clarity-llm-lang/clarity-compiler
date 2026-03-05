// ---------------------------------------------------------------------------
// Tail call optimization (TCO) helpers.
// Extracted from codegen.ts to keep file sizes under the 600-line limit.
// ---------------------------------------------------------------------------
import binaryen from "binaryen";
import type { Expr, FunctionDecl, MatchArm, MatchExpr, CallExpr } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
import { clarityTypeToWasm } from "./wasm-types.js";
import {
  recordLayout as _recordLayout,
  loadField as _loadField,
} from "./codegen-memory.js";
import {
  generateBoolMatch,
  generatePatternCondition,
  generateRangePatternCondition,
  type MatchContext,
} from "./codegen-match.js";

export interface TcoContext {
  readonly mod: binaryen.Module;
  locals: Map<string, { index: number; wasmType: binaryen.Type; clarityType: ClarityType }>;
  localIndex: number;
  additionalLocals: binaryen.Type[];
  currentFunction: FunctionDecl;
  readonly allTypeDecls: Map<string, ClarityType>;
  generateExpr: (expr: Expr, expectedType?: ClarityType) => binaryen.ExpressionRef;
  inferExprType: (expr: Expr) => ClarityType;
  allocStringLiteral: (value: string) => number;
}

function makeMatchCtx(ctx: TcoContext): MatchContext {
  return ctx as unknown as MatchContext;
}

function recordLayout(fields: Map<string, ClarityType>) {
  return _recordLayout(fields);
}

function loadField(mod: binaryen.Module, basePtr: binaryen.ExpressionRef, offset: number, type: ClarityType) {
  return _loadField(mod, basePtr, offset, type);
}

// Check if an expression contains a self-recursive tail call
export function isTailRecursive(expr: Expr, funcName: string): boolean {
  switch (expr.kind) {
    case "CallExpr":
      return expr.callee.kind === "IdentifierExpr" && expr.callee.name === funcName;
    case "BlockExpr":
      if (expr.result) return isTailRecursive(expr.result, funcName);
      return false;
    case "MatchExpr":
      return expr.arms.some(arm => isTailRecursive(arm.body, funcName));
    default:
      return false;
  }
}

// Generate a loop-based body for a tail-recursive function
export function generateTailRecursiveBody(
  ctx: TcoContext,
  decl: FunctionDecl,
  returnClarityType: ClarityType,
  returnWasmType: binaryen.Type,
): binaryen.ExpressionRef {
  const loopLabel = `$tco_${decl.name}`;
  const innerBody = generateExprTCO(ctx, decl.body, returnClarityType, decl.name, loopLabel);
  return ctx.mod.loop(loopLabel, innerBody);
}

// Generate an expression with tail-call optimization awareness
export function generateExprTCO(
  ctx: TcoContext,
  expr: Expr,
  expectedType: ClarityType | undefined,
  funcName: string,
  loopLabel: string,
): binaryen.ExpressionRef {
  switch (expr.kind) {
    case "CallExpr": {
      if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === funcName) {
        return generateTailCallUpdate(ctx, expr, funcName, loopLabel);
      }
      return ctx.generateExpr(expr, expectedType);
    }
    case "BlockExpr": {
      const stmts: binaryen.ExpressionRef[] = [];
      for (const stmt of expr.statements) {
        const generated = ctx.generateExpr(stmt);
        if (stmt.kind !== "LetExpr" && stmt.kind !== "AssignmentExpr") {
          const stmtType = ctx.inferExprType(stmt);
          if (stmtType.kind === "Unit") {
            stmts.push(generated);
          } else {
            stmts.push(ctx.mod.drop(generated));
          }
        } else {
          stmts.push(generated);
        }
      }
      if (expr.result) {
        stmts.push(generateExprTCO(ctx, expr.result, expectedType, funcName, loopLabel));
      }
      if (stmts.length === 0) return ctx.mod.nop();
      if (stmts.length === 1) return stmts[0];
      const resultType = expr.result
        ? clarityTypeToWasm(ctx.inferExprType(expr.result))
        : binaryen.none;
      return ctx.mod.block(null, stmts, resultType);
    }
    case "MatchExpr": {
      return generateMatchTCO(ctx, expr, expectedType, funcName, loopLabel);
    }
    default:
      return ctx.generateExpr(expr, expectedType);
  }
}

// Generate a tail call: update params and branch back to loop
export function generateTailCallUpdate(
  ctx: TcoContext,
  expr: CallExpr,
  funcName: string,
  loopLabel: string,
): binaryen.ExpressionRef {
  const decl = ctx.currentFunction;
  const stmts: binaryen.ExpressionRef[] = [];

  // First, evaluate all new argument values into temp locals
  const tempLocals: number[] = [];
  for (let i = 0; i < expr.args.length; i++) {
    const argExpr = ctx.generateExpr(expr.args[i].value);
    const paramLocal = ctx.locals.get(decl.params[i].name)!;
    const tempIdx = ctx.localIndex++;
    ctx.additionalLocals.push(paramLocal.wasmType);
    tempLocals.push(tempIdx);
    stmts.push(ctx.mod.local.set(tempIdx, argExpr));
  }

  // Then assign temps to param locals
  for (let i = 0; i < expr.args.length; i++) {
    const paramLocal = ctx.locals.get(decl.params[i].name)!;
    stmts.push(
      ctx.mod.local.set(
        paramLocal.index,
        ctx.mod.local.get(tempLocals[i], paramLocal.wasmType),
      ),
    );
  }

  stmts.push(ctx.mod.br(loopLabel));

  return ctx.mod.block(null, stmts, binaryen.none);
}

// Generate a match expression with TCO in arms
export function generateMatchTCO(
  ctx: TcoContext,
  matchExpr: MatchExpr,
  expectedType: ClarityType | undefined,
  funcName: string,
  loopLabel: string,
): binaryen.ExpressionRef {
  const scrutinee = ctx.generateExpr(matchExpr.scrutinee);
  const scrutineeType = ctx.inferExprType(matchExpr.scrutinee);

  if (scrutineeType.kind === "Bool") {
    return generateBoolMatchTCO(ctx, scrutinee, matchExpr.arms, expectedType, funcName, loopLabel);
  }

  if (scrutineeType.kind === "Union") {
    return generateUnionMatchTCO(ctx, scrutinee, scrutineeType as Extract<ClarityType, { kind: "Union" }>, matchExpr.arms, expectedType, funcName, loopLabel);
  }

  return generateGenericMatchTCO(ctx, scrutinee, scrutineeType, matchExpr.arms, expectedType, funcName, loopLabel);
}

export function generateBoolMatchTCO(
  ctx: TcoContext,
  scrutinee: binaryen.ExpressionRef,
  arms: MatchArm[],
  expectedType: ClarityType | undefined,
  funcName: string,
  loopLabel: string,
): binaryen.ExpressionRef {
  let trueBody: binaryen.ExpressionRef | null = null;
  let falseBody: binaryen.ExpressionRef | null = null;
  let wildcardBody: binaryen.ExpressionRef | null = null;

  for (const arm of arms) {
    if (arm.pattern.kind === "LiteralPattern" && arm.pattern.value.kind === "BoolLiteral") {
      if (arm.pattern.value.value) {
        trueBody = generateExprTCO(ctx, arm.body, expectedType, funcName, loopLabel);
      } else {
        falseBody = generateExprTCO(ctx, arm.body, expectedType, funcName, loopLabel);
      }
    } else if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
      wildcardBody = generateExprTCO(ctx, arm.body, expectedType, funcName, loopLabel);
    }
  }

  const ifTrue = trueBody ?? wildcardBody ?? ctx.mod.unreachable();
  const ifFalse = falseBody ?? wildcardBody ?? ctx.mod.unreachable();
  return ctx.mod.if(scrutinee, ifTrue, ifFalse);
}

export function generateUnionMatchTCO(
  ctx: TcoContext,
  scrutinee: binaryen.ExpressionRef,
  unionType: Extract<ClarityType, { kind: "Union" }>,
  arms: MatchArm[],
  expectedType: ClarityType | undefined,
  funcName: string,
  loopLabel: string,
): binaryen.ExpressionRef {
  const ptrLocal = ctx.localIndex++;
  ctx.additionalLocals.push(binaryen.i32);
  const setPtr = ctx.mod.local.set(ptrLocal, scrutinee);
  const getPtr = () => ctx.mod.local.get(ptrLocal, binaryen.i32);

  const tagLocal = ctx.localIndex++;
  ctx.additionalLocals.push(binaryen.i32);
  const setTag = ctx.mod.local.set(tagLocal, ctx.mod.i32.load(0, 4, getPtr()));
  const getTag = () => ctx.mod.local.get(tagLocal, binaryen.i32);

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
        result = ctx.mod.block(null, [
          ctx.mod.local.set(bindLocal, getPtr()),
          generateExprTCO(ctx, arm.body, expectedType, funcName, loopLabel),
        ]);
      } else {
        result = generateExprTCO(ctx, arm.body, expectedType, funcName, loopLabel);
      }
    } else if (arm.pattern.kind === "ConstructorPattern") {
      const ctorPattern = arm.pattern as import("../ast/nodes.js").ConstructorPattern;
      const variantIndex = unionType.variants.findIndex((v) => v.name === ctorPattern.name);
      if (variantIndex === -1) continue;
      const variant = unionType.variants[variantIndex];

      const layout = recordLayout(variant.fields);
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
      for (let fi = 0; fi < arm.pattern.fields.length && fi < fieldEntries.length; fi++) {
        const pat = arm.pattern.fields[fi];
        if (pat.pattern.kind === "BindingPattern") {
          const fieldType = fieldEntries[fi][1];
          const fieldOffset = layout[fi].offset + 8;
          const local = ctx.locals.get(pat.pattern.name)!;
          bodyStmts.push(
            ctx.mod.local.set(local.index, loadField(ctx.mod, getPtr(), fieldOffset, fieldType)),
          );
        }
      }

      bodyStmts.push(generateExprTCO(ctx, arm.body, expectedType, funcName, loopLabel));

      const bodyBlock = bodyStmts.length === 1
        ? bodyStmts[0]
        : ctx.mod.block(null, bodyStmts, expectedType ? clarityTypeToWasm(expectedType) : undefined);

      const cond = ctx.mod.i32.eq(getTag(), ctx.mod.i32.const(variantIndex));
      result = ctx.mod.if(cond, bodyBlock, result);
    }
  }

  const numVariantsTCO = unionType.variants.length;
  const boundsCheckTCO = ctx.mod.if(
    ctx.mod.i32.ge_u(getTag(), ctx.mod.i32.const(numVariantsTCO)),
    ctx.mod.unreachable(),
  );

  const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
  return ctx.mod.block(null, [setPtr, setTag, boundsCheckTCO, result], matchResultType);
}

export function generateGenericMatchTCO(
  ctx: TcoContext,
  scrutinee: binaryen.ExpressionRef,
  scrutineeType: ClarityType,
  arms: MatchArm[],
  expectedType: ClarityType | undefined,
  funcName: string,
  loopLabel: string,
): binaryen.ExpressionRef {
  const wasmType = clarityTypeToWasm(scrutineeType);
  const tempIndex = ctx.localIndex++;
  ctx.additionalLocals.push(wasmType);
  const setTemp = ctx.mod.local.set(tempIndex, scrutinee);
  const getTemp = () => ctx.mod.local.get(tempIndex, wasmType);

  let result: binaryen.ExpressionRef = ctx.mod.unreachable();

  for (let i = arms.length - 1; i >= 0; i--) {
    const arm = arms[i];
    const body = generateExprTCO(ctx, arm.body, expectedType, funcName, loopLabel);

    if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
      if (arm.pattern.kind === "BindingPattern") {
        const bindIndex = ctx.localIndex++;
        ctx.additionalLocals.push(wasmType);
        ctx.locals.set(arm.pattern.name, {
          index: bindIndex,
          wasmType,
          clarityType: scrutineeType,
        });
        result = ctx.mod.block(null, [
          ctx.mod.local.set(bindIndex, getTemp()),
          body,
        ]);
      } else {
        result = body;
      }
    } else if (arm.pattern.kind === "LiteralPattern") {
      const matchCtx: MatchContext = {
        mod: ctx.mod, locals: ctx.locals, localIndex: ctx.localIndex,
        additionalLocals: ctx.additionalLocals, allTypeDecls: ctx.allTypeDecls,
        generateExpr: ctx.generateExpr, inferExprType: ctx.inferExprType,
        allocStringLiteral: ctx.allocStringLiteral,
      };
      const cond = generatePatternCondition(matchCtx, getTemp(), arm.pattern, scrutineeType);
      result = ctx.mod.if(cond, body, result);
    } else if (arm.pattern.kind === "RangePattern") {
      const matchCtx: MatchContext = {
        mod: ctx.mod, locals: ctx.locals, localIndex: ctx.localIndex,
        additionalLocals: ctx.additionalLocals, allTypeDecls: ctx.allTypeDecls,
        generateExpr: ctx.generateExpr, inferExprType: ctx.inferExprType,
        allocStringLiteral: ctx.allocStringLiteral,
      };
      const cond = generateRangePatternCondition(matchCtx, getTemp, arm.pattern);
      result = ctx.mod.if(cond, body, result);
    }
  }

  const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
  return ctx.mod.block(null, [setTemp, result], matchResultType);
}
