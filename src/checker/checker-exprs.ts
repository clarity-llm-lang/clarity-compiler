// ---------------------------------------------------------------------------
// Expression and pattern type checking helpers extracted from the Checker class.
// The Checker passes itself as context since all methods here need the same state.
// ---------------------------------------------------------------------------
import type { Diagnostic } from "../errors/diagnostic.js";
import { error } from "../errors/diagnostic.js";
import type { Expr, Pattern, TypeNode } from "../ast/nodes.js";
import type { ClarityType } from "./types.js";
import {
  INT64, FLOAT64, STRING, BOOL, UNIT, ERROR_TYPE,
  typesEqual, typeToString, promoteType,
  containsTypeVar, substituteTypeVars, unifyTypes,
} from "./types.js";
import type { Environment } from "./environment.js";
import { checkEffectSafety } from "./effects.js";
import { checkExhaustiveness } from "./exhaustiveness.js";
import { collectFreeVars } from "./checker-freevars.js";
import { checkBinaryOp, checkUnaryOp } from "./checker-ops.js";

/** Minimal context that checkExprInner and checkPattern need from Checker. */
export interface CheckerContext {
  readonly env: Environment;
  readonly diagnostics: Diagnostic[];
  readonly currentEffects: Set<string>;
  makeOptionType(inner: ClarityType): ClarityType;
  makeResultType(okType: ClarityType, errType: ClarityType): ClarityType;
  resultToUnion(t: Extract<ClarityType, { kind: "Result" }>): ClarityType & { kind: "Union" };
  resolveTypeRef(node: TypeNode): ClarityType | null;
  findRecordType(
    fieldNames: Set<string>,
    fieldTypes?: Map<string, ClarityType>,
  ): (ClarityType & { kind: "Record" }) | null;
  checkExpr(expr: Expr): ClarityType;
  checkPattern(pattern: Pattern, expectedType: ClarityType): void;
}

