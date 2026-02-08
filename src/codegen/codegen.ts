import binaryen from "binaryen";
import type {
  ModuleDecl, FunctionDecl, Expr, BinaryOp, UnaryOp,
} from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
import { INT64, FLOAT64, BOOL, UNIT } from "../checker/types.js";
import { Checker } from "../checker/checker.js";
import { clarityTypeToWasm } from "./wasm-types.js";

interface LocalVar {
  index: number;
  wasmType: binaryen.Type;
  clarityType: ClarityType;
}

export class CodeGenerator {
  private mod!: binaryen.Module;
  private locals!: Map<string, LocalVar>;
  private localIndex!: number;
  private additionalLocals!: binaryen.Type[];
  private checker!: Checker;
  private currentFunction!: FunctionDecl;

  generate(module: ModuleDecl, checker: Checker): Uint8Array {
    this.mod = new binaryen.Module();
    this.checker = checker;

    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        this.generateFunction(decl);
      }
    }

    if (!this.mod.validate()) {
      throw new Error("Generated invalid WASM module");
    }

    this.mod.optimize();
    return this.mod.emitBinary();
  }

  generateText(module: ModuleDecl, checker: Checker): string {
    this.mod = new binaryen.Module();
    this.checker = checker;

    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        this.generateFunction(decl);
      }
    }

    this.mod.validate();
    return this.mod.emitText();
  }

  private generateFunction(decl: FunctionDecl): void {
    this.currentFunction = decl;
    this.locals = new Map();
    this.localIndex = 0;
    this.additionalLocals = [];

    // Register params as locals
    const paramWasmTypes: binaryen.Type[] = [];
    for (const param of decl.params) {
      const clarityType = this.checker.resolveTypeRef(param.typeAnnotation);
      const ct = clarityType ?? INT64;
      const wasmType = clarityTypeToWasm(ct);
      this.locals.set(param.name, {
        index: this.localIndex,
        wasmType,
        clarityType: ct,
      });
      paramWasmTypes.push(wasmType);
      this.localIndex++;
    }

    const returnClarityType = this.checker.resolveTypeRef(decl.returnType) ?? UNIT;
    const returnWasmType = clarityTypeToWasm(returnClarityType);
    const paramsType = binaryen.createType(paramWasmTypes);

    // Generate body
    const body = this.generateExpr(decl.body, returnClarityType);

    // Add function
    this.mod.addFunction(
      decl.name,
      paramsType,
      returnWasmType,
      this.additionalLocals,
      body,
    );
    this.mod.addFunctionExport(decl.name, decl.name);
  }

  private generateExpr(expr: Expr, expectedType?: ClarityType): binaryen.ExpressionRef {
    switch (expr.kind) {
      case "IntLiteral": {
        // binaryen i64.const takes low and high 32-bit parts
        const val = expr.value;
        const low = Number(val & BigInt(0xFFFFFFFF));
        const high = Number((val >> BigInt(32)) & BigInt(0xFFFFFFFF));
        return this.mod.i64.const(low, high);
      }

      case "FloatLiteral":
        return this.mod.f64.const(expr.value);

      case "BoolLiteral":
        return this.mod.i32.const(expr.value ? 1 : 0);

      case "StringLiteral":
        // MVP: strings not fully supported in WASM yet
        // Return a dummy i32 pointer
        return this.mod.i32.const(0);

      case "IdentifierExpr": {
        const local = this.locals.get(expr.name);
        if (!local) {
          throw new Error(`Undefined variable in codegen: ${expr.name}`);
        }
        return this.mod.local.get(local.index, local.wasmType);
      }

      case "BinaryExpr":
        return this.generateBinary(expr.op, expr.left, expr.right);

      case "UnaryExpr":
        return this.generateUnary(expr.op, expr.operand);

      case "CallExpr": {
        if (expr.callee.kind !== "IdentifierExpr") {
          throw new Error("Only direct function calls supported in MVP");
        }
        const args = expr.args.map((a) => this.generateExpr(a.value));
        return this.mod.call(expr.callee.name, args, this.inferWasmReturnType(expr.callee.name));
      }

      case "MatchExpr":
        return this.generateMatch(expr, expectedType);

      case "LetExpr": {
        const value = this.generateExpr(expr.value);
        if (expr.name === "_") {
          return this.mod.drop(value);
        }
        // Allocate a new local
        const clarityType = this.inferExprType(expr.value);
        const wasmType = clarityTypeToWasm(clarityType);
        const index = this.localIndex++;
        this.additionalLocals.push(wasmType);
        this.locals.set(expr.name, { index, wasmType, clarityType });
        return this.mod.local.set(index, value);
      }

      case "BlockExpr": {
        const stmts: binaryen.ExpressionRef[] = [];
        for (const stmt of expr.statements) {
          const generated = this.generateExpr(stmt);
          // Let expressions return void, others need to be dropped
          if (stmt.kind !== "LetExpr") {
            stmts.push(this.mod.drop(generated));
          } else {
            stmts.push(generated);
          }
        }
        if (expr.result) {
          stmts.push(this.generateExpr(expr.result, expectedType));
        }

        if (stmts.length === 0) return this.mod.nop();
        if (stmts.length === 1) return stmts[0];

        // Determine the block's result type from the last expression
        const resultType = expr.result
          ? clarityTypeToWasm(this.inferExprType(expr.result))
          : binaryen.none;
        return this.mod.block(null, stmts, resultType);
      }

      case "ListLiteral":
        // MVP: lists not supported in WASM yet
        return this.mod.i32.const(0);

      case "MemberExpr":
        // MVP: member access not supported yet
        return this.mod.i32.const(0);

      default:
        throw new Error(`Unsupported expression kind in codegen: ${(expr as any).kind}`);
    }
  }

  private generateBinary(
    op: BinaryOp,
    left: Expr,
    right: Expr,
  ): binaryen.ExpressionRef {
    const leftExpr = this.generateExpr(left);
    const rightExpr = this.generateExpr(right);
    const leftType = this.inferExprType(left);

    if (leftType.kind === "Int64") {
      switch (op) {
        case "+": return this.mod.i64.add(leftExpr, rightExpr);
        case "-": return this.mod.i64.sub(leftExpr, rightExpr);
        case "*": return this.mod.i64.mul(leftExpr, rightExpr);
        case "/": return this.mod.i64.div_s(leftExpr, rightExpr);
        case "%": return this.mod.i64.rem_s(leftExpr, rightExpr);
        case "==": return this.mod.i64.eq(leftExpr, rightExpr);
        case "!=": return this.mod.i64.ne(leftExpr, rightExpr);
        case "<": return this.mod.i64.lt_s(leftExpr, rightExpr);
        case ">": return this.mod.i64.gt_s(leftExpr, rightExpr);
        case "<=": return this.mod.i64.le_s(leftExpr, rightExpr);
        case ">=": return this.mod.i64.ge_s(leftExpr, rightExpr);
      }
    }

    if (leftType.kind === "Float64") {
      switch (op) {
        case "+": return this.mod.f64.add(leftExpr, rightExpr);
        case "-": return this.mod.f64.sub(leftExpr, rightExpr);
        case "*": return this.mod.f64.mul(leftExpr, rightExpr);
        case "/": return this.mod.f64.div(leftExpr, rightExpr);
        case "==": return this.mod.f64.eq(leftExpr, rightExpr);
        case "!=": return this.mod.f64.ne(leftExpr, rightExpr);
        case "<": return this.mod.f64.lt(leftExpr, rightExpr);
        case ">": return this.mod.f64.gt(leftExpr, rightExpr);
        case "<=": return this.mod.f64.le(leftExpr, rightExpr);
        case ">=": return this.mod.f64.ge(leftExpr, rightExpr);
      }
    }

    if (leftType.kind === "Bool") {
      switch (op) {
        case "and": return this.mod.i32.and(leftExpr, rightExpr);
        case "or": return this.mod.i32.or(leftExpr, rightExpr);
        case "==": return this.mod.i32.eq(leftExpr, rightExpr);
        case "!=": return this.mod.i32.ne(leftExpr, rightExpr);
      }
    }

    throw new Error(`Unsupported binary op '${op}' for type ${leftType.kind}`);
  }

  private generateUnary(op: UnaryOp, operand: Expr): binaryen.ExpressionRef {
    const expr = this.generateExpr(operand);
    const type = this.inferExprType(operand);

    if (op === "-") {
      if (type.kind === "Int64") {
        return this.mod.i64.sub(this.mod.i64.const(0, 0), expr);
      }
      if (type.kind === "Float64") {
        return this.mod.f64.neg(expr);
      }
    }

    if (op === "!") {
      if (type.kind === "Bool") {
        return this.mod.i32.xor(expr, this.mod.i32.const(1));
      }
    }

    throw new Error(`Unsupported unary op '${op}' for type ${type.kind}`);
  }

  private generateMatch(
    matchExpr: import("../ast/nodes.js").MatchExpr,
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    const scrutinee = this.generateExpr(matchExpr.scrutinee);
    const scrutineeType = this.inferExprType(matchExpr.scrutinee);

    // Bool match → if/else chain
    if (scrutineeType.kind === "Bool") {
      return this.generateBoolMatch(scrutinee, matchExpr.arms, expectedType);
    }

    // For other types, fall back to if/else chain on equality
    // This handles Int64 patterns etc.
    return this.generateGenericMatch(scrutinee, scrutineeType, matchExpr.arms, expectedType);
  }

  private generateBoolMatch(
    scrutinee: binaryen.ExpressionRef,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    // Find True and False arms
    let trueBody: binaryen.ExpressionRef | null = null;
    let falseBody: binaryen.ExpressionRef | null = null;
    let wildcardBody: binaryen.ExpressionRef | null = null;

    for (const arm of arms) {
      if (arm.pattern.kind === "LiteralPattern" && arm.pattern.value.kind === "BoolLiteral") {
        if (arm.pattern.value.value) {
          trueBody = this.generateExpr(arm.body, expectedType);
        } else {
          falseBody = this.generateExpr(arm.body, expectedType);
        }
      } else if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        wildcardBody = this.generateExpr(arm.body, expectedType);
      }
    }

    const resultType = expectedType ? clarityTypeToWasm(expectedType) : binaryen.i64;
    const ifTrue = trueBody ?? wildcardBody ?? this.mod.unreachable();
    const ifFalse = falseBody ?? wildcardBody ?? this.mod.unreachable();

    return this.mod.if(scrutinee, ifTrue, ifFalse);
  }

  private generateGenericMatch(
    scrutinee: binaryen.ExpressionRef,
    scrutineeType: ClarityType,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    // Store scrutinee in a temp local to avoid re-evaluation
    const wasmType = clarityTypeToWasm(scrutineeType);
    const tempIndex = this.localIndex++;
    this.additionalLocals.push(wasmType);
    const setTemp = this.mod.local.set(tempIndex, scrutinee);
    const getTemp = () => this.mod.local.get(tempIndex, wasmType);

    // Build if/else chain from bottom up
    let result: binaryen.ExpressionRef = this.mod.unreachable();

    for (let i = arms.length - 1; i >= 0; i--) {
      const arm = arms[i];
      const body = this.generateExpr(arm.body, expectedType);

      if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        if (arm.pattern.kind === "BindingPattern") {
          // Bind the scrutinee value to the pattern variable
          const bindIndex = this.localIndex++;
          this.additionalLocals.push(wasmType);
          this.locals.set(arm.pattern.name, {
            index: bindIndex,
            wasmType,
            clarityType: scrutineeType,
          });
          result = this.mod.block(null, [
            this.mod.local.set(bindIndex, getTemp()),
            body,
          ]);
        } else {
          result = body;
        }
      } else if (arm.pattern.kind === "LiteralPattern") {
        const cond = this.generatePatternCondition(getTemp(), arm.pattern, scrutineeType);
        result = this.mod.if(cond, body, result);
      }
    }

    return this.mod.block(null, [setTemp, result]);
  }

  private generatePatternCondition(
    scrutinee: binaryen.ExpressionRef,
    pattern: import("../ast/nodes.js").LiteralPattern,
    scrutineeType: ClarityType,
  ): binaryen.ExpressionRef {
    if (pattern.value.kind === "IntLiteral" && scrutineeType.kind === "Int64") {
      const val = pattern.value.value;
      const low = Number(val & BigInt(0xFFFFFFFF));
      const high = Number((val >> BigInt(32)) & BigInt(0xFFFFFFFF));
      return this.mod.i64.eq(scrutinee, this.mod.i64.const(low, high));
    }
    if (pattern.value.kind === "BoolLiteral") {
      return this.mod.i32.eq(scrutinee, this.mod.i32.const(pattern.value.value ? 1 : 0));
    }
    return this.mod.i32.const(1); // fallback: always match
  }

  // ============================================================
  // Type Inference Helpers (for codegen - uses checker data)
  // ============================================================

  private inferExprType(expr: Expr): ClarityType {
    switch (expr.kind) {
      case "IntLiteral": return INT64;
      case "FloatLiteral": return FLOAT64;
      case "BoolLiteral": return BOOL;
      case "StringLiteral": return { kind: "String" };

      case "IdentifierExpr": {
        const local = this.locals.get(expr.name);
        if (local) return local.clarityType;
        return INT64; // fallback
      }

      case "BinaryExpr": {
        const leftType = this.inferExprType(expr.left);
        if (["==", "!=", "<", ">", "<=", ">="].includes(expr.op)) return BOOL;
        if (expr.op === "and" || expr.op === "or") return BOOL;
        if (expr.op === "++") return { kind: "String" };
        return leftType;
      }

      case "UnaryExpr": {
        if (expr.op === "!") return BOOL;
        return this.inferExprType(expr.operand);
      }

      case "CallExpr": {
        // Look up function return type from checker
        if (expr.callee.kind === "IdentifierExpr") {
          return this.inferFunctionReturnType(expr.callee.name);
        }
        return INT64;
      }

      case "MatchExpr": {
        if (expr.arms.length > 0) {
          return this.inferExprType(expr.arms[0].body);
        }
        return UNIT;
      }

      case "LetExpr": return UNIT;

      case "BlockExpr": {
        if (expr.result) return this.inferExprType(expr.result);
        return UNIT;
      }

      default: return INT64;
    }
  }

  private inferFunctionReturnType(name: string): ClarityType {
    // Check if it's the current function (recursion)
    if (name === this.currentFunction.name) {
      return this.checker.resolveTypeRef(this.currentFunction.returnType) ?? INT64;
    }
    // Otherwise we'd need to look it up from the checker's environment
    // For MVP, infer from the function declarations
    return INT64; // fallback
  }

  private inferWasmReturnType(name: string): binaryen.Type {
    const clarityType = this.inferFunctionReturnType(name);
    return clarityTypeToWasm(clarityType);
  }
}
