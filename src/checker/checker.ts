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
  containsTypeVar, substituteTypeVars, unifyTypes,
} from "./types.js";
import { Environment } from "./environment.js";
import { validateEffectNames, checkEffectSafety } from "./effects.js";
import { checkExhaustiveness } from "./exhaustiveness.js";
import { CLARITY_BUILTINS } from "../registry/builtins-registry.js";

export class Checker {
  private env: Environment = new Environment();
  private diagnostics: Diagnostic[] = [];
  private currentEffects: Set<string> = new Set();
  // Type parameters in scope (for generic functions/types)
  private typeParamsInScope: Set<string> = new Set();
  // Registry of all Option<T> instantiations for polymorphic Some/None
  private optionTypes: Map<string, ClarityType> = new Map();
  // Registry of all Result<T, E> instantiations for polymorphic Ok/Err
  private resultTypes: Map<string, ClarityType> = new Map();

  private builtinsRegistered = false;

  check(module: ModuleDecl): Diagnostic[] {
    return this.checkModule(module, [], []);
  }

  /**
   * Check a module with optional imported symbols and types.
   * Used for multi-file compilation where imports are pre-resolved.
   */
  checkModule(
    module: ModuleDecl,
    importedSymbols: { name: string; type: ClarityType; span: Span }[] = [],
    importedTypes: { name: string; type: ClarityType }[] = [],
  ): Diagnostic[] {
    this.diagnostics = [];

    // Register built-in functions and types (only once)
    if (!this.builtinsRegistered) {
      this.registerBuiltins();
      this.builtinsRegistered = true;
    }

    // Register imported types
    for (const { name, type } of importedTypes) {
      this.env.defineType(name, type);
      // For union types, register variant constructors
      if (type.kind === "Union") {
        for (const variant of type.variants) {
          this.registerVariantConstructor(variant, type, name);
        }
      }
    }

    // Register imported symbols (functions, constants).
    // Imports shadow builtins, so we use redefine() to overwrite existing entries.
    const importSpan: Span = { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 }, source: "<import>" };
    for (const { name, type, span } of importedSymbols) {
      this.env.redefine(name, { name, type, mutable: false, defined: span ?? importSpan });
    }

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

  /** Register variant constructors for an imported union type */
  private registerVariantConstructor(
    variant: ClarityVariant,
    unionType: ClarityType & { kind: "Union" },
    typeName: string,
  ): void {
    const paramTypes = [...variant.fields.values()];
    const fnType: ClarityType = {
      kind: "Function",
      params: paramTypes,
      paramNames: [...variant.fields.keys()],
      returnType: unionType,
      effects: new Set(),
    };
    const importSpan: Span = { start: { offset: 0, line: 0, column: 0 }, end: { offset: 0, line: 0, column: 0 }, source: "<import>" };
    this.env.define(variant.name, {
      name: variant.name,
      type: fnType,
      mutable: false,
      defined: importSpan,
    });
  }

  /** Look up a symbol by name (for export collection) */
  lookupSymbol(name: string): import("./environment.js").Symbol | undefined {
    return this.env.lookup(name);
  }

  /** Look up a type by name (for export collection) */
  lookupType(name: string): ClarityType | undefined {
    return this.env.lookupType(name);
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

    // Register all built-in functions from the central registry
    for (const builtin of CLARITY_BUILTINS) {
      this.env.define(builtin.name, {
        name: builtin.name,
        type: {
          kind: "Function",
          params: builtin.params,
          paramNames: builtin.paramNames,
          returnType: builtin.returnType,
          effects: new Set(builtin.effects),
        },
        mutable: false,
        defined: builtinSpan,
      });
    }

    // Register Option<T> types used by builtins (e.g. string_to_int returns Option<Int64>).
    // This ensures codegen can find these types via getOptionTypes().
    for (const builtin of CLARITY_BUILTINS) {
      if (builtin.returnType.kind === "Union" && builtin.returnType.name.startsWith("Option<")) {
        const key = builtin.returnType.name.replace("Option<", "").replace(">", "");
        if (!this.optionTypes.has(key)) {
          this.optionTypes.set(key, builtin.returnType);
        }
      }
    }
  }

  // ============================================================
  // Type Registration
  // ============================================================