export function checkExprInner(ctx: CheckerContext, expr: Expr): ClarityType {
  switch (expr.kind) {
    case "IntLiteral": return INT64;
    case "FloatLiteral": return FLOAT64;
    case "StringLiteral": return STRING;
    case "BoolLiteral": return BOOL;

    case "IdentifierExpr": {
      if (expr.name === "<error>") return ERROR_TYPE;
      // Special case: bare `Some` as identifier (not called) — it's a function
      if (expr.name === "Some") {
        const sym = ctx.env.lookup("Some");
        if (sym) return sym.type;
        // Not registered yet — return generic function type
        return { kind: "Function", params: [ERROR_TYPE], returnType: ctx.makeOptionType(ERROR_TYPE), effects: new Set() };
      }
      // Special case: bare `None` resolves to the most recent Option type.
      // This allows polymorphic None without global registration.
      if (expr.name === "None") {
        const sym = ctx.env.lookup("None");
        if (sym) {
          // User-defined None variant — use it
          if (sym.type.kind === "Function" && sym.type.params.length === 0
              && sym.type.returnType.kind === "Union") {
            return sym.type.returnType;
          }
          return sym.type;
        }
        // Built-in None — resolve from Option registry (Option<Unit> placeholder)
        if (ctx.env.lookup("__none_expected__")) {
          // not used — fall through
        }
        return ctx.makeOptionType(UNIT);
      }
      // Special case: bare `Ok` as identifier (not called) — it's a function
      if (expr.name === "Ok") {
        const sym = ctx.env.lookup("Ok");
        if (sym) return sym.type;
        return { kind: "Function", params: [ERROR_TYPE], returnType: ctx.makeResultType(ERROR_TYPE, ERROR_TYPE), effects: new Set() };
      }
      // Special case: bare `Err` as identifier (not called) — it's a function
      if (expr.name === "Err") {
        const sym = ctx.env.lookup("Err");
        if (sym) return sym.type;
        return { kind: "Function", params: [ERROR_TYPE], returnType: ctx.makeResultType(ERROR_TYPE, ERROR_TYPE), effects: new Set() };
      }
      const sym = ctx.env.lookup(expr.name);
      if (!sym) {
        ctx.diagnostics.push(error(`Undefined variable '${expr.name}'`, expr.span));
        return ERROR_TYPE;
      }
      // Zero-field union variant constructors can be used as bare identifiers
      // e.g. `Red` (from `type Color = | Red | Green | Blue`) without `()`.
      // Guard: only auto-call when the identifier is actually a variant name in
      // the returned union. This prevents regular zero-param functions that happen
      // to return a Union type (e.g. `read_line_or_eof`) from being silently
      // "called" here and causing "Cannot call non-function type" at the call site.
      if (sym.type.kind === "Function" && sym.type.params.length === 0
          && sym.type.returnType.kind === "Union") {
        const isVariantConstructor = sym.type.returnType.variants.some(v => v.name === expr.name);
        if (isVariantConstructor) {
          return sym.type.returnType;
        }
      }
      return sym.type;
    }

    case "BinaryExpr": {
      const leftType = ctx.checkExpr(expr.left);
      const rightType = ctx.checkExpr(expr.right);
      return checkBinaryOp(ctx.diagnostics, expr.op, leftType, rightType, expr.span);
    }

    case "UnaryExpr": {
      const operandType = ctx.checkExpr(expr.operand);
      return checkUnaryOp(ctx.diagnostics, expr.op, operandType, expr.span);
    }

    case "CallExpr": {
      // Special case: Some(value) — polymorphic Option constructor
      if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === "Some") {
        if (expr.args.length !== 1) {
          ctx.diagnostics.push(error(`Some expects exactly 1 argument but got ${expr.args.length}`, expr.span));
          return ERROR_TYPE;
        }
        const argType = ctx.checkExpr(expr.args[0].value);
        return ctx.makeOptionType(argType);
      }

      // Special case: Ok(value) — polymorphic Result constructor
      if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === "Ok") {
        const sym = ctx.env.lookup("Ok");
        if (!sym || (sym.type.kind === "Function" && sym.type.returnType.kind === "Error")) {
          // Built-in Ok constructor
          if (expr.args.length !== 1) {
            ctx.diagnostics.push(error(`Ok expects exactly 1 argument but got ${expr.args.length}`, expr.span));
            return ERROR_TYPE;
          }
          const argType = ctx.checkExpr(expr.args[0].value);
          return ctx.makeResultType(argType, ERROR_TYPE);
        }
      }

      // Special case: Err(error) — polymorphic Result constructor
      if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === "Err") {
        const sym = ctx.env.lookup("Err");
        if (!sym || (sym.type.kind === "Function" && sym.type.returnType.kind === "Error")) {
          // Built-in Err constructor
          if (expr.args.length !== 1) {
            ctx.diagnostics.push(error(`Err expects exactly 1 argument but got ${expr.args.length}`, expr.span));
            return ERROR_TYPE;
          }
          const argType = ctx.checkExpr(expr.args[0].value);
          return ctx.makeResultType(ERROR_TYPE, argType);
        }
      }

      const calleeType = ctx.checkExpr(expr.callee);
      if (calleeType.kind === "Error") return ERROR_TYPE;

      if (calleeType.kind !== "Function") {
        ctx.diagnostics.push(
          error(`Cannot call non-function type ${typeToString(calleeType)}`, expr.callee.span),
        );
        return ERROR_TYPE;
      }

      // Check argument count
      if (expr.args.length !== calleeType.params.length) {
        ctx.diagnostics.push(
          error(
            `Expected ${calleeType.params.length} arguments but got ${expr.args.length}`,
            expr.span,
          ),
        );
        return calleeType.returnType;
      }

      // Named argument validation and reordering
      const hasNamedArgs = expr.args.some(a => a.name !== undefined);
      if (hasNamedArgs && calleeType.paramNames) {
        const hasUnnamedArgs = expr.args.some(a => a.name === undefined);
        if (hasUnnamedArgs) {
          ctx.diagnostics.push(
            error(`Cannot mix named and positional arguments`, expr.span),
          );
        } else {
          // Validate all names match parameter names and reorder
          const paramNames = calleeType.paramNames;
          const reordered: typeof expr.args = new Array(expr.args.length);
          let hasError = false;
          for (const arg of expr.args) {
            const idx = paramNames.indexOf(arg.name!);
            if (idx === -1) {
              ctx.diagnostics.push(
                error(
                  `Unknown parameter name '${arg.name}'. Expected one of: ${paramNames.join(", ")}`,
                  arg.span,
                ),
              );
              hasError = true;
            } else if (reordered[idx] !== undefined) {
              ctx.diagnostics.push(
                error(`Duplicate named argument '${arg.name}'`, arg.span),
              );
              hasError = true;
            } else {
              reordered[idx] = arg;
            }
          }
          // Rewrite args in parameter order
          if (!hasError) {
            expr.args = reordered;
          }
        }
      } else if (hasNamedArgs && !calleeType.paramNames) {
        // Function type has no parameter names (e.g. function type parameter)
        ctx.diagnostics.push(
          error(`Named arguments are not supported for function type values`, expr.span),
        );
      }

      // Check if this is a generic function call that needs type inference
      const isGeneric = containsTypeVar(calleeType);

      if (isGeneric) {
        // Infer type variables from arguments
        const bindings = new Map<string, ClarityType>();
        for (let i = 0; i < expr.args.length; i++) {
          const argType = ctx.checkExpr(expr.args[i].value);
          const paramType = calleeType.params[i];
          if (!unifyTypes(paramType, argType, bindings)) {
            ctx.diagnostics.push(
              error(
                `Argument ${i + 1}: expected ${typeToString(paramType)} but got ${typeToString(argType)}`,
                expr.args[i].span,
              ),
            );
          }
        }

        // Substitute inferred types into the return type
        let resolvedReturnType = substituteTypeVars(calleeType.returnType, bindings);

        // Convert Option<T> to its Union representation (required for pattern matching).
        // Also handles Option<TypeVar> in generic function bodies — the Union with TypeVar
        // fields is valid for checking; concrete types are handled at monomorphized call sites.
        if (resolvedReturnType.kind === "Option") {
          resolvedReturnType = ctx.makeOptionType(resolvedReturnType.inner);
        }

        // Check effects
        ctx.diagnostics.push(
          ...checkEffectSafety(ctx.currentEffects, calleeType.effects, expr.span),
        );

        return resolvedReturnType;
      }

      // Non-generic: check argument types directly
      for (let i = 0; i < expr.args.length; i++) {
        const argType = ctx.checkExpr(expr.args[i].value);
        const paramType = calleeType.params[i];
        if (!typesEqual(argType, paramType)) {
          ctx.diagnostics.push(
            error(
              `Argument ${i + 1}: expected ${typeToString(paramType)} but got ${typeToString(argType)}`,
              expr.args[i].span,
            ),
          );
        }
      }

      // Check effects
      ctx.diagnostics.push(
        ...checkEffectSafety(ctx.currentEffects, calleeType.effects, expr.span),
      );

      return calleeType.returnType;
    }

    case "MemberExpr": {
      const objType = ctx.checkExpr(expr.object);
      if (objType.kind === "Error") return ERROR_TYPE;

      if (objType.kind === "Record") {
        const fieldType = objType.fields.get(expr.member);
        if (!fieldType) {
          ctx.diagnostics.push(
            error(`Record '${objType.name}' has no field '${expr.member}'`, expr.span),
          );
          return ERROR_TYPE;
        }
        return fieldType;
      }

      ctx.diagnostics.push(
        error(`Cannot access member '${expr.member}' on type ${typeToString(objType)}`, expr.span),
      );
      return ERROR_TYPE;
    }

    case "MatchExpr": {
      let scrutineeType = ctx.checkExpr(expr.scrutinee);

      // Convert Result<T, E> to its Union representation for matching
      if (scrutineeType.kind === "Result") {
        scrutineeType = ctx.resultToUnion(scrutineeType);
        // Re-attach the resolved type as the union representation
        expr.scrutinee.resolvedType = scrutineeType;
      }

      // Check exhaustiveness
      ctx.diagnostics.push(
        ...checkExhaustiveness(
          scrutineeType,
          expr.arms.map((a) => a.pattern),
          expr.span,
        ),
      );

      let resultType: ClarityType | null = null;
      for (const arm of expr.arms) {
        ctx.env.enterScope();
        ctx.checkPattern(arm.pattern, scrutineeType);
        if (arm.guard) {
          const guardType = ctx.checkExpr(arm.guard);
          if (guardType.kind !== "Error" && guardType.kind !== "Bool") {
            ctx.diagnostics.push(
              error(
                `Pattern guard must be Bool, got ${typeToString(guardType)}`,
                arm.guard.span,
              ),
            );
          }
        }
        const armType = ctx.checkExpr(arm.body);
        ctx.env.exitScope();

        if (resultType === null) {
          resultType = armType;
        } else if (!typesEqual(armType, resultType)) {
          ctx.diagnostics.push(
            error(
              `Match arm returns ${typeToString(armType)} but previous arm returns ${typeToString(resultType)}`,
              arm.body.span,
              "All match arms must return the same type",
            ),
          );
        } else {
          // Both arms are compatible. Prefer the more specific type over placeholders
          // (e.g. Option<Int64> over Option<Unit> produced by bare `None`).
          resultType = promoteType(resultType, armType);
        }
      }

      return resultType ?? ERROR_TYPE;
    }

    case "LetExpr": {
      const valueType = ctx.checkExpr(expr.value);

      let bindingType = valueType;
      if (expr.typeAnnotation) {
        const annotType = ctx.resolveTypeRef(expr.typeAnnotation);
        if (annotType) {
          // If value type contains TypeVars (e.g. from map_new()), the annotation
          // provides the concrete type — accept it without a type error.
          if (!containsTypeVar(valueType) && !typesEqual(valueType, annotType)) {
            ctx.diagnostics.push(
              error(
                `Let binding type mismatch: expected ${typeToString(annotType)} but got ${typeToString(valueType)}`,
                expr.value.span,
              ),
            );
          }
          // Annotation wins: use it as the binding type so subsequent uses
          // of this variable see the concrete type (e.g. Map<String, String>).
          bindingType = annotType;
        }
      }

      if (expr.name !== "_") {
        ctx.env.define(expr.name, {
          name: expr.name,
          type: bindingType,
          mutable: expr.mutable,
          defined: expr.span,
        });
      }

      return UNIT;
    }

    case "AssignmentExpr": {
      const sym = ctx.env.lookup(expr.name);
      if (!sym) {
        ctx.diagnostics.push(error(`Undefined variable '${expr.name}'`, expr.span));
        return UNIT;
      }
      if (!sym.mutable) {
        ctx.diagnostics.push(
          error(
            `Cannot assign to immutable variable '${expr.name}'`,
            expr.span,
            "Declare with 'let mut' to make it mutable",
          ),
        );
        return UNIT;
      }
      const valueType = ctx.checkExpr(expr.value);
      if (!typesEqual(valueType, sym.type)) {
        ctx.diagnostics.push(
          error(
            `Cannot assign ${typeToString(valueType)} to variable '${expr.name}' of type ${typeToString(sym.type)}`,
            expr.value.span,
          ),
        );
      }
      return UNIT;
    }

    case "BlockExpr": {
      ctx.env.enterScope();
      for (const stmt of expr.statements) {
        ctx.checkExpr(stmt);
      }
      const resultType = expr.result ? ctx.checkExpr(expr.result) : UNIT;
      ctx.env.exitScope();
      return resultType;
    }

    case "LambdaExpr": {
      // Resolve param types from their type annotations
      const paramTypes: ClarityType[] = expr.params.map(p => ctx.resolveTypeRef(p.typeAnnotation) ?? ERROR_TYPE);
      const paramNameSet = new Set(expr.params.map(p => p.name));
      // Snapshot non-global names visible before entering the lambda scope.
      // These are candidates for capture (outer function locals/params/let-bindings).
      const outerLocalNames = ctx.env.getNonGlobalNames();
      // Check the body in a new scope with params bound
      ctx.env.enterScope();
      for (let i = 0; i < expr.params.length; i++) {
        ctx.env.define(expr.params[i].name, {
          name: expr.params[i].name,
          type: paramTypes[i],
          mutable: false,
          defined: expr.params[i].span,
        });
      }
      const returnType = ctx.checkExpr(expr.body);
      ctx.env.exitScope();
      // Free variable analysis: identifiers in the body that are not lambda params
      // and are defined as outer locals → captured variables.
      const freeVars = collectFreeVars(expr.body, paramNameSet);
      expr.captures = [...freeVars].filter(name => outerLocalNames.has(name));
      return { kind: "Function", params: paramTypes, returnType, effects: new Set() };
    }

    case "ListLiteral": {
      if (expr.elements.length === 0) {
        return { kind: "List", element: ERROR_TYPE };
      }
      const firstType = ctx.checkExpr(expr.elements[0]);
      for (let i = 1; i < expr.elements.length; i++) {
        const elemType = ctx.checkExpr(expr.elements[i]);
        if (!typesEqual(elemType, firstType)) {
          ctx.diagnostics.push(
            error(
              `List element type mismatch: expected ${typeToString(firstType)} but got ${typeToString(elemType)}`,
              expr.elements[i].span,
            ),
          );
        }
      }
      return { kind: "List", element: firstType };
    }

    case "RecordLiteral": {
      // Check each field value
      const fieldTypes = new Map<string, ClarityType>();
      for (const field of expr.fields) {
        const ft = ctx.checkExpr(field.value);
        fieldTypes.set(field.name, ft);
      }

      // Find a registered record type that matches these field names and types
      const fieldNames = new Set(fieldTypes.keys());
      const matchingType = ctx.findRecordType(fieldNames, fieldTypes);
      if (!matchingType) {
        ctx.diagnostics.push(
          error(
            `No record type found with fields: ${[...fieldNames].join(", ")}`,
            expr.span,
          ),
        );
        return ERROR_TYPE;
      }

      // Verify field types match
      for (const [name, expectedType] of matchingType.fields) {
        const actualType = fieldTypes.get(name);
        if (actualType && !typesEqual(actualType, expectedType) && actualType.kind !== "Error") {
          ctx.diagnostics.push(
            error(
              `Field '${name}' expected type ${typeToString(expectedType)} but got ${typeToString(actualType)}`,
              expr.fields.find(f => f.name === name)!.span,
            ),
          );
        }
      }

      return matchingType;
    }

    default:
      return ERROR_TYPE;
  }
}

