import type { Diagnostic, Span } from "../errors/diagnostic.js";
import { error } from "../errors/diagnostic.js";
import type {
  ModuleDecl, Declaration, FunctionDecl, TypeDecl, ConstDecl,
  Expr, Pattern, TypeNode, TypeExpr,
} from "../ast/nodes.js";
import {
  type ClarityType, type ClarityVariant,
  INT64, FLOAT64, STRING, BOOL, UNIT, ERROR_TYPE,
  resolveBuiltinType, typesEqual, typeToString, promoteType,
  containsTypeVar, substituteTypeVars, unifyTypes,
} from "./types.js";
import { Environment } from "./environment.js";
import { validateEffectNames, checkEffectSafety } from "./effects.js";
import { checkExhaustiveness } from "./exhaustiveness.js";
import { CLARITY_BUILTINS } from "../registry/builtins-registry.js";
import { warnMutualTailRecursion } from "./checker-tco-warn.js";
import { checkExprInner as _checkExprInner, checkPattern as _checkPattern } from "./checker-exprs.js";

export class Checker {
  env: Environment = new Environment();
  diagnostics: Diagnostic[] = [];
  currentEffects: Set<string> = new Set();
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

    // Fourth pass: warn about mutually-recursive tail calls that can't be TCO'd.
    const localFuncNames = new Set(
      module.declarations
        .filter((d): d is FunctionDecl => d.kind === "FunctionDecl")
        .map((d) => d.name),
    );
    warnMutualTailRecursion(
      this.diagnostics,
      module.declarations.filter((d): d is FunctionDecl => d.kind === "FunctionDecl"),
      localFuncNames,
    );

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

  findRecordType(fieldNames: Set<string>, fieldTypes?: Map<string, ClarityType>): (ClarityType & { kind: "Record" }) | null {
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
  // TypeVar-containing types are NOT cached (codegen needs concrete types only).
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
    // Only cache concrete (non-TypeVar) instantiations for codegen
    if (!containsTypeVar(inner)) {
      this.optionTypes.set(key, optionUnion);
    }
    return optionUnion;
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
    const type = _checkExprInner(this, expr);
    expr.resolvedType = type;
    return type;
  }

  // ============================================================
  // Pattern Checking
  // ============================================================

  checkPattern(pattern: Pattern, expectedType: ClarityType): void {
    _checkPattern(this, pattern, expectedType);
  }

}