  private registerTypeDecl(decl: TypeDecl): void {
    // Bring type params into scope for resolving the type body
    const prevTypeParams = this.typeParamsInScope;
    this.typeParamsInScope = new Set([...prevTypeParams, ...decl.typeParams]);

    const type = this.resolveTypeExpr(decl.typeExpr, decl.name);

    this.typeParamsInScope = prevTypeParams;

    if (type) {
      // Store the type with its type parameters for later instantiation
      if (decl.typeParams.length > 0) {
        (type as any).__typeParams = decl.typeParams;
      }
      this.env.defineType(decl.name, type);

      // If it's a union type, register variant constructors as functions
      if (type.kind === "Union") {
        for (const variant of type.variants) {
          const paramTypes = [...variant.fields.values()];
          const fnType: ClarityType = {
            kind: "Function",
            params: paramTypes,
            paramNames: [...variant.fields.keys()],
            returnType: type,
            effects: new Set(),
          };
          if (decl.typeParams.length > 0) {
            (fnType as any).__typeParams = decl.typeParams;
          }
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
      default:
        return null;
    }
  }

  resolveTypeRef(node: TypeNode): ClarityType | null {
    // Handle function types: (Type, ...) -> ReturnType
    if (node.kind === "FunctionType") {
      const paramTypes: ClarityType[] = [];
      for (const p of node.paramTypes) {
        const resolved = this.resolveTypeRef(p);
        paramTypes.push(resolved ?? ERROR_TYPE);
      }
      const returnType = this.resolveTypeRef(node.returnType) ?? ERROR_TYPE;
      return { kind: "Function", params: paramTypes, returnType, effects: new Set() };
    }

    // Check if it's a type variable in scope
    if (this.typeParamsInScope.has(node.name) && node.typeArgs.length === 0) {
      return { kind: "TypeVar", name: node.name };
    }

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
    if (node.name === "Result" && node.typeArgs.length === 2) {
      const okType = this.resolveTypeRef(node.typeArgs[0]);
      const errType = this.resolveTypeRef(node.typeArgs[1]);
      if (okType && errType) {
        return this.makeResultType(okType, errType);
      }
    }
    if (node.name === "Map" && node.typeArgs.length === 2) {
      const keyType = this.resolveTypeRef(node.typeArgs[0]);
      const valueType = this.resolveTypeRef(node.typeArgs[1]);
      if (keyType && valueType) {
        return { kind: "Map", key: keyType, value: valueType };
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

  // Create a Result<T, E> type. Uses the dedicated Result ClarityType kind
  // so that typesEqual can handle Error type propagation (e.g. Ok(42) produces
  // Result<Int64, <error>>, which matches Result<Int64, String>).
  makeResultType(okType: ClarityType, errType: ClarityType): ClarityType {
    return { kind: "Result", ok: okType, err: errType };
  }

  // Resolve an Ok(value) call: infer Result<T, E> from argument type.
  // E is unknown at the Ok site, so we use Error type as placeholder.
  private resolveOkCall(argType: ClarityType): ClarityType {
    return this.makeResultType(argType, ERROR_TYPE);
  }

  // Resolve an Err(error) call: infer Result<T, E> from argument type.
  // T is unknown at the Err site, so we use Error type as placeholder.
  private resolveErrCall(argType: ClarityType): ClarityType {
    return this.makeResultType(ERROR_TYPE, argType);
  }

  // Convert a Result type to its Union representation for codegen.
  // Result<T, E> → Union { Ok(value: T) | Err(error: E) }
  resultToUnion(resultType: Extract<ClarityType, { kind: "Result" }>): ClarityType & { kind: "Union" } {
    const key = `${typeToString(resultType.ok)},${typeToString(resultType.err)}`;
    const cached = this.resultTypes.get(key);
    if (cached) return cached as ClarityType & { kind: "Union" };

    const union: ClarityType & { kind: "Union" } = {
      kind: "Union",
      name: `Result<${typeToString(resultType.ok)}, ${typeToString(resultType.err)}>`,
      variants: [
        { name: "Ok", fields: new Map([["value", resultType.ok]]) },
        { name: "Err", fields: new Map([["error", resultType.err]]) },
      ],
    };
    this.resultTypes.set(key, union);
    return union;
  }

  // Get all registered Result<T, E> Union instantiations (used by codegen)
  getResultTypes(): Map<string, ClarityType> {
    return this.resultTypes;
  }

  // ============================================================
  // Function Registration & Checking
  // ============================================================

  private registerFunctionSignature(decl: FunctionDecl): void {
    // Validate effect names
    this.diagnostics.push(...validateEffectNames(decl.effects, decl.span));

    // Bring type params into scope for resolving param/return types
    const prevTypeParams = this.typeParamsInScope;
    this.typeParamsInScope = new Set([...prevTypeParams, ...decl.typeParams]);

    const paramTypes: ClarityType[] = [];
    for (const param of decl.params) {
      const t = this.resolveTypeRef(param.typeAnnotation);
      paramTypes.push(t ?? ERROR_TYPE);
    }

    const returnType = this.resolveTypeRef(decl.returnType) ?? ERROR_TYPE;

    this.typeParamsInScope = prevTypeParams;

    const fnType: ClarityType = {
      kind: "Function",
      params: paramTypes,
      paramNames: decl.params.map(p => p.name),
      returnType,
      effects: new Set(decl.effects),
    };

    // Tag with type params so call sites can infer them
    if (decl.typeParams.length > 0) {
      (fnType as any).__typeParams = decl.typeParams;
    }

    // User-defined functions shadow builtins with the same name
    if (!this.env.define(decl.name, { name: decl.name, type: fnType, mutable: false, defined: decl.span })) {
      this.env.redefine(decl.name, { name: decl.name, type: fnType, mutable: false, defined: decl.span });
    }
  }

  private checkFunctionBody(decl: FunctionDecl): void {
    this.env.enterScope();
    this.currentEffects = new Set(decl.effects);

    // Bring type params into scope
    const prevTypeParams = this.typeParamsInScope;
    this.typeParamsInScope = new Set([...prevTypeParams, ...decl.typeParams]);

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

    // For generic functions, skip return type check when types contain TypeVars
    // (the concrete check happens at each call site via inference)
    if (bodyType && !typesEqual(bodyType, expectedReturn)) {
      if (!containsTypeVar(bodyType) && !containsTypeVar(expectedReturn)) {
        this.diagnostics.push(
          error(
            `Function '${decl.name}' returns ${typeToString(bodyType)} but declared return type is ${typeToString(expectedReturn)}`,
            decl.body.span,
          ),
        );
      }
    }

    this.typeParamsInScope = prevTypeParams;
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
        // Special case: bare `Ok` as identifier (not called) — it's a function
        if (expr.name === "Ok") {
          const sym = this.env.lookup("Ok");
          if (sym) return sym.type;
          return { kind: "Function", params: [ERROR_TYPE], returnType: this.makeResultType(ERROR_TYPE, ERROR_TYPE), effects: new Set() };
        }
        // Special case: bare `Err` as identifier (not called) — it's a function
        if (expr.name === "Err") {
          const sym = this.env.lookup("Err");
          if (sym) return sym.type;
          return { kind: "Function", params: [ERROR_TYPE], returnType: this.makeResultType(ERROR_TYPE, ERROR_TYPE), effects: new Set() };
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

        // Special case: Ok(value) — polymorphic Result constructor
        if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === "Ok") {
          const sym = this.env.lookup("Ok");
          if (!sym || (sym.type.kind === "Function" && sym.type.returnType.kind === "Error")) {
            // Built-in Ok constructor
            if (expr.args.length !== 1) {
              this.diagnostics.push(error(`Ok expects exactly 1 argument but got ${expr.args.length}`, expr.span));
              return ERROR_TYPE;
            }
            const argType = this.checkExpr(expr.args[0].value);
            return this.resolveOkCall(argType);
          }
        }

        // Special case: Err(error) — polymorphic Result constructor
        if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === "Err") {
          const sym = this.env.lookup("Err");
          if (!sym || (sym.type.kind === "Function" && sym.type.returnType.kind === "Error")) {
            // Built-in Err constructor
            if (expr.args.length !== 1) {
              this.diagnostics.push(error(`Err expects exactly 1 argument but got ${expr.args.length}`, expr.span));
              return ERROR_TYPE;
            }
            const argType = this.checkExpr(expr.args[0].value);
            return this.resolveErrCall(argType);
          }
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

        // Named argument validation and reordering
        const hasNamedArgs = expr.args.some(a => a.name !== undefined);
        if (hasNamedArgs && calleeType.paramNames) {
          const hasUnnamedArgs = expr.args.some(a => a.name === undefined);
          if (hasUnnamedArgs) {
            this.diagnostics.push(
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
                this.diagnostics.push(
                  error(
                    `Unknown parameter name '${arg.name}'. Expected one of: ${paramNames.join(", ")}`,
                    arg.span,
                  ),
                );
                hasError = true;
              } else if (reordered[idx] !== undefined) {
                this.diagnostics.push(
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
          this.diagnostics.push(
            error(`Named arguments are not supported for function type values`, expr.span),
          );
        }

        // Check if this is a generic function call that needs type inference
        const isGeneric = containsTypeVar(calleeType);

        if (isGeneric) {
          // Infer type variables from arguments
          const bindings = new Map<string, ClarityType>();
          for (let i = 0; i < expr.args.length; i++) {
            const argType = this.checkExpr(expr.args[i].value);
            const paramType = calleeType.params[i];
            if (!unifyTypes(paramType, argType, bindings)) {
              this.diagnostics.push(
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
          // This handles generic builtins like map_get whose return type uses Option<TypeVar>.
          if (resolvedReturnType.kind === "Option" && !containsTypeVar(resolvedReturnType)) {
            resolvedReturnType = this.makeOptionType(resolvedReturnType.inner);
          }

          // Check effects
          this.diagnostics.push(
            ...checkEffectSafety(this.currentEffects, calleeType.effects, expr.span),
          );

          return resolvedReturnType;
        }

        // Non-generic: check argument types directly
        for (let i = 0; i < expr.args.length; i++) {
          const argType = this.checkExpr(expr.args[i].value);
          const paramType = calleeType.params[i];
          if (!typesEqual(argType, paramType)) {
            this.diagnostics.push(
              error(
                `Argument ${i + 1}: expected ${typeToString(paramType)} but got ${typeToString(argType)}`,
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
        let scrutineeType = this.checkExpr(expr.scrutinee);

        // Convert Result<T, E> to its Union representation for matching
        if (scrutineeType.kind === "Result") {
          scrutineeType = this.resultToUnion(scrutineeType);
          // Re-attach the resolved type as the union representation
          expr.scrutinee.resolvedType = scrutineeType;
        }

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
          if (arm.guard) {
            const guardType = this.checkExpr(arm.guard);
            if (guardType.kind !== "Error" && guardType.kind !== "Bool") {
              this.diagnostics.push(
                error(
                  `Pattern guard must be Bool, got ${typeToString(guardType)}`,
                  arm.guard.span,
                ),
              );
            }
          }
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

        let bindingType = valueType;
        if (expr.typeAnnotation) {
          const annotType = this.resolveTypeRef(expr.typeAnnotation);
          if (annotType) {
            // If value type contains TypeVars (e.g. from map_new()), the annotation
            // provides the concrete type — accept it without a type error.
            if (!containsTypeVar(valueType) && !typesEqual(valueType, annotType)) {
              this.diagnostics.push(
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
          this.env.define(expr.name, {
            name: expr.name,
            type: bindingType,
            mutable: expr.mutable,
            defined: expr.span,
          });
        }

        return UNIT;
      }

      case "AssignmentExpr": {
        const sym = this.env.lookup(expr.name);
        if (!sym) {
          this.diagnostics.push(error(`Undefined variable '${expr.name}'`, expr.span));
          return UNIT;
        }
        if (!sym.mutable) {
          this.diagnostics.push(
            error(
              `Cannot assign to immutable variable '${expr.name}'`,
              expr.span,
              "Declare with 'let mut' to make it mutable",
            ),
          );
          return UNIT;
        }
        const valueType = this.checkExpr(expr.value);
        if (!typesEqual(valueType, sym.type)) {
          this.diagnostics.push(
            error(
              `Cannot assign ${typeToString(valueType)} to variable '${expr.name}' of type ${typeToString(sym.type)}`,
              expr.value.span,
            ),
          );
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

      case "RangePattern": {
        if (expectedType.kind !== "Int64") {
          this.diagnostics.push(
            error(
              `Range patterns only work on Int64, got ${typeToString(expectedType)}`,
              pattern.span,
            ),
          );
        }
        if (pattern.start.value >= pattern.end.value) {
          this.diagnostics.push(
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
