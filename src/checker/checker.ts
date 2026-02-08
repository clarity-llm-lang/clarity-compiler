import type { Diagnostic, Span } from "../errors/diagnostic.js";
import { error } from "../errors/diagnostic.js";
import type {
  ModuleDecl, Declaration, FunctionDecl, TypeDecl, ConstDecl,
  Expr, Pattern, TypeNode, TypeExpr,
} from "../ast/nodes.js";
import {
  type ClarityType, type ClarityVariant,
  INT64, FLOAT64, STRING, BOOL, UNIT, ERROR_TYPE,
  resolveBuiltinType, typesEqual, typeToString,
} from "./types.js";
import { Environment } from "./environment.js";
import { validateEffectNames, checkEffectSafety } from "./effects.js";
import { checkExhaustiveness } from "./exhaustiveness.js";

export class Checker {
  private env: Environment = new Environment();
  private diagnostics: Diagnostic[] = [];
  private currentEffects: Set<string> = new Set();

  check(module: ModuleDecl): Diagnostic[] {
    this.diagnostics = [];

    // First pass: register all type declarations
    for (const decl of module.declarations) {
      if (decl.kind === "TypeDecl") {
        this.registerTypeDecl(decl);
      }
    }

    // Second pass: register all function signatures (allows mutual recursion)
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        this.registerFunctionSignature(decl);
      }
    }

    // Third pass: check function bodies and const declarations
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        this.checkFunctionBody(decl);
      } else if (decl.kind === "ConstDecl") {
        this.checkConstDecl(decl);
      }
    }

    return this.diagnostics;
  }

  // ============================================================
  // Type Registration
  // ============================================================

  private registerTypeDecl(decl: TypeDecl): void {
    const type = this.resolveTypeExpr(decl.typeExpr, decl.name);
    if (type) {
      this.env.defineType(decl.name, type);

      // If it's a union type, register variant constructors as functions
      if (type.kind === "Union") {
        for (const variant of type.variants) {
          const paramTypes = [...variant.fields.values()];
          const fnType: ClarityType = {
            kind: "Function",
            params: paramTypes,
            returnType: type,
            effects: new Set(),
          };
          this.env.define(variant.name, {
            name: variant.name,
            type: fnType,
            mutable: false,
            defined: decl.span,
          });
        }
      }
    }
  }

  private resolveTypeExpr(expr: TypeExpr, name: string): ClarityType | null {
    switch (expr.kind) {
      case "RecordType": {
        const fields = new Map<string, ClarityType>();
        for (const field of expr.fields) {
          const ft = this.resolveTypeRef(field.typeAnnotation);
          if (ft) fields.set(field.name, ft);
        }
        return { kind: "Record", name, fields };
      }

      case "UnionType": {
        const variants: ClarityVariant[] = [];
        for (const v of expr.variants) {
          const fields = new Map<string, ClarityType>();
          for (const field of v.fields) {
            const ft = this.resolveTypeRef(field.typeAnnotation);
            if (ft) fields.set(field.name, ft);
          }
          variants.push({ name: v.name, fields });
        }
        return { kind: "Union", name, variants };
      }

      case "TypeRef":
        return this.resolveTypeRef(expr);
    }
  }

  resolveTypeRef(node: TypeNode): ClarityType | null {
    // Check built-in types
    const builtin = resolveBuiltinType(node.name);
    if (builtin) return builtin;

    // Check user-defined types
    const userType = this.env.lookupType(node.name);
    if (userType) return userType;

    // Check generic built-ins
    if (node.name === "List" && node.typeArgs.length === 1) {
      const elem = this.resolveTypeRef(node.typeArgs[0]);
      if (elem) return { kind: "List", element: elem };
    }
    if (node.name === "Option" && node.typeArgs.length === 1) {
      const inner = this.resolveTypeRef(node.typeArgs[0]);
      if (inner) return { kind: "Option", inner };
    }

    this.diagnostics.push(error(`Unknown type '${node.name}'`, node.span));
    return null;
  }

  // ============================================================
  // Function Registration & Checking
  // ============================================================

  private registerFunctionSignature(decl: FunctionDecl): void {
    // Validate effect names
    this.diagnostics.push(...validateEffectNames(decl.effects, decl.span));

    const paramTypes: ClarityType[] = [];
    for (const param of decl.params) {
      const t = this.resolveTypeRef(param.typeAnnotation);
      paramTypes.push(t ?? ERROR_TYPE);
    }

    const returnType = this.resolveTypeRef(decl.returnType) ?? ERROR_TYPE;

    const fnType: ClarityType = {
      kind: "Function",
      params: paramTypes,
      returnType,
      effects: new Set(decl.effects),
    };

    this.env.define(decl.name, {
      name: decl.name,
      type: fnType,
      mutable: false,
      defined: decl.span,
    });
  }

  private checkFunctionBody(decl: FunctionDecl): void {
    this.env.enterScope();
    this.currentEffects = new Set(decl.effects);

    // Define parameters in scope
    for (const param of decl.params) {
      const t = this.resolveTypeRef(param.typeAnnotation) ?? ERROR_TYPE;
      this.env.define(param.name, {
        name: param.name,
        type: t,
        mutable: false,
        defined: param.span,
      });
    }

    const expectedReturn = this.resolveTypeRef(decl.returnType) ?? ERROR_TYPE;
    const bodyType = this.checkExpr(decl.body);

    if (bodyType && !typesEqual(bodyType, expectedReturn)) {
      this.diagnostics.push(
        error(
          `Function '${decl.name}' returns ${typeToString(bodyType)} but declared return type is ${typeToString(expectedReturn)}`,
          decl.body.span,
        ),
      );
    }

    this.env.exitScope();
    this.currentEffects = new Set();
  }

  private checkConstDecl(decl: ConstDecl): void {
    const expectedType = this.resolveTypeRef(decl.typeAnnotation) ?? ERROR_TYPE;
    const actualType = this.checkExpr(decl.value);

    if (actualType && !typesEqual(actualType, expectedType)) {
      this.diagnostics.push(
        error(
          `Constant '${decl.name}' has type ${typeToString(actualType)} but declared type is ${typeToString(expectedType)}`,
          decl.value.span,
        ),
      );
    }

    this.env.define(decl.name, {
      name: decl.name,
      type: expectedType,
      mutable: false,
      defined: decl.span,
    });
  }

  // ============================================================
  // Expression Type Checking
  // ============================================================

  checkExpr(expr: Expr): ClarityType {
    switch (expr.kind) {
      case "IntLiteral": return INT64;
      case "FloatLiteral": return FLOAT64;
      case "StringLiteral": return STRING;
      case "BoolLiteral": return BOOL;

      case "IdentifierExpr": {
        if (expr.name === "<error>") return ERROR_TYPE;
        const sym = this.env.lookup(expr.name);
        if (!sym) {
          this.diagnostics.push(error(`Undefined variable '${expr.name}'`, expr.span));
          return ERROR_TYPE;
        }
        return sym.type;
      }

      case "BinaryExpr": {
        const leftType = this.checkExpr(expr.left);
        const rightType = this.checkExpr(expr.right);
        return this.checkBinaryOp(expr.op, leftType, rightType, expr.span);
      }

      case "UnaryExpr": {
        const operandType = this.checkExpr(expr.operand);
        return this.checkUnaryOp(expr.op, operandType, expr.span);
      }

      case "CallExpr": {
        const calleeType = this.checkExpr(expr.callee);
        if (calleeType.kind === "Error") return ERROR_TYPE;

        if (calleeType.kind !== "Function") {
          this.diagnostics.push(
            error(`Cannot call non-function type ${typeToString(calleeType)}`, expr.callee.span),
          );
          return ERROR_TYPE;
        }

        // Check argument count
        if (expr.args.length !== calleeType.params.length) {
          this.diagnostics.push(
            error(
              `Expected ${calleeType.params.length} arguments but got ${expr.args.length}`,
              expr.span,
            ),
          );
          return calleeType.returnType;
        }

        // Check argument types
        for (let i = 0; i < expr.args.length; i++) {
          const argType = this.checkExpr(expr.args[i].value);
          if (!typesEqual(argType, calleeType.params[i])) {
            this.diagnostics.push(
              error(
                `Argument ${i + 1}: expected ${typeToString(calleeType.params[i])} but got ${typeToString(argType)}`,
                expr.args[i].span,
              ),
            );
          }
        }

        // Check effects
        this.diagnostics.push(
          ...checkEffectSafety(this.currentEffects, calleeType.effects, expr.span),
        );

        return calleeType.returnType;
      }

      case "MemberExpr": {
        const objType = this.checkExpr(expr.object);
        if (objType.kind === "Error") return ERROR_TYPE;

        if (objType.kind === "Record") {
          const fieldType = objType.fields.get(expr.member);
          if (!fieldType) {
            this.diagnostics.push(
              error(`Record '${objType.name}' has no field '${expr.member}'`, expr.span),
            );
            return ERROR_TYPE;
          }
          return fieldType;
        }

        this.diagnostics.push(
          error(`Cannot access member '${expr.member}' on type ${typeToString(objType)}`, expr.span),
        );
        return ERROR_TYPE;
      }

      case "MatchExpr": {
        const scrutineeType = this.checkExpr(expr.scrutinee);

        // Check exhaustiveness
        this.diagnostics.push(
          ...checkExhaustiveness(
            scrutineeType,
            expr.arms.map((a) => a.pattern),
            expr.span,
          ),
        );

        let resultType: ClarityType | null = null;
        for (const arm of expr.arms) {
          this.env.enterScope();
          this.checkPattern(arm.pattern, scrutineeType);
          const armType = this.checkExpr(arm.body);
          this.env.exitScope();

          if (resultType === null) {
            resultType = armType;
          } else if (!typesEqual(armType, resultType)) {
            this.diagnostics.push(
              error(
                `Match arm returns ${typeToString(armType)} but previous arm returns ${typeToString(resultType)}`,
                arm.body.span,
                "All match arms must return the same type",
              ),
            );
          }
        }

        return resultType ?? ERROR_TYPE;
      }

      case "LetExpr": {
        const valueType = this.checkExpr(expr.value);

        if (expr.typeAnnotation) {
          const annotType = this.resolveTypeRef(expr.typeAnnotation);
          if (annotType && !typesEqual(valueType, annotType)) {
            this.diagnostics.push(
              error(
                `Let binding type mismatch: expected ${typeToString(annotType)} but got ${typeToString(valueType)}`,
                expr.value.span,
              ),
            );
          }
        }

        if (expr.name !== "_") {
          this.env.define(expr.name, {
            name: expr.name,
            type: valueType,
            mutable: expr.mutable,
            defined: expr.span,
          });
        }

        return UNIT;
      }

      case "BlockExpr": {
        this.env.enterScope();
        for (const stmt of expr.statements) {
          this.checkExpr(stmt);
        }
        const resultType = expr.result ? this.checkExpr(expr.result) : UNIT;
        this.env.exitScope();
        return resultType;
      }

      case "ListLiteral": {
        if (expr.elements.length === 0) {
          return { kind: "List", element: ERROR_TYPE };
        }
        const firstType = this.checkExpr(expr.elements[0]);
        for (let i = 1; i < expr.elements.length; i++) {
          const elemType = this.checkExpr(expr.elements[i]);
          if (!typesEqual(elemType, firstType)) {
            this.diagnostics.push(
              error(
                `List element type mismatch: expected ${typeToString(firstType)} but got ${typeToString(elemType)}`,
                expr.elements[i].span,
              ),
            );
          }
        }
        return { kind: "List", element: firstType };
      }

      default:
        return ERROR_TYPE;
    }
  }

  // ============================================================
  // Pattern Checking
  // ============================================================

  private checkPattern(pattern: Pattern, expectedType: ClarityType): void {
    switch (pattern.kind) {
      case "WildcardPattern":
        break;

      case "BindingPattern":
        this.env.define(pattern.name, {
          name: pattern.name,
          type: expectedType,
          mutable: false,
          defined: pattern.span,
        });
        break;

      case "LiteralPattern": {
        const litType = this.checkExpr(pattern.value);
        if (!typesEqual(litType, expectedType)) {
          this.diagnostics.push(
            error(
              `Pattern type mismatch: expected ${typeToString(expectedType)} but got ${typeToString(litType)}`,
              pattern.span,
            ),
          );
        }
        break;
      }

      case "ConstructorPattern": {
        if (expectedType.kind === "Union") {
          const variant = expectedType.variants.find((v) => v.name === pattern.name);
          if (!variant) {
            this.diagnostics.push(
              error(
                `Unknown variant '${pattern.name}' for type '${expectedType.name}'`,
                pattern.span,
              ),
            );
            return;
          }

          const fieldEntries = [...variant.fields.entries()];
          if (pattern.fields.length !== fieldEntries.length) {
            this.diagnostics.push(
              error(
                `Variant '${pattern.name}' has ${fieldEntries.length} field(s) but pattern has ${pattern.fields.length}`,
                pattern.span,
              ),
            );
            return;
          }

          for (let i = 0; i < pattern.fields.length; i++) {
            const fieldName = pattern.fields[i].name ?? fieldEntries[i][0];
            const fieldType = variant.fields.get(fieldName);
            if (fieldType) {
              this.checkPattern(pattern.fields[i].pattern, fieldType);
            }
          }
        } else {
          this.diagnostics.push(
            error(
              `Cannot use constructor pattern on non-union type ${typeToString(expectedType)}`,
              pattern.span,
            ),
          );
        }
        break;
      }
    }
  }

  // ============================================================
  // Operator Checking
  // ============================================================

  private checkBinaryOp(
    op: string,
    left: ClarityType,
    right: ClarityType,
    span: Span,
  ): ClarityType {
    if (left.kind === "Error" || right.kind === "Error") return ERROR_TYPE;

    // Arithmetic: +, -, *, /, %
    if (["+", "-", "*", "/", "%"].includes(op)) {
      if (left.kind === "Int64" && right.kind === "Int64") return INT64;
      if (left.kind === "Float64" && right.kind === "Float64") return FLOAT64;
      // Allow Int64 + Float64 -> Float64
      if (
        (left.kind === "Int64" && right.kind === "Float64") ||
        (left.kind === "Float64" && right.kind === "Int64")
      ) {
        this.diagnostics.push(
          error(
            `Cannot mix Int64 and Float64 in arithmetic`,
            span,
            "Clarity does not have implicit numeric conversions. Convert explicitly.",
          ),
        );
        return ERROR_TYPE;
      }
      this.diagnostics.push(
        error(`Operator '${op}' requires numeric types, got ${typeToString(left)} and ${typeToString(right)}`, span),
      );
      return ERROR_TYPE;
    }

    // String concat: ++
    if (op === "++") {
      if (left.kind === "String" && right.kind === "String") return STRING;
      this.diagnostics.push(
        error(`Operator '++' requires String types, got ${typeToString(left)} and ${typeToString(right)}`, span),
      );
      return ERROR_TYPE;
    }

    // Comparison: ==, !=, <, >, <=, >=
    if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
      if (!typesEqual(left, right)) {
        this.diagnostics.push(
          error(
            `Cannot compare ${typeToString(left)} and ${typeToString(right)}`,
            span,
            "Both sides of a comparison must have the same type",
          ),
        );
        return ERROR_TYPE;
      }
      return BOOL;
    }

    // Logical: and, or
    if (op === "and" || op === "or") {
      if (left.kind === "Bool" && right.kind === "Bool") return BOOL;
      this.diagnostics.push(
        error(`Operator '${op}' requires Bool types, got ${typeToString(left)} and ${typeToString(right)}`, span),
      );
      return ERROR_TYPE;
    }

    this.diagnostics.push(error(`Unknown operator '${op}'`, span));
    return ERROR_TYPE;
  }

  private checkUnaryOp(op: string, operand: ClarityType, span: Span): ClarityType {
    if (operand.kind === "Error") return ERROR_TYPE;

    if (op === "-") {
      if (operand.kind === "Int64") return INT64;
      if (operand.kind === "Float64") return FLOAT64;
      this.diagnostics.push(
        error(`Unary '-' requires numeric type, got ${typeToString(operand)}`, span),
      );
      return ERROR_TYPE;
    }

    if (op === "!") {
      if (operand.kind === "Bool") return BOOL;
      this.diagnostics.push(
        error(`Unary '!' requires Bool type, got ${typeToString(operand)}`, span),
      );
      return ERROR_TYPE;
    }

    return ERROR_TYPE;
  }
}
