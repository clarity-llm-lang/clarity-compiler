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
  // Registry of all Option<T> instantiations for polymorphic Some/None
  private optionTypes: Map<string, ClarityType> = new Map();

  check(module: ModuleDecl): Diagnostic[] {
    this.diagnostics = [];

    // Register built-in functions and types before user declarations
    this.registerBuiltins();

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
  // Built-in Functions & Types
  // ============================================================

  private registerBuiltins(): void {
    const builtinSpan: Span = {
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 0, line: 0, column: 0 },
      source: "<builtin>",
    };

    // Helper to define a built-in function in the environment
    const defFn = (
      name: string,
      params: ClarityType[],
      returnType: ClarityType,
      effects: string[] = [],
    ) => {
      this.env.define(name, {
        name,
        type: {
          kind: "Function",
          params,
          returnType,
          effects: new Set(effects),
        },
        mutable: false,
        defined: builtinSpan,
      });
    };

    // --- I/O & Logging (require Log effect) ---
    defFn("print_string", [STRING], UNIT, ["Log"]);
    defFn("print_int", [INT64], UNIT, ["Log"]);
    defFn("print_float", [FLOAT64], UNIT, ["Log"]);
    defFn("log_info", [STRING], UNIT, ["Log"]);
    defFn("log_warn", [STRING], UNIT, ["Log"]);

    // --- String operations ---
    defFn("string_concat", [STRING, STRING], STRING);
    defFn("string_eq", [STRING, STRING], BOOL);
    defFn("string_length", [STRING], INT64);
    defFn("substring", [STRING, INT64, INT64], STRING);
    defFn("char_at", [STRING, INT64], STRING);

    // --- Type conversions ---
    defFn("int_to_float", [INT64], FLOAT64);
    defFn("float_to_int", [FLOAT64], INT64);
    defFn("int_to_string", [INT64], STRING);
    defFn("float_to_string", [FLOAT64], STRING);
    // Note: string_to_int/string_to_float return raw values (0 on failure).
    // Proper Option<T> return types require generics (Phase 2).
    defFn("string_to_int", [STRING], INT64);
    defFn("string_to_float", [STRING], FLOAT64);

    // --- Math builtins ---
    defFn("abs_int", [INT64], INT64);
    defFn("min_int", [INT64, INT64], INT64);
    defFn("max_int", [INT64, INT64], INT64);
    defFn("sqrt", [FLOAT64], FLOAT64);
    defFn("pow", [FLOAT64, FLOAT64], FLOAT64);
    defFn("floor", [FLOAT64], FLOAT64);
    defFn("ceil", [FLOAT64], FLOAT64);

    // --- List operations ---
    // These use List<Int64> as a placeholder type. The checker accepts
    // any List<T> since Error type propagation handles mismatches gracefully.
    const LIST_INT = { kind: "List" as const, element: INT64 };
    defFn("list_length", [LIST_INT], INT64);
    defFn("length", [LIST_INT], INT64);
    defFn("head", [LIST_INT], INT64);
    defFn("tail", [LIST_INT], LIST_INT);
    defFn("append", [LIST_INT, INT64], LIST_INT);
    defFn("concat", [LIST_INT, LIST_INT], LIST_INT);
    defFn("reverse", [LIST_INT], LIST_INT);

    // --- Test assertions (require Test effect) ---
    defFn("assert_eq", [INT64, INT64], UNIT, ["Test"]);
    defFn("assert_eq_float", [FLOAT64, FLOAT64], UNIT, ["Test"]);
    defFn("assert_eq_string", [STRING, STRING], UNIT, ["Test"]);
    defFn("assert_true", [BOOL], UNIT, ["Test"]);
    defFn("assert_false", [BOOL], UNIT, ["Test"]);

    // --- Pre-register Option<T> type ---
    // Option<T> is a built-in union with Some(value: T) and None.
    // Since Clarity doesn't have parametric polymorphism in the checker yet,
    // concrete Option types (Option<Int64>, Option<String>, etc.) are created
    // by resolveTypeRef when it encounters Option<SomeType>.
    // We don't register generic Some/None constructors here because they'd need
    // to be polymorphic. Instead, when the user defines their own union types,
    // those constructors get registered. For Option<T>, the user can define:
    //   type MyOption = | Some(value: Int64) | None
    // Or use the built-in Option<Int64> syntax which the checker handles.
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

  private findRecordType(fieldNames: Set<string>, fieldTypes?: Map<string, ClarityType>): (ClarityType & { kind: "Record" }) | null {
    const candidates: (ClarityType & { kind: "Record" })[] = [];
    for (const [, type] of this.env.allTypes()) {
      if (type.kind === "Record") {
        const typeFieldNames = new Set(type.fields.keys());
        if (typeFieldNames.size === fieldNames.size && [...fieldNames].every(n => typeFieldNames.has(n))) {
          candidates.push(type);
        }
      }
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    // Multiple candidates — disambiguate by field types
    if (fieldTypes) {
      for (const candidate of candidates) {
        let matches = true;
        for (const [name, type] of fieldTypes) {
          const expected = candidate.fields.get(name);
          if (expected && type.kind !== "Error" && !typesEqual(type, expected)) {
            matches = false;
            break;
          }
        }
        if (matches) return candidate;
      }
    }
    // Fall back to first match
    return candidates[0];
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
      if (inner) {
        return this.makeOptionType(inner);
      }
    }

    this.diagnostics.push(error(`Unknown type '${node.name}'`, node.span));
    return null;
  }

  // Create (or return cached) Option<T> union type for a given inner type.
  // Some/None constructors are NOT registered as global symbols — they are
  // resolved specially at call sites to support polymorphism.
  makeOptionType(inner: ClarityType): ClarityType {
    const key = typeToString(inner);
    const cached = this.optionTypes.get(key);
    if (cached) return cached;

    const optionUnion: ClarityType = {
      kind: "Union",
      name: `Option<${key}>`,
      variants: [
        { name: "Some", fields: new Map([["value", inner]]) },
        { name: "None", fields: new Map() },
      ],
    };
    this.optionTypes.set(key, optionUnion);
    return optionUnion;
  }

  // Resolve a Some(value) call: infer Option<T> from the argument type.
  private resolveSomeCall(argType: ClarityType): ClarityType {
    return this.makeOptionType(argType);
  }

  // Resolve a None reference: try to find the expected Option type from context.
  // If no context, return a generic Option<Unit> as placeholder.
  private resolveNoneType(expectedType?: ClarityType): ClarityType {
    if (expectedType && expectedType.kind === "Union" && expectedType.name.startsWith("Option<")) {
      return expectedType;
    }
    return this.makeOptionType(UNIT);
  }

  // Get all registered Option<T> instantiations (used by codegen)
  getOptionTypes(): Map<string, ClarityType> {
    return this.optionTypes;
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
    const type = this.checkExprInner(expr);
    expr.resolvedType = type;
    return type;
  }

  private checkExprInner(expr: Expr): ClarityType {
    switch (expr.kind) {
      case "IntLiteral": return INT64;
      case "FloatLiteral": return FLOAT64;
      case "StringLiteral": return STRING;
      case "BoolLiteral": return BOOL;

      case "IdentifierExpr": {
        if (expr.name === "<error>") return ERROR_TYPE;
        // Special case: bare `Some` as identifier (not called) — it's a function
        if (expr.name === "Some") {
          const sym = this.env.lookup("Some");
          if (sym) return sym.type;
          // Not registered yet — return generic function type
          return { kind: "Function", params: [ERROR_TYPE], returnType: this.makeOptionType(ERROR_TYPE), effects: new Set() };
        }
        // Special case: bare `None` resolves to the most recent Option type.
        // This allows polymorphic None without global registration.
        if (expr.name === "None") {
          const sym = this.env.lookup("None");
          if (sym) {
            // User-defined None variant — use it
            if (sym.type.kind === "Function" && sym.type.params.length === 0
                && sym.type.returnType.kind === "Union") {
              return sym.type.returnType;
            }
            return sym.type;
          }
          // Built-in None — resolve from Option registry
          return this.resolveNoneType();
        }
        const sym = this.env.lookup(expr.name);
        if (!sym) {
          this.diagnostics.push(error(`Undefined variable '${expr.name}'`, expr.span));
          return ERROR_TYPE;
        }
        // Zero-field union variant constructors can be used as bare identifiers
        // e.g. `NoneVal` instead of `NoneVal()` — auto-call them
        if (sym.type.kind === "Function" && sym.type.params.length === 0
            && sym.type.returnType.kind === "Union") {
          return sym.type.returnType;
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
        // Special case: Some(value) — polymorphic Option constructor
        if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === "Some") {
          if (expr.args.length !== 1) {
            this.diagnostics.push(error(`Some expects exactly 1 argument but got ${expr.args.length}`, expr.span));
            return ERROR_TYPE;
          }
          const argType = this.checkExpr(expr.args[0].value);
          return this.resolveSomeCall(argType);
        }

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

      case "RecordLiteral": {
        // Check each field value
        const fieldTypes = new Map<string, ClarityType>();
        for (const field of expr.fields) {
          const ft = this.checkExpr(field.value);
          fieldTypes.set(field.name, ft);
        }

        // Find a registered record type that matches these field names and types
        const fieldNames = new Set(fieldTypes.keys());
        const matchingType = this.findRecordType(fieldNames, fieldTypes);
        if (!matchingType) {
          this.diagnostics.push(
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
            this.diagnostics.push(
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