export function checkPattern(ctx: CheckerContext, pattern: Pattern, expectedType: ClarityType): void {
  switch (pattern.kind) {
    case "WildcardPattern":
      break;

    case "BindingPattern":
      ctx.env.define(pattern.name, {
        name: pattern.name,
        type: expectedType,
        mutable: false,
        defined: pattern.span,
      });
      break;

    case "LiteralPattern": {
      const litType = ctx.checkExpr(pattern.value);
      if (!typesEqual(litType, expectedType)) {
        ctx.diagnostics.push(
          error(
            `Pattern type mismatch: expected ${typeToString(expectedType)} but got ${typeToString(litType)}`,
            pattern.span,
          ),
        );
      }
      break;
    }

    case "RangePattern": {
      if (expectedType.kind !== "Int64") {
        ctx.diagnostics.push(
          error(
            `Range patterns only work on Int64, got ${typeToString(expectedType)}`,
            pattern.span,
          ),
        );
      }
      if (pattern.start.value >= pattern.end.value) {
        ctx.diagnostics.push(
          error(
            `Invalid range pattern: start (${pattern.start.value}) must be less than end (${pattern.end.value})`,
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
          ctx.diagnostics.push(
            error(
              `Unknown variant '${pattern.name}' for type '${expectedType.name}'`,
              pattern.span,
            ),
          );
          return;
        }

        const fieldEntries = [...variant.fields.entries()];
        if (pattern.fields.length !== fieldEntries.length) {
          ctx.diagnostics.push(
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
            ctx.checkPattern(pattern.fields[i].pattern, fieldType);
          }
        }
      } else {
        ctx.diagnostics.push(
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
