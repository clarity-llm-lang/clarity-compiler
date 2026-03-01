import binaryen from "binaryen";
import type {
  ModuleDecl, FunctionDecl, Expr, BinaryOp, UnaryOp,
} from "../ast/nodes.js";
import type { ClarityType, ClarityVariant } from "../checker/types.js";
import { INT64, FLOAT64, BOOL, UNIT, BYTES, TIMESTAMP, STRING, typeToString, containsTypeVar, substituteTypeVars, unifyTypes } from "../checker/types.js";
import { Checker } from "../checker/checker.js";
import { clarityTypeToWasm } from "./wasm-types.js";
import { getBuiltins } from "./builtins.js";

interface LocalVar {
  index: number;
  wasmType: binaryen.Type;
  clarityType: ClarityType;
}

function assertResolvedType(type: ClarityType | null | undefined, context: string): ClarityType {
  if (type == null) {
    throw new Error(`Internal compiler error: failed to resolve type for ${context}. This is a bug — the type checker should have caught this.`);
  }
  return type;
}

export class CodeGenerator {
  private mod!: binaryen.Module;
  private locals!: Map<string, LocalVar>;
  private localIndex!: number;
  private additionalLocals!: binaryen.Type[];
  private checker!: Checker;
  private currentFunction!: FunctionDecl;

  // String literal data segment tracking
  private stringLiterals: Map<string, number> = new Map();
  private dataSegmentOffset: number = 0;
  private dataSegments: { offset: number; data: Uint8Array }[] = [];

  // All function declarations for cross-function type lookup
  private allFunctions: Map<string, FunctionDecl> = new Map();

  // All type declarations for record/union layout computation
  private allTypeDecls: Map<string, ClarityType> = new Map();

  // Function table for indirect calls (higher-order functions)
  private functionTableNames: string[] = [];
  private functionTableIndices: Map<string, number> = new Map();

  // Lambda lifting — lambdas collected during codegen, emitted after all named functions
  private lambdaCounter: number = 0;
  private pendingLambdas: Array<{ name: string; expr: import("../ast/nodes.js").LambdaExpr }> = [];

  // Monomorphization tracking for generic functions
  private generatedMonomorphs: Set<string> = new Set();

  // Current type-variable substitution in effect while generating a monomorphized body.
  // inferExprType applies this to checker-annotated resolvedTypes so that TypeVars
  // carried from the generic declaration are replaced with their concrete types.
  private typeVarSubst: Map<string, ClarityType> = new Map();

  generate(module: ModuleDecl, checker: Checker): Uint8Array {
    this.mod = new binaryen.Module();
    this.checker = checker;
    this.stringLiterals = new Map();
    this.dataSegmentOffset = 0;
    this.dataSegments = [];
    this.allFunctions = new Map();
    this.allTypeDecls = new Map();
    this.functionTableNames = [];
    this.functionTableIndices = new Map();
    this.generatedMonomorphs = new Set();
    this.lambdaCounter = 0;
    this.pendingLambdas = [];
    this.typeVarSubst = new Map();

    this.setupModule(module);

    if (!this.mod.validate()) {
      throw new Error("Generated invalid WASM module");
    }

    this.mod.optimize();
    return this.mod.emitBinary();
  }

  generateText(module: ModuleDecl, checker: Checker): string {
    this.mod = new binaryen.Module();
    this.checker = checker;
    this.stringLiterals = new Map();
    this.dataSegmentOffset = 0;
    this.dataSegments = [];
    this.allFunctions = new Map();
    this.allTypeDecls = new Map();
    this.functionTableNames = [];
    this.functionTableIndices = new Map();
    this.generatedMonomorphs = new Set();
    this.lambdaCounter = 0;
    this.pendingLambdas = [];

    this.setupModule(module);

    this.mod.validate();
    return this.mod.emitText();
  }

  /** Generate WASM binary from multiple modules merged into one */
  generateMulti(allModules: ModuleDecl[], entryModule: ModuleDecl, checker: Checker): Uint8Array {
    this.mod = new binaryen.Module();
    this.checker = checker;
    this.stringLiterals = new Map();
    this.dataSegmentOffset = 0;
    this.dataSegments = [];
    this.allFunctions = new Map();
    this.allTypeDecls = new Map();
    this.functionTableNames = [];
    this.functionTableIndices = new Map();
    this.generatedMonomorphs = new Set();
    this.lambdaCounter = 0;
    this.pendingLambdas = [];

    this.setupModuleMulti(allModules, entryModule);

    if (!this.mod.validate()) {
      throw new Error("Generated invalid WASM module");
    }

    this.mod.optimize();
    return this.mod.emitBinary();
  }

  /** Generate WAT text from multiple modules merged into one */
  generateTextMulti(allModules: ModuleDecl[], entryModule: ModuleDecl, checker: Checker): string {
    this.mod = new binaryen.Module();
    this.checker = checker;
    this.stringLiterals = new Map();
    this.dataSegmentOffset = 0;
    this.dataSegments = [];
    this.allFunctions = new Map();
    this.allTypeDecls = new Map();
    this.functionTableNames = [];
    this.functionTableIndices = new Map();
    this.generatedMonomorphs = new Set();
    this.lambdaCounter = 0;
    this.pendingLambdas = [];

    this.setupModuleMulti(allModules, entryModule);

    this.mod.validate();
    return this.mod.emitText();
  }

  private setupModule(module: ModuleDecl): void {
    // Memory is owned by the WASM module and exported.
    // The runtime reads/writes to the exported memory.

    // Register built-in function imports
    for (const builtin of getBuiltins()) {
      this.mod.addFunctionImport(
        builtin.name,
        builtin.importModule,
        builtin.importName,
        builtin.params,
        builtin.result,
      );
    }

    // Import alloc from runtime (bump allocator)
    this.mod.addFunctionImport(
      "__alloc",
      "env",
      "__alloc",
      binaryen.i32, // size in bytes
      binaryen.i32, // returns pointer
    );

    // Collect all type declarations for record/union layout
    for (const decl of module.declarations) {
      if (decl.kind === "TypeDecl") {
        const resolved = this.checker.resolveTypeRef({
          kind: "TypeRef", name: decl.name, typeArgs: [],
          span: decl.span,
        });
        if (resolved) {
          this.allTypeDecls.set(decl.name, resolved);
        }
      }
    }

    // Collect all function declarations for cross-reference
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        this.allFunctions.set(decl.name, decl);
      }
    }

    // Scan function signatures for built-in union types (e.g. Option<T>)
    // that aren't declared as TypeDecl but are used as param/return types
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        const allTypeNodes = [...decl.params.map(p => p.typeAnnotation), decl.returnType];
        for (const typeNode of allTypeNodes) {
          const resolved = this.checker.resolveTypeRef(typeNode);
          if (resolved && resolved.kind === "Union" && !this.allTypeDecls.has(resolved.name)) {
            this.allTypeDecls.set(resolved.name, resolved);
          }
        }
      }
    }

    // Register Option<T> types from the checker's polymorphism registry
    for (const [name, type] of this.checker.getOptionTypes()) {
      if (!this.allTypeDecls.has(name)) {
        this.allTypeDecls.set(name, type);
      }
    }

    // Register Result<T, E> types from the checker's polymorphism registry
    for (const [, type] of this.checker.getResultTypes()) {
      if (type.kind === "Union" && !this.allTypeDecls.has(type.name)) {
        this.allTypeDecls.set(type.name, type);
      }
    }

    // Pre-scan AST for all string literals to build data segments before setMemory.
    // This is required because binaryen needs memory to exist before we create
    // load/store instructions in functions.
    this.prescanStringLiterals(module);

    // Set memory with pre-scanned data segments BEFORE generating functions
    // so that i32.load/i32.store instructions in generated code are valid.
    const segments = this.dataSegments.map((seg) => ({
      name: `str_${seg.offset}`,
      offset: this.mod.i32.const(seg.offset),
      data: seg.data,
      passive: false,
    }));
    this.mod.setMemory(1, 256, "memory", segments);

    // Build function table index map (before generating functions so codegen can reference indices)
    // Skip generic functions — they are monomorphized at call sites
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl" && decl.typeParams.length === 0) {
        this.functionTableIndices.set(decl.name, this.functionTableNames.length);
        this.functionTableNames.push(decl.name);
      }
    }

    // Generate all non-generic functions (generic functions are monomorphized on demand)
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl" && decl.typeParams.length === 0) {
        this.generateFunction(decl);
      }
    }

    // Set up function table for indirect calls (if any functions exist)
    if (this.functionTableNames.length > 0) {
      this.mod.addTable("0", this.functionTableNames.length, this.functionTableNames.length);
      this.mod.addActiveElementSegment(
        "0", "funcs",
        this.functionTableNames,
        this.mod.i32.const(0),
      );
    }

    // Export the heap base so the runtime knows where dynamic allocation starts
    this.mod.addGlobal("__heap_base", binaryen.i32, false, this.mod.i32.const(this.dataSegmentOffset || 1024));
    this.mod.addGlobalExport("__heap_base", "__heap_base");
  }

  /**
   * Set up WASM module from multiple Clarity modules merged into one.
   * All modules' declarations are compiled. Only the entry module's exported
   * functions are WASM-exported.
   */
  private setupModuleMulti(allModules: ModuleDecl[], entryModule: ModuleDecl): void {
    // Register built-in function imports
    for (const builtin of getBuiltins()) {
      this.mod.addFunctionImport(
        builtin.name,
        builtin.importModule,
        builtin.importName,
        builtin.params,
        builtin.result,
      );
    }

    this.mod.addFunctionImport("__alloc", "env", "__alloc", binaryen.i32, binaryen.i32);

    // Collect all declarations across all modules
    const allDecls = allModules.flatMap(m => m.declarations);

    // Collect all type declarations
    for (const decl of allDecls) {
      if (decl.kind === "TypeDecl") {
        const resolved = this.checker.resolveTypeRef({
          kind: "TypeRef", name: decl.name, typeArgs: [],
          span: decl.span,
        });
        if (resolved) {
          this.allTypeDecls.set(decl.name, resolved);
        }
      }
    }

    // Collect all function declarations
    for (const decl of allDecls) {
      if (decl.kind === "FunctionDecl") {
        this.allFunctions.set(decl.name, decl);
      }
    }

    // Scan function signatures for built-in union types
    for (const decl of allDecls) {
      if (decl.kind === "FunctionDecl") {
        const allTypeNodes = [...decl.params.map(p => p.typeAnnotation), decl.returnType];
        for (const typeNode of allTypeNodes) {
          const resolved = this.checker.resolveTypeRef(typeNode);
          if (resolved && resolved.kind === "Union" && !this.allTypeDecls.has(resolved.name)) {
            this.allTypeDecls.set(resolved.name, resolved);
          }
        }
      }
    }

    // Register Option<T> and Result<T, E> types
    for (const [name, type] of this.checker.getOptionTypes()) {
      if (!this.allTypeDecls.has(name)) this.allTypeDecls.set(name, type);
    }
    for (const [, type] of this.checker.getResultTypes()) {
      if (type.kind === "Union" && !this.allTypeDecls.has(type.name)) {
        this.allTypeDecls.set(type.name, type);
      }
    }

    // Pre-scan ALL modules for string literals
    for (const mod of allModules) {
      this.prescanStringLiterals(mod);
    }

    // Set memory
    const segments = this.dataSegments.map((seg) => ({
      name: `str_${seg.offset}`,
      offset: this.mod.i32.const(seg.offset),
      data: seg.data,
      passive: false,
    }));
    this.mod.setMemory(1, 256, "memory", segments);

    // Build function table (all non-generic functions from all modules)
    for (const decl of allDecls) {
      if (decl.kind === "FunctionDecl" && decl.typeParams.length === 0) {
        this.functionTableIndices.set(decl.name, this.functionTableNames.length);
        this.functionTableNames.push(decl.name);
      }
    }

    // Track which functions belong to the entry module for WASM export
    const entryFunctionNames = new Set<string>();
    for (const decl of entryModule.declarations) {
      if (decl.kind === "FunctionDecl") {
        entryFunctionNames.add(decl.name);
      }
    }

    // Generate all non-generic functions from all modules
    for (const decl of allDecls) {
      if (decl.kind === "FunctionDecl" && decl.typeParams.length === 0) {
        this.generateFunctionMulti(decl, entryFunctionNames);
      }
    }

    // Set up function table
    if (this.functionTableNames.length > 0) {
      this.mod.addTable("0", this.functionTableNames.length, this.functionTableNames.length);
      this.mod.addActiveElementSegment("0", "funcs", this.functionTableNames, this.mod.i32.const(0));
    }

    // Export heap base
    this.mod.addGlobal("__heap_base", binaryen.i32, false, this.mod.i32.const(this.dataSegmentOffset || 1024));
    this.mod.addGlobalExport("__heap_base", "__heap_base");
  }

  // ============================================================
  // Result<T, E> → Union conversion
  // ============================================================

  // Convert a Result<T, E> type to its Union representation for codegen.
  private resolveResultToUnion(type: ClarityType): ClarityType {
    if (type.kind === "Result") {
      return this.checker.resultToUnion(type);
    }
    return type;
  }

  // ============================================================
  // String Literal Pre-Scanning
  // ============================================================

  // Pre-scan the entire AST for string literals and allocate data segments
  // so that setMemory can be called before function generation.
  private prescanStringLiterals(module: ModuleDecl): void {
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        this.scanExprForStrings(decl.body);
      }
    }
  }

  private scanExprForStrings(expr: Expr): void {
    switch (expr.kind) {
      case "StringLiteral":
        this.allocStringLiteral(expr.value);
        break;
      case "BinaryExpr":
        this.scanExprForStrings(expr.left);
        this.scanExprForStrings(expr.right);
        break;
      case "UnaryExpr":
        this.scanExprForStrings(expr.operand);
        break;
      case "CallExpr":
        for (const arg of expr.args) this.scanExprForStrings(arg.value);
        if (expr.callee.kind !== "IdentifierExpr") this.scanExprForStrings(expr.callee);
        break;
      case "MatchExpr":
        this.scanExprForStrings(expr.scrutinee);
        for (const arm of expr.arms) {
          this.scanExprForStrings(arm.body);
          if (arm.pattern.kind === "LiteralPattern") this.scanExprForStrings(arm.pattern.value);
        }
        break;
      case "LetExpr":
        this.scanExprForStrings(expr.value);
        break;
      case "AssignmentExpr":
        this.scanExprForStrings(expr.value);
        break;
      case "BlockExpr":
        for (const stmt of expr.statements) this.scanExprForStrings(stmt);
        if (expr.result) this.scanExprForStrings(expr.result);
        break;
      case "MemberExpr":
        this.scanExprForStrings(expr.object);
        break;
      case "ListLiteral":
        for (const elem of expr.elements) this.scanExprForStrings(elem);
        break;
      case "RecordLiteral":
        for (const field of expr.fields) this.scanExprForStrings(field.value);
        break;
      case "LambdaExpr":
        this.scanExprForStrings(expr.body);
        break;
    }
  }

  // ============================================================
  // Memory Layout Helpers
  // ============================================================

  // Returns the size in bytes of a ClarityType when stored in linear memory.
  private fieldSize(type: ClarityType): number {
    switch (type.kind) {
      case "Int64": return 8;
      case "Float64": return 8;
      case "Timestamp": return 8; // i64 ms since epoch
      case "Bool": return 4;
      case "Unit": return 0;
      // Pointer types (i32)
      case "String":
      case "Record":
      case "Union":
      case "List":
      case "Map":    // Map handle (opaque i32)
      case "Option":
      case "Result":
      case "Bytes":
        return 4;
      default: return 4;
    }
  }

  // Returns field alignment
  private fieldAlign(type: ClarityType): number {
    switch (type.kind) {
      case "Int64": return 8;
      case "Float64": return 8;
      case "Timestamp": return 8;
      default: return 4;
    }
  }

  // Compute record layout: returns array of { name, type, offset }
  private recordLayout(fields: Map<string, ClarityType>): { name: string; type: ClarityType; offset: number }[] {
    const layout: { name: string; type: ClarityType; offset: number }[] = [];
    let offset = 0;
    for (const [name, type] of fields) {
      const align = this.fieldAlign(type);
      offset = (offset + align - 1) & ~(align - 1); // align up
      layout.push({ name, type, offset });
      offset += this.fieldSize(type);
    }
    return layout;
  }

  // Total size of a record
  private recordSize(fields: Map<string, ClarityType>): number {
    let offset = 0;
    for (const [, type] of fields) {
      const align = this.fieldAlign(type);
      offset = (offset + align - 1) & ~(align - 1);
      offset += this.fieldSize(type);
    }
    return (offset + 3) & ~3; // pad to 4-byte boundary
  }

  // Total size of a union (tag + max variant payload)
  private unionSize(variants: ClarityVariant[]): number {
    let maxPayload = 0;
    for (const v of variants) {
      const payloadSize = this.recordSize(v.fields);
      if (payloadSize > maxPayload) maxPayload = payloadSize;
    }
    return 4 + maxPayload; // 4 bytes for tag
  }

  // Generate a store instruction for a specific ClarityType
  private storeField(basePtr: binaryen.ExpressionRef, offset: number, value: binaryen.ExpressionRef, type: ClarityType): binaryen.ExpressionRef {
    switch (type.kind) {
      case "Int64":
        return this.mod.i64.store(offset, 4, basePtr, value);
      case "Float64":
        return this.mod.f64.store(offset, 4, basePtr, value);
      default:
        // i32 (Bool, String, pointers)
        return this.mod.i32.store(offset, 4, basePtr, value);
    }
  }

  // Generate a load instruction for a specific ClarityType
  private loadField(basePtr: binaryen.ExpressionRef, offset: number, type: ClarityType): binaryen.ExpressionRef {
    switch (type.kind) {
      case "Int64":
        return this.mod.i64.load(offset, 4, basePtr);
      case "Float64":
        return this.mod.f64.load(offset, 4, basePtr);
      default:
        return this.mod.i32.load(offset, 4, basePtr);
    }
  }

  // ============================================================
  // String Data Segments
  // ============================================================

  // Allocate a string literal in the data segment.
  // Layout: [length: u32 LE][utf8 bytes]
  private allocStringLiteral(value: string): number {
    const existing = this.stringLiterals.get(value);
    if (existing !== undefined) return existing;

    const encoded = new TextEncoder().encode(value);
    const ptr = this.dataSegmentOffset;

    const data = new Uint8Array(4 + encoded.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, encoded.length, true);
    data.set(encoded, 4);

    this.dataSegments.push({ offset: ptr, data });
    this.stringLiterals.set(value, ptr);

    this.dataSegmentOffset = ptr + data.length;
    this.dataSegmentOffset = (this.dataSegmentOffset + 3) & ~3;

    return ptr;
  }

  // ============================================================
  // Function Generation
  // ============================================================

  // Lambda lifting: emit the lambda body as a top-level WASM function,
  // register it in the function table, and return its table index as an i32.const.
  private liftLambda(lambda: import("../ast/nodes.js").LambdaExpr): binaryen.ExpressionRef {
    const name = `__lambda_${this.lambdaCounter++}`;
    lambda.liftedName = name;

    // Save caller's local state
    const savedFunction = this.currentFunction;
    const savedLocals = this.locals;
    const savedLocalIndex = this.localIndex;
    const savedAdditionalLocals = this.additionalLocals;

    // Set up fresh local frame for the lambda body
    this.locals = new Map();
    this.localIndex = 0;
    this.additionalLocals = [];

    const paramWasmTypes: binaryen.Type[] = [];
    for (const param of lambda.params) {
      const ct = this.checker.resolveTypeRef(param.typeAnnotation) ?? { kind: "Error" } as ClarityType;
      const wasmType = clarityTypeToWasm(ct);
      this.locals.set(param.name, { index: this.localIndex, wasmType, clarityType: ct });
      paramWasmTypes.push(wasmType);
      this.localIndex++;
    }

    const returnType = this.inferExprType(lambda.body);
    const returnWasmType = clarityTypeToWasm(returnType);
    const body = this.generateExpr(lambda.body, returnType);

    this.mod.addFunction(name, binaryen.createType(paramWasmTypes), returnWasmType, this.additionalLocals, body);

    // Register in function table so it can be used with call_indirect
    const tableIndex = this.functionTableNames.length;
    this.functionTableIndices.set(name, tableIndex);
    this.functionTableNames.push(name);

    // Restore caller's local state
    this.currentFunction = savedFunction;
    this.locals = savedLocals;
    this.localIndex = savedLocalIndex;
    this.additionalLocals = savedAdditionalLocals;

    return this.mod.i32.const(tableIndex);
  }

  private generateFunction(decl: FunctionDecl): void {
    this.currentFunction = decl;
    this.locals = new Map();
    this.localIndex = 0;
    this.additionalLocals = [];

    const paramWasmTypes: binaryen.Type[] = [];
    for (const param of decl.params) {
      const ct = assertResolvedType(
        this.checker.resolveTypeRef(param.typeAnnotation),
        `parameter '${param.name}' in '${decl.name}'`,
      );
      const wasmType = clarityTypeToWasm(ct);
      this.locals.set(param.name, {
        index: this.localIndex,
        wasmType,
        clarityType: ct,
      });
      paramWasmTypes.push(wasmType);
      this.localIndex++;
    }

    const returnClarityType = assertResolvedType(
      this.checker.resolveTypeRef(decl.returnType),
      `return type of '${decl.name}'`,
    );
    const returnWasmType = clarityTypeToWasm(returnClarityType);
    const paramsType = binaryen.createType(paramWasmTypes);

    // Check if the function is tail-recursive and apply TCO
    const isTailRec = this.isTailRecursive(decl.body, decl.name);

    let body: binaryen.ExpressionRef;
    if (isTailRec) {
      body = this.generateTailRecursiveBody(decl, returnClarityType, returnWasmType);
    } else {
      body = this.generateExpr(decl.body, returnClarityType);
    }

    this.mod.addFunction(
      decl.name,
      paramsType,
      returnWasmType,
      this.additionalLocals,
      body,
    );
    this.mod.addFunctionExport(decl.name, decl.name);
  }

  /**
   * Generate a function for multi-module compilation.
   * Only WASM-exports functions that belong to the entry module.
   */
  private generateFunctionMulti(decl: FunctionDecl, entryFunctionNames: Set<string>): void {
    this.currentFunction = decl;
    this.locals = new Map();
    this.localIndex = 0;
    this.additionalLocals = [];

    const paramWasmTypes: binaryen.Type[] = [];
    for (const param of decl.params) {
      const ct = assertResolvedType(
        this.checker.resolveTypeRef(param.typeAnnotation),
        `parameter '${param.name}' in '${decl.name}'`,
      );
      const wasmType = clarityTypeToWasm(ct);
      this.locals.set(param.name, {
        index: this.localIndex,
        wasmType,
        clarityType: ct,
      });
      paramWasmTypes.push(wasmType);
      this.localIndex++;
    }

    const returnClarityType = assertResolvedType(
      this.checker.resolveTypeRef(decl.returnType),
      `return type of '${decl.name}'`,
    );
    const returnWasmType = clarityTypeToWasm(returnClarityType);
    const paramsType = binaryen.createType(paramWasmTypes);

    const isTailRec = this.isTailRecursive(decl.body, decl.name);

    let body: binaryen.ExpressionRef;
    if (isTailRec) {
      body = this.generateTailRecursiveBody(decl, returnClarityType, returnWasmType);
    } else {
      body = this.generateExpr(decl.body, returnClarityType);
    }

    this.mod.addFunction(decl.name, paramsType, returnWasmType, this.additionalLocals, body);

    // Only WASM-export functions from the entry module
    if (entryFunctionNames.has(decl.name)) {
      this.mod.addFunctionExport(decl.name, decl.name);
    }
  }

  // ============================================================
  // Tail Call Optimization
  // ============================================================

  // Check if an expression contains a self-recursive tail call
  private isTailRecursive(expr: Expr, funcName: string): boolean {
    switch (expr.kind) {
      case "CallExpr":
        return expr.callee.kind === "IdentifierExpr" && expr.callee.name === funcName;
      case "BlockExpr":
        if (expr.result) return this.isTailRecursive(expr.result, funcName);
        return false;
      case "MatchExpr":
        return expr.arms.some(arm => this.isTailRecursive(arm.body, funcName));
      default:
        return false;
    }
  }

  // Generate a loop-based body for a tail-recursive function
  private generateTailRecursiveBody(
    decl: FunctionDecl,
    returnClarityType: ClarityType,
    returnWasmType: binaryen.Type,
  ): binaryen.ExpressionRef {
    // The body is wrapped in a loop. Tail calls become:
    //   1. Set param locals to new argument values
    //   2. Branch back to the loop start
    const loopLabel = `$tco_${decl.name}`;
    const innerBody = this.generateExprTCO(decl.body, returnClarityType, decl.name, loopLabel);
    return this.mod.loop(loopLabel, innerBody);
  }

  // Generate an expression with tail-call optimization awareness
  private generateExprTCO(
    expr: Expr,
    expectedType: ClarityType | undefined,
    funcName: string,
    loopLabel: string,
  ): binaryen.ExpressionRef {
    switch (expr.kind) {
      case "CallExpr": {
        // Check if this is a tail call to self
        if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === funcName) {
          return this.generateTailCallUpdate(expr, funcName, loopLabel);
        }
        // Not a tail call — generate normally
        return this.generateExpr(expr, expectedType);
      }
      case "BlockExpr": {
        const stmts: binaryen.ExpressionRef[] = [];
        for (const stmt of expr.statements) {
          const generated = this.generateExpr(stmt);
          if (stmt.kind !== "LetExpr" && stmt.kind !== "AssignmentExpr") {
            const stmtType = this.inferExprType(stmt);
            if (stmtType.kind === "Unit") {
              stmts.push(generated);
            } else {
              stmts.push(this.mod.drop(generated));
            }
          } else {
            stmts.push(generated);
          }
        }
        if (expr.result) {
          stmts.push(this.generateExprTCO(expr.result, expectedType, funcName, loopLabel));
        }
        if (stmts.length === 0) return this.mod.nop();
        if (stmts.length === 1) return stmts[0];
        const resultType = expr.result
          ? clarityTypeToWasm(this.inferExprType(expr.result))
          : binaryen.none;
        return this.mod.block(null, stmts, resultType);
      }
      case "MatchExpr": {
        return this.generateMatchTCO(expr, expectedType, funcName, loopLabel);
      }
      default:
        return this.generateExpr(expr, expectedType);
    }
  }

  // Generate a tail call: update params and branch back to loop
  private generateTailCallUpdate(
    expr: import("../ast/nodes.js").CallExpr,
    funcName: string,
    loopLabel: string,
  ): binaryen.ExpressionRef {
    const decl = this.currentFunction;
    const stmts: binaryen.ExpressionRef[] = [];

    // First, evaluate all new argument values into temp locals
    // (to avoid issues when arg expressions reference current params)
    const tempLocals: number[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      const argExpr = this.generateExpr(expr.args[i].value);
      const paramLocal = this.locals.get(decl.params[i].name)!;
      const tempIdx = this.localIndex++;
      this.additionalLocals.push(paramLocal.wasmType);
      tempLocals.push(tempIdx);
      stmts.push(this.mod.local.set(tempIdx, argExpr));
    }

    // Then assign temps to param locals
    for (let i = 0; i < expr.args.length; i++) {
      const paramLocal = this.locals.get(decl.params[i].name)!;
      stmts.push(
        this.mod.local.set(
          paramLocal.index,
          this.mod.local.get(tempLocals[i], paramLocal.wasmType),
        ),
      );
    }

    // Branch back to the loop start
    stmts.push(this.mod.br(loopLabel));

    return this.mod.block(null, stmts, binaryen.none);
  }

  // Generate a match expression with TCO in arms
  private generateMatchTCO(
    matchExpr: import("../ast/nodes.js").MatchExpr,
    expectedType: ClarityType | undefined,
    funcName: string,
    loopLabel: string,
  ): binaryen.ExpressionRef {
    const scrutinee = this.generateExpr(matchExpr.scrutinee);
    const scrutineeType = this.inferExprType(matchExpr.scrutinee);

    if (scrutineeType.kind === "Bool") {
      return this.generateBoolMatchTCO(scrutinee, matchExpr.arms, expectedType, funcName, loopLabel);
    }

    if (scrutineeType.kind === "Union") {
      return this.generateUnionMatchTCO(scrutinee, scrutineeType, matchExpr.arms, expectedType, funcName, loopLabel);
    }

    // For other types, generate normally (TCO in arms)
    return this.generateGenericMatchTCO(scrutinee, scrutineeType, matchExpr.arms, expectedType, funcName, loopLabel);
  }

  private generateBoolMatchTCO(
    scrutinee: binaryen.ExpressionRef,
    arms: import("../ast/nodes.js").MatchArm[],
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
          trueBody = this.generateExprTCO(arm.body, expectedType, funcName, loopLabel);
        } else {
          falseBody = this.generateExprTCO(arm.body, expectedType, funcName, loopLabel);
        }
      } else if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        wildcardBody = this.generateExprTCO(arm.body, expectedType, funcName, loopLabel);
      }
    }

    const ifTrue = trueBody ?? wildcardBody ?? this.mod.unreachable();
    const ifFalse = falseBody ?? wildcardBody ?? this.mod.unreachable();
    return this.mod.if(scrutinee, ifTrue, ifFalse);
  }

  private generateUnionMatchTCO(
    scrutinee: binaryen.ExpressionRef,
    unionType: Extract<ClarityType, { kind: "Union" }>,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType: ClarityType | undefined,
    funcName: string,
    loopLabel: string,
  ): binaryen.ExpressionRef {
    // Store scrutinee pointer in a temp
    const ptrLocal = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);
    const setPtr = this.mod.local.set(ptrLocal, scrutinee);
    const getPtr = () => this.mod.local.get(ptrLocal, binaryen.i32);

    // Read the tag
    const tagLocal = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);
    const setTag = this.mod.local.set(tagLocal, this.mod.i32.load(0, 4, getPtr()));
    const getTag = () => this.mod.local.get(tagLocal, binaryen.i32);

    let result: binaryen.ExpressionRef = this.mod.unreachable();

    for (let i = arms.length - 1; i >= 0; i--) {
      const arm = arms[i];

      if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        if (arm.pattern.kind === "BindingPattern") {
          const bindLocal = this.localIndex++;
          this.additionalLocals.push(binaryen.i32);
          this.locals.set(arm.pattern.name, {
            index: bindLocal,
            wasmType: binaryen.i32,
            clarityType: unionType,
          });
          result = this.mod.block(null, [
            this.mod.local.set(bindLocal, getPtr()),
            this.generateExprTCO(arm.body, expectedType, funcName, loopLabel),
          ]);
        } else {
          result = this.generateExprTCO(arm.body, expectedType, funcName, loopLabel);
        }
      } else if (arm.pattern.kind === "ConstructorPattern") {
        const ctorPattern = arm.pattern as import("../ast/nodes.js").ConstructorPattern;
        const variantIndex = unionType.variants.findIndex((v) => v.name === ctorPattern.name);
        if (variantIndex === -1) continue;
        const variant = unionType.variants[variantIndex];

        const layout = this.recordLayout(variant.fields);
        const fieldEntries = [...variant.fields.entries()];

        for (let fi = 0; fi < ctorPattern.fields.length && fi < fieldEntries.length; fi++) {
          const pat = ctorPattern.fields[fi];
          if (pat.pattern.kind === "BindingPattern") {
            const fieldType = fieldEntries[fi][1];
            const wasmType = clarityTypeToWasm(fieldType);
            const localIdx = this.localIndex++;
            this.additionalLocals.push(wasmType);
            this.locals.set(pat.pattern.name, {
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
            const fieldOffset = layout[fi].offset + 4;
            const local = this.locals.get(pat.pattern.name)!;
            bodyStmts.push(
              this.mod.local.set(local.index, this.loadField(getPtr(), fieldOffset, fieldType)),
            );
          }
        }

        bodyStmts.push(this.generateExprTCO(arm.body, expectedType, funcName, loopLabel));

        const bodyBlock = bodyStmts.length === 1
          ? bodyStmts[0]
          : this.mod.block(null, bodyStmts, expectedType ? clarityTypeToWasm(expectedType) : undefined);

        const cond = this.mod.i32.eq(getTag(), this.mod.i32.const(variantIndex));
        result = this.mod.if(cond, bodyBlock, result);
      }
    }

    const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
    return this.mod.block(null, [setPtr, setTag, result], matchResultType);
  }

  private generateGenericMatchTCO(
    scrutinee: binaryen.ExpressionRef,
    scrutineeType: ClarityType,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType: ClarityType | undefined,
    funcName: string,
    loopLabel: string,
  ): binaryen.ExpressionRef {
    const wasmType = clarityTypeToWasm(scrutineeType);
    const tempIndex = this.localIndex++;
    this.additionalLocals.push(wasmType);
    const setTemp = this.mod.local.set(tempIndex, scrutinee);
    const getTemp = () => this.mod.local.get(tempIndex, wasmType);

    let result: binaryen.ExpressionRef = this.mod.unreachable();

    for (let i = arms.length - 1; i >= 0; i--) {
      const arm = arms[i];
      const body = this.generateExprTCO(arm.body, expectedType, funcName, loopLabel);

      if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        if (arm.pattern.kind === "BindingPattern") {
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
      } else if (arm.pattern.kind === "RangePattern") {
        const cond = this.generateRangePatternCondition(getTemp, arm.pattern);
        result = this.mod.if(cond, body, result);
      }
    }

    const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
    return this.mod.block(null, [setTemp, result], matchResultType);
  }

  // ============================================================
  // Expression Generation
  // ============================================================

  private generateExpr(expr: Expr, expectedType?: ClarityType): binaryen.ExpressionRef {
    switch (expr.kind) {
      case "IntLiteral": {
        const val = expr.value;
        const low = Number(val & BigInt(0xFFFFFFFF));
        const high = Number((val >> BigInt(32)) & BigInt(0xFFFFFFFF));
        return this.mod.i64.const(low, high);
      }

      case "FloatLiteral":
        return this.mod.f64.const(expr.value);

      case "BoolLiteral":
        return this.mod.i32.const(expr.value ? 1 : 0);

      case "StringLiteral": {
        const ptr = this.allocStringLiteral(expr.value);
        return this.mod.i32.const(ptr);
      }

      case "IdentifierExpr": {
        const local = this.locals.get(expr.name);
        if (local) {
          return this.mod.local.get(local.index, local.wasmType);
        }
        // Check if this is a zero-field union variant constructor (e.g. NoneVal)
        const ctorInfo = this.findConstructorType(expr.name);
        if (ctorInfo && ctorInfo.variant.fields.size === 0) {
          return this.generateConstructorCall(expr.name, ctorInfo, []);
        }
        // Check if this is a function reference (for higher-order functions)
        const tableIndex = this.functionTableIndices.get(expr.name);
        if (tableIndex !== undefined) {
          return this.mod.i32.const(tableIndex);
        }
        throw new Error(`Undefined variable in codegen: ${expr.name}`);
      }

      case "BinaryExpr":
        return this.generateBinary(expr.op, expr.left, expr.right);

      case "UnaryExpr":
        return this.generateUnary(expr.op, expr.operand);

      case "CallExpr":
        return this.generateCall(expr);

      case "MatchExpr":
        return this.generateMatch(expr, expectedType);

      case "LetExpr": {
        const clarityType = this.inferExprType(expr.value);
        const value = this.generateExpr(expr.value, clarityType);
        if (expr.name === "_") {
          return this.mod.drop(value);
        }
        const wasmType = clarityTypeToWasm(clarityType);
        const index = this.localIndex++;
        this.additionalLocals.push(wasmType);
        this.locals.set(expr.name, { index, wasmType, clarityType });
        return this.mod.local.set(index, value);
      }

      case "AssignmentExpr": {
        const local = this.locals.get(expr.name);
        if (!local) {
          throw new Error(`Undefined variable in codegen: ${expr.name}`);
        }
        const value = this.generateExpr(expr.value);
        return this.mod.local.set(local.index, value);
      }

      case "BlockExpr": {
        const stmts: binaryen.ExpressionRef[] = [];
        for (const stmt of expr.statements) {
          const generated = this.generateExpr(stmt);
          if (stmt.kind !== "LetExpr" && stmt.kind !== "AssignmentExpr") {
            // Only drop if the expression produces a value (not void/none)
            const stmtType = this.inferExprType(stmt);
            if (stmtType.kind === "Unit") {
              stmts.push(generated);
            } else {
              stmts.push(this.mod.drop(generated));
            }
          } else {
            stmts.push(generated);
          }
        }
        if (expr.result) {
          stmts.push(this.generateExpr(expr.result, expectedType));
        }

        if (stmts.length === 0) return this.mod.nop();
        if (stmts.length === 1) return stmts[0];

        const resultType = expr.result
          ? clarityTypeToWasm(this.inferExprType(expr.result))
          : binaryen.none;
        return this.mod.block(null, stmts, resultType);
      }

      case "ListLiteral":
        return this.generateListLiteral(expr);

      case "RecordLiteral":
        return this.generateRecordLiteral(expr);

      case "MemberExpr":
        return this.generateMemberAccess(expr);

      case "LambdaExpr":
        return this.liftLambda(expr);

      default:
        throw new Error(`Unsupported expression kind in codegen: ${(expr as any).kind}`);
    }
  }

  // ============================================================
  // Call Generation (including record/union constructors)
  // ============================================================

  private generateCall(expr: import("../ast/nodes.js").CallExpr): binaryen.ExpressionRef {
    if (expr.callee.kind !== "IdentifierExpr") {
      throw new Error("Only direct function calls supported in MVP");
    }

    const name = expr.callee.name;

    // Check if calling a function-typed local variable (indirect call)
    const local = this.locals.get(name);
    if (local && local.clarityType.kind === "Function") {
      return this.generateIndirectCall(expr, local, local.clarityType);
    }

    // Check if this is a union variant constructor or a regular function
    const constructorType = this.findConstructorType(name);
    if (constructorType) {
      return this.generateConstructorCall(name, constructorType, expr.args);
    }

    // List operation special cases
    const listCall = this.tryGenerateListCall(name, expr);
    if (listCall) return listCall;

    // Map operation special cases
    const mapCall = this.tryGenerateMapCall(name, expr);
    if (mapCall) return mapCall;

    // Check if this is a call to a generic function that needs monomorphization
    const targetDecl = this.allFunctions.get(name);
    if (targetDecl && targetDecl.typeParams.length > 0) {
      return this.generateMonomorphizedCall(expr, targetDecl);
    }

    // Regular function call
    const args = expr.args.map((a) => this.generateExpr(a.value));
    return this.mod.call(name, args, this.inferWasmReturnType(name));
  }

  // Resolve a type reference with type parameter names treated as TypeVars.
  // Recursively handles generic wrapper types (List<T>, Option<T>, Result<T,E>,
  // Map<K,V>) and function types ((T)->U) so that nested type parameters are
  // preserved as TypeVar nodes rather than being dropped as "unknown".
  private resolveTypeRefWithTypeParams(node: import("../ast/nodes.js").TypeNode, typeParams: string[]): ClarityType {
    // Function type: (T) -> U
    if (node.kind === "FunctionType") {
      return {
        kind: "Function",
        params: node.paramTypes.map(pt => this.resolveTypeRefWithTypeParams(pt, typeParams)),
        returnType: this.resolveTypeRefWithTypeParams(node.returnType, typeParams),
        effects: new Set(),
      };
    }

    // Bare type parameter: T
    if (node.kind === "TypeRef" && typeParams.includes(node.name) && node.typeArgs.length === 0) {
      return { kind: "TypeVar", name: node.name };
    }

    // Generic wrapper type with type arguments: List<T>, Option<T>, etc.
    if (node.kind === "TypeRef" && node.typeArgs.length > 0) {
      const args = node.typeArgs.map(a => this.resolveTypeRefWithTypeParams(a, typeParams));
      switch (node.name) {
        case "List":
          return { kind: "List", element: assertResolvedType(args[0], `List element type in '${node.name}'`) };
        case "Option":
          return { kind: "Option", inner: assertResolvedType(args[0], `Option inner type in '${node.name}'`) };
        case "Result":
          return { kind: "Result",
            ok: assertResolvedType(args[0], `Result ok type`),
            err: assertResolvedType(args[1], `Result err type`),
          };
        case "Map":
          return { kind: "Map",
            key: assertResolvedType(args[0], `Map key type`),
            value: assertResolvedType(args[1], `Map value type`),
          };
      }
    }

    return assertResolvedType(this.checker.resolveTypeRef(node), `type '${(node as any).name ?? "unknown"}'`);
  }

  private generateMonomorphizedCall(
    expr: import("../ast/nodes.js").CallExpr,
    genericDecl: FunctionDecl,
  ): binaryen.ExpressionRef {
    // Infer type bindings from argument types
    const bindings = new Map<string, ClarityType>();
    for (let i = 0; i < expr.args.length; i++) {
      const argType = this.inferExprType(expr.args[i].value);
      const paramType = this.resolveTypeRefWithTypeParams(
        genericDecl.params[i].typeAnnotation, genericDecl.typeParams,
      );
      unifyTypes(paramType, argType, bindings);
    }

    // Build monomorphized function name: funcName$T1$T2
    const typeKey = genericDecl.typeParams.map(tp => {
      const bound = bindings.get(tp);
      return bound ? typeToString(bound) : "unknown";
    }).join("$");
    const monoName = `${genericDecl.name}$${typeKey}`;

    // Generate the monomorphized function if not already done
    if (!this.generatedMonomorphs.has(monoName)) {
      this.generatedMonomorphs.add(monoName);

      // Save current function state
      const savedLocals = this.locals;
      const savedLocalIndex = this.localIndex;
      const savedAdditionalLocals = this.additionalLocals;
      const savedCurrentFunction = this.currentFunction;
      const savedTypeVarSubst = this.typeVarSubst;

      // Set up new function context
      this.locals = new Map();
      this.localIndex = 0;
      this.additionalLocals = [];
      this.currentFunction = genericDecl;
      // Install the concrete type bindings so that inferExprType substitutes
      // TypeVars that the checker left in resolvedType annotations inside this body.
      this.typeVarSubst = bindings;

      const paramWasmTypes: binaryen.Type[] = [];
      for (const param of genericDecl.params) {
        const genericType = this.resolveTypeRefWithTypeParams(
          param.typeAnnotation, genericDecl.typeParams,
        );
        const concreteType = substituteTypeVars(genericType, bindings);
        const wasmType = clarityTypeToWasm(concreteType);
        this.locals.set(param.name, {
          index: this.localIndex,
          wasmType,
          clarityType: concreteType,
        });
        paramWasmTypes.push(wasmType);
        this.localIndex++;
      }

      const genericReturnType = this.resolveTypeRefWithTypeParams(
        genericDecl.returnType, genericDecl.typeParams,
      );
      const concreteReturnType = substituteTypeVars(genericReturnType, bindings);
      const returnWasmType = clarityTypeToWasm(concreteReturnType);
      const paramsType = binaryen.createType(paramWasmTypes);

      const body = this.generateExpr(genericDecl.body, concreteReturnType);

      this.mod.addFunction(monoName, paramsType, returnWasmType, this.additionalLocals, body);
      this.mod.addFunctionExport(monoName, monoName);

      // Restore previous function state
      this.locals = savedLocals;
      this.localIndex = savedLocalIndex;
      this.additionalLocals = savedAdditionalLocals;
      this.currentFunction = savedCurrentFunction;
      this.typeVarSubst = savedTypeVarSubst;
    }

    // Generate the call to the monomorphized function
    const args = expr.args.map((a) => this.generateExpr(a.value));
    const genericReturnType = this.resolveTypeRefWithTypeParams(
      genericDecl.returnType, genericDecl.typeParams,
    );
    const concreteReturn = substituteTypeVars(genericReturnType, bindings);
    return this.mod.call(monoName, args, clarityTypeToWasm(concreteReturn));
  }

  private generateIndirectCall(
    expr: import("../ast/nodes.js").CallExpr,
    local: LocalVar,
    fnType: Extract<ClarityType, { kind: "Function" }>,
  ): binaryen.ExpressionRef {
    const funcIndexExpr = this.mod.local.get(local.index, binaryen.i32);
    const args = expr.args.map((a) => this.generateExpr(a.value));
    const paramWasmTypes = fnType.params.map(clarityTypeToWasm);
    const returnWasmType = clarityTypeToWasm(fnType.returnType);
    return this.mod.call_indirect(
      "0",
      funcIndexExpr,
      args,
      binaryen.createType(paramWasmTypes),
      returnWasmType,
    );
  }

  // Handle user-facing list operations by mapping them to runtime functions
  private tryGenerateListCall(name: string, expr: import("../ast/nodes.js").CallExpr): binaryen.ExpressionRef | null {
    switch (name) {
      case "length": {
        const listArg = this.generateExpr(expr.args[0].value);
        return this.mod.call("list_length", [listArg], binaryen.i64);
      }
      case "head": {
        const listArg = this.generateExpr(expr.args[0].value);
        const listType = this.inferExprType(expr.args[0].value);
        if (listType.kind !== "List") return null;
        const elemType = listType.element;
        if (elemType.kind === "Int64" || elemType.kind === "Float64") {
          return this.mod.call("list_head_i64", [listArg], binaryen.i64);
        }
        // For pointer types (String, Record, etc.) use i32 getter
        return this.mod.call("list_get_i32", [listArg, this.mod.i64.const(0, 0)], binaryen.i32);
      }
      case "tail": {
        const listArg = this.generateExpr(expr.args[0].value);
        const listType = this.inferExprType(expr.args[0].value);
        if (listType.kind !== "List") return null;
        const elemSize = this.fieldSize(listType.element);
        return this.mod.call("list_tail", [listArg, this.mod.i32.const(elemSize)], binaryen.i32);
      }
      case "append": {
        const listArg = this.generateExpr(expr.args[0].value);
        const elemArg = this.generateExpr(expr.args[1].value);
        const listType = this.inferExprType(expr.args[0].value);
        if (listType.kind !== "List") return null;
        // If element type is Error (e.g. empty list literal []), infer from the element argument
        const elemType = listType.element.kind === "Error"
          ? this.inferExprType(expr.args[1].value)
          : listType.element;
        const elemKind = elemType.kind;
        if (elemKind === "Int64" || elemKind === "Float64") {
          return this.mod.call("list_append_i64", [listArg, elemArg], binaryen.i32);
        }
        // Pointer types (String, Record, List, Union, Option, Result)
        return this.mod.call("list_append_i32", [listArg, elemArg], binaryen.i32);
      }
      case "concat": {
        const aArg = this.generateExpr(expr.args[0].value);
        const bArg = this.generateExpr(expr.args[1].value);
        const listType = this.inferExprType(expr.args[0].value);
        if (listType.kind !== "List") return null;
        const elemSize = this.fieldSize(listType.element);
        return this.mod.call("list_concat", [aArg, bArg, this.mod.i32.const(elemSize)], binaryen.i32);
      }
      case "reverse": {
        const listArg = this.generateExpr(expr.args[0].value);
        const listType = this.inferExprType(expr.args[0].value);
        if (listType.kind !== "List") return null;
        const elemSize = this.fieldSize(listType.element);
        return this.mod.call("list_reverse", [listArg, this.mod.i32.const(elemSize)], binaryen.i32);
      }
      case "is_empty": {
        const listArg = this.generateExpr(expr.args[0].value);
        // is_empty = list_length(ptr) == 0
        return this.mod.i64.eq(
          this.mod.call("list_length", [listArg], binaryen.i64),
          this.mod.i64.const(0, 0),
        );
      }
      case "nth": {
        const listArg = this.generateExpr(expr.args[0].value);
        const indexArg = this.generateExpr(expr.args[1].value);
        const listType = this.inferExprType(expr.args[0].value);
        if (listType.kind !== "List") return null;
        const elemType = listType.element;
        if (elemType.kind === "Int64" || elemType.kind === "Float64") {
          return this.mod.call("list_get_i64", [listArg, indexArg], binaryen.i64);
        }
        // For pointer types (String, Record, etc.) use i32 getter
        return this.mod.call("list_get_i32", [listArg, indexArg], binaryen.i32);
      }
      case "list_set": {
        const listArg = this.generateExpr(expr.args[0].value);
        const indexArg = this.generateExpr(expr.args[1].value);
        const valueArg = this.generateExpr(expr.args[2].value);
        const listType = this.inferExprType(expr.args[0].value);
        if (listType.kind !== "List") return null;
        const elemKind = listType.element.kind;
        if (elemKind === "Int64" || elemKind === "Float64") {
          return this.mod.call("list_set_i64", [listArg, indexArg, valueArg], binaryen.i32);
        }
        return this.mod.call("list_set_i32", [listArg, indexArg, valueArg], binaryen.i32);
      }
      default:
        return null;
    }
  }

  // Handle user-facing Map operations by mapping them to typed runtime functions.
  // Dispatches based on key type (String=str, Int64=i64) and value type (i32 or i64).
  private tryGenerateMapCall(name: string, expr: import("../ast/nodes.js").CallExpr): binaryen.ExpressionRef | null {
    // Helper: is a ClarityType stored as i64 in WASM?
    const isI64Val = (t: ClarityType) =>
      t.kind === "Int64" || t.kind === "Timestamp" || t.kind === "Float64";

    switch (name) {
      case "map_new": {
        return this.mod.call("map_new", [], binaryen.i32);
      }
      case "map_size": {
        const mapArg = this.generateExpr(expr.args[0].value);
        return this.mod.call("map_size", [mapArg], binaryen.i64);
      }
      case "map_has": {
        const mapArg = this.generateExpr(expr.args[0].value);
        const keyArg = this.generateExpr(expr.args[1].value);
        const mapType = this.inferExprType(expr.args[0].value);
        if (mapType.kind !== "Map") return null;
        if (mapType.key.kind === "String") {
          return this.mod.call("map_has_str", [mapArg, keyArg], binaryen.i32);
        }
        return this.mod.call("map_has_i64", [mapArg, keyArg], binaryen.i32);
      }
      case "map_get": {
        const mapArg = this.generateExpr(expr.args[0].value);
        const keyArg = this.generateExpr(expr.args[1].value);
        const mapType = this.inferExprType(expr.args[0].value);
        if (mapType.kind !== "Map") return null;
        const valI64 = isI64Val(mapType.value);
        if (mapType.key.kind === "String") {
          return this.mod.call(valI64 ? "map_get_str_i64" : "map_get_str_i32", [mapArg, keyArg], binaryen.i32);
        }
        return this.mod.call(valI64 ? "map_get_i64_i64" : "map_get_i64_i32", [mapArg, keyArg], binaryen.i32);
      }
      case "map_set": {
        const mapArg = this.generateExpr(expr.args[0].value);
        const keyArg = this.generateExpr(expr.args[1].value);
        const valArg = this.generateExpr(expr.args[2].value);
        const mapType = this.inferExprType(expr.args[0].value);
        if (mapType.kind !== "Map") return null;
        const valI64 = isI64Val(mapType.value);
        if (mapType.key.kind === "String") {
          return this.mod.call(valI64 ? "map_set_str_i64" : "map_set_str_i32", [mapArg, keyArg, valArg], binaryen.i32);
        }
        return this.mod.call(valI64 ? "map_set_i64_i64" : "map_set_i64_i32", [mapArg, keyArg, valArg], binaryen.i32);
      }
      case "map_remove": {
        const mapArg = this.generateExpr(expr.args[0].value);
        const keyArg = this.generateExpr(expr.args[1].value);
        const mapType = this.inferExprType(expr.args[0].value);
        if (mapType.kind !== "Map") return null;
        if (mapType.key.kind === "String") {
          return this.mod.call("map_remove_str", [mapArg, keyArg], binaryen.i32);
        }
        return this.mod.call("map_remove_i64", [mapArg, keyArg], binaryen.i32);
      }
      case "map_keys": {
        const mapArg = this.generateExpr(expr.args[0].value);
        const mapType = this.inferExprType(expr.args[0].value);
        if (mapType.kind !== "Map") return null;
        if (mapType.key.kind === "String") {
          return this.mod.call("map_keys_str", [mapArg], binaryen.i32);
        }
        return this.mod.call("map_keys_i64", [mapArg], binaryen.i32);
      }
      case "map_values": {
        const mapArg = this.generateExpr(expr.args[0].value);
        const mapType = this.inferExprType(expr.args[0].value);
        if (mapType.kind !== "Map") return null;
        if (isI64Val(mapType.value)) {
          return this.mod.call("map_values_i64", [mapArg], binaryen.i32);
        }
        return this.mod.call("map_values_i32", [mapArg], binaryen.i32);
      }
      default:
        return null;
    }
  }

  // Look up if a name is a union variant constructor. Returns the union type if found.
  private findConstructorType(name: string): { union: Extract<ClarityType, { kind: "Union" }>; variantIndex: number; variant: ClarityVariant } | null {
    for (const [, type] of this.allTypeDecls) {
      if (type.kind === "Union") {
        for (let i = 0; i < type.variants.length; i++) {
          if (type.variants[i].name === name) {
            return { union: type, variantIndex: i, variant: type.variants[i] };
          }
        }
      }
    }
    return null;
  }

  // Generate a union variant constructor call: allocate memory, write tag + fields
  // Layout: [tag: i32][field_1][field_2]...
  private generateConstructorCall(
    name: string,
    info: { union: Extract<ClarityType, { kind: "Union" }>; variantIndex: number; variant: ClarityVariant },
    args: import("../ast/nodes.js").CallArg[],
  ): binaryen.ExpressionRef {
    const size = this.unionSize(info.union.variants);

    // Allocate memory
    const ptrLocal = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);

    const stmts: binaryen.ExpressionRef[] = [];

    // ptr = __alloc(size)
    stmts.push(
      this.mod.local.set(ptrLocal,
        this.mod.call("__alloc", [this.mod.i32.const(size)], binaryen.i32),
      ),
    );

    const getPtr = () => this.mod.local.get(ptrLocal, binaryen.i32);

    // Store tag
    stmts.push(this.mod.i32.store(0, 4, getPtr(), this.mod.i32.const(info.variantIndex)));

    // Store fields (offset starts at 4, after tag)
    const layout = this.recordLayout(info.variant.fields);
    const fieldEntries = [...info.variant.fields.entries()];
    for (let i = 0; i < args.length && i < fieldEntries.length; i++) {
      // Use the actual argument's inferred type for the store width rather than the
      // declared field type from the union schema. This avoids type-width mismatches
      // when the same constructor name (e.g. Ok) appears in multiple generic
      // instantiations (e.g. Result<Int64,String> and Result<String,String>) and
      // findConstructorType() happens to return the wrong one.
      const fieldType = this.inferExprType(args[i].value);
      const fieldOffset = layout[i].offset + 4; // +4 for tag
      const value = this.generateExpr(args[i].value);
      stmts.push(this.storeField(getPtr(), fieldOffset, value, fieldType));
    }

    // Return the pointer
    stmts.push(getPtr());

    return this.mod.block(null, stmts, binaryen.i32);
  }

  // ============================================================
  // Record Literal Construction
  // ============================================================

  private generateRecordLiteral(expr: import("../ast/nodes.js").RecordLiteral): binaryen.ExpressionRef {
    const recordType = this.inferExprType(expr);
    if (recordType.kind !== "Record") {
      throw new Error("Record literal did not resolve to a Record type");
    }

    const layout = this.recordLayout(recordType.fields);
    const size = this.recordSize(recordType.fields);

    // Allocate memory
    const ptrLocal = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);

    const stmts: binaryen.ExpressionRef[] = [];

    // ptr = __alloc(size)
    stmts.push(
      this.mod.local.set(ptrLocal,
        this.mod.call("__alloc", [this.mod.i32.const(size)], binaryen.i32),
      ),
    );

    const getPtr = () => this.mod.local.get(ptrLocal, binaryen.i32);

    // Store each field
    for (const field of expr.fields) {
      const layoutEntry = layout.find(l => l.name === field.name);
      if (!layoutEntry) {
        throw new Error(`Record field '${field.name}' not found in layout`);
      }
      const value = this.generateExpr(field.value);
      stmts.push(this.storeField(getPtr(), layoutEntry.offset, value, layoutEntry.type));
    }

    // Return the pointer
    stmts.push(getPtr());

    return this.mod.block(null, stmts, binaryen.i32);
  }

  // ============================================================
  // Member Access (record.field)
  // ============================================================

  private generateMemberAccess(expr: import("../ast/nodes.js").MemberExpr): binaryen.ExpressionRef {
    const objType = this.inferExprType(expr.object);
    const objExpr = this.generateExpr(expr.object);

    if (objType.kind === "Record") {
      const layout = this.recordLayout(objType.fields);
      const field = layout.find((f) => f.name === expr.member);
      if (!field) {
        throw new Error(`Record has no field '${expr.member}'`);
      }
      return this.loadField(objExpr, field.offset, field.type);
    }

    // Fallback for unknown types
    return this.mod.i32.const(0);
  }

  // ============================================================
  // List Literal Generation
  // ============================================================

  // Layout: [length: i32][elem_0][elem_1]...
  private generateListLiteral(expr: import("../ast/nodes.js").ListLiteral): binaryen.ExpressionRef {
    if (expr.elements.length === 0) {
      // Empty list: allocate just the length header
      const ptrLocal = this.localIndex++;
      this.additionalLocals.push(binaryen.i32);
      return this.mod.block(null, [
        this.mod.local.set(ptrLocal,
          this.mod.call("__alloc", [this.mod.i32.const(4)], binaryen.i32),
        ),
        this.mod.i32.store(0, 4,
          this.mod.local.get(ptrLocal, binaryen.i32),
          this.mod.i32.const(0),
        ),
        this.mod.local.get(ptrLocal, binaryen.i32),
      ], binaryen.i32);
    }

    const elemType = this.inferExprType(expr.elements[0]);
    const elemSize = this.fieldSize(elemType);
    const totalSize = 4 + elemSize * expr.elements.length;

    const ptrLocal = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);

    const stmts: binaryen.ExpressionRef[] = [];

    // Allocate
    stmts.push(
      this.mod.local.set(ptrLocal,
        this.mod.call("__alloc", [this.mod.i32.const(totalSize)], binaryen.i32),
      ),
    );

    const getPtr = () => this.mod.local.get(ptrLocal, binaryen.i32);

    // Store length
    stmts.push(this.mod.i32.store(0, 4, getPtr(), this.mod.i32.const(expr.elements.length)));

    // Store elements
    for (let i = 0; i < expr.elements.length; i++) {
      const value = this.generateExpr(expr.elements[i]);
      const offset = 4 + i * elemSize;
      stmts.push(this.storeField(getPtr(), offset, value, elemType));
    }

    // Return pointer
    stmts.push(getPtr());

    return this.mod.block(null, stmts, binaryen.i32);
  }

  // ============================================================
  // Binary & Unary Ops
  // ============================================================

  private generateBinary(
    op: BinaryOp,
    left: Expr,
    right: Expr,
  ): binaryen.ExpressionRef {
    const leftType = this.inferExprType(left);

    // String operations — delegate to runtime imports
    if (leftType.kind === "String") {
      const leftExpr = this.generateExpr(left);
      const rightExpr = this.generateExpr(right);
      switch (op) {
        case "++":
          return this.mod.call("string_concat", [leftExpr, rightExpr], binaryen.i32);
        case "==":
          return this.mod.call("string_eq", [leftExpr, rightExpr], binaryen.i32);
        case "!=": {
          const eq = this.mod.call("string_eq", [leftExpr, rightExpr], binaryen.i32);
          return this.mod.i32.xor(eq, this.mod.i32.const(1));
        }
      }
    }

    const leftExpr = this.generateExpr(left);
    const rightExpr = this.generateExpr(right);

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
        case "%": return this.mod.call("f64_rem", [leftExpr, rightExpr], binaryen.f64);
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

  // ============================================================
  // Match Expression Generation
  // ============================================================

  private generateMatch(
    matchExpr: import("../ast/nodes.js").MatchExpr,
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    const scrutinee = this.generateExpr(matchExpr.scrutinee);
    const scrutineeType = this.inferExprType(matchExpr.scrutinee);

    if (scrutineeType.kind === "Bool") {
      return this.generateBoolMatch(scrutinee, matchExpr.arms, expectedType);
    }

    if (scrutineeType.kind === "Union") {
      return this.generateUnionMatch(scrutinee, scrutineeType, matchExpr.arms, expectedType);
    }

    return this.generateGenericMatch(scrutinee, scrutineeType, matchExpr.arms, expectedType);
  }

  private generateBoolMatch(
    scrutinee: binaryen.ExpressionRef,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    // If any arm has a guard, use a chain-based approach
    const hasGuards = arms.some(a => a.guard);
    if (hasGuards) {
      return this.generateGuardedBoolMatch(scrutinee, arms, expectedType);
    }

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

    const ifTrue = trueBody ?? wildcardBody ?? this.mod.unreachable();
    const ifFalse = falseBody ?? wildcardBody ?? this.mod.unreachable();

    return this.mod.if(scrutinee, ifTrue, ifFalse);
  }

  private generateGuardedBoolMatch(
    scrutinee: binaryen.ExpressionRef,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    // Store scrutinee in temp to avoid re-evaluation
    const tempIndex = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);
    const setTemp = this.mod.local.set(tempIndex, scrutinee);
    const getTemp = () => this.mod.local.get(tempIndex, binaryen.i32);

    // Build if-else chain from last to first
    let result: binaryen.ExpressionRef = this.mod.unreachable();

    for (let i = arms.length - 1; i >= 0; i--) {
      const arm = arms[i];
      const body = this.generateExpr(arm.body, expectedType);

      if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        if (arm.guard) {
          const guardCond = this.generateExpr(arm.guard);
          result = this.mod.if(guardCond, body, result);
        } else {
          result = body;
        }
      } else if (arm.pattern.kind === "LiteralPattern" && arm.pattern.value.kind === "BoolLiteral") {
        let cond: binaryen.ExpressionRef;
        if (arm.pattern.value.value) {
          cond = getTemp(); // True
        } else {
          cond = this.mod.i32.eqz(getTemp()); // False
        }
        if (arm.guard) {
          cond = this.mod.i32.and(cond, this.generateExpr(arm.guard));
        }
        result = this.mod.if(cond, body, result);
      }
    }

    const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
    return this.mod.block(null, [setTemp, result], matchResultType);
  }

  // Match on a union type by reading the tag and branching
  private generateUnionMatch(
    scrutinee: binaryen.ExpressionRef,
    unionType: Extract<ClarityType, { kind: "Union" }>,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    // Store scrutinee pointer in a temp
    const ptrLocal = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);
    const setPtr = this.mod.local.set(ptrLocal, scrutinee);
    const getPtr = () => this.mod.local.get(ptrLocal, binaryen.i32);

    // Read the tag
    const tagLocal = this.localIndex++;
    this.additionalLocals.push(binaryen.i32);
    const setTag = this.mod.local.set(tagLocal, this.mod.i32.load(0, 4, getPtr()));
    const getTag = () => this.mod.local.get(tagLocal, binaryen.i32);

    // For guarded arms, we need a result local to avoid sharing binaryen expression refs
    // (binaryen IR is a tree, not a DAG — each node can only have one parent)
    const hasGuards = arms.some(a => a.guard);
    const matchResultWasmType = expectedType ? clarityTypeToWasm(expectedType) : binaryen.i32;
    let resultLocal: number | undefined;
    let getResult: (() => binaryen.ExpressionRef) | undefined;
    let setResult: ((val: binaryen.ExpressionRef) => binaryen.ExpressionRef) | undefined;
    if (hasGuards) {
      resultLocal = this.localIndex++;
      this.additionalLocals.push(matchResultWasmType);
      getResult = () => this.mod.local.get(resultLocal!, matchResultWasmType);
      setResult = (val: binaryen.ExpressionRef) => this.mod.local.set(resultLocal!, val);
    }

    // Build if-else chain: if (tag == 0) ... else if (tag == 1) ... else ...
    let result: binaryen.ExpressionRef = this.mod.unreachable();

    for (let i = arms.length - 1; i >= 0; i--) {
      const arm = arms[i];

      if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        if (arm.pattern.kind === "BindingPattern") {
          // Bind the whole union pointer
          const bindLocal = this.localIndex++;
          this.additionalLocals.push(binaryen.i32);
          this.locals.set(arm.pattern.name, {
            index: bindLocal,
            wasmType: binaryen.i32,
            clarityType: unionType,
          });
          // Bind BEFORE evaluating guard
          const bindStmt = this.mod.local.set(bindLocal, getPtr());
          const bodyExpr = this.generateExpr(arm.body, expectedType);
          if (arm.guard) {
            const guardCond = this.generateExpr(arm.guard);
            const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
            const guardedResult = this.mod.if(guardCond, bodyExpr, getResult!());
            result = this.mod.block(null, [setResult!(result), bindStmt, guardedResult], bodyResultType);
          } else {
            const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
            result = this.mod.block(null, [bindStmt, bodyExpr], bodyResultType);
          }
        } else {
          const bodyExpr = this.generateExpr(arm.body, expectedType);
          if (arm.guard) {
            const guardCond = this.generateExpr(arm.guard);
            const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
            result = this.mod.block(null, [
              setResult!(result),
              this.mod.if(guardCond, bodyExpr, getResult!()),
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

        // Bind variant fields into locals
        const savedLocals = new Map(this.locals);
        const layout = this.recordLayout(variant.fields);
        const fieldEntries = [...variant.fields.entries()];

        for (let fi = 0; fi < ctorPattern.fields.length && fi < fieldEntries.length; fi++) {
          const pat = ctorPattern.fields[fi];
          if (pat.pattern.kind === "BindingPattern") {
            const fieldType = fieldEntries[fi][1];
            const wasmType = clarityTypeToWasm(fieldType);
            const localIdx = this.localIndex++;
            this.additionalLocals.push(wasmType);
            this.locals.set(pat.pattern.name, {
              index: localIdx,
              wasmType,
              clarityType: fieldType,
            });
          }
        }

        // Generate body with field loads
        const bodyStmts: binaryen.ExpressionRef[] = [];
        for (let fi = 0; fi < ctorPattern.fields.length && fi < fieldEntries.length; fi++) {
          const pat = ctorPattern.fields[fi];
          if (pat.pattern.kind === "BindingPattern") {
            const fieldType = fieldEntries[fi][1];
            const fieldOffset = layout[fi].offset + 4; // +4 for tag
            const local = this.locals.get(pat.pattern.name)!;
            bodyStmts.push(
              this.mod.local.set(local.index, this.loadField(getPtr(), fieldOffset, fieldType)),
            );
          }
        }

        const bodyExpr = this.generateExpr(arm.body, expectedType);
        const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;

        let armResult: binaryen.ExpressionRef;
        if (arm.guard) {
          // Store result in local first, then load fields, check guard
          const guardCond = this.generateExpr(arm.guard);
          const guardedBody = this.mod.if(guardCond, bodyExpr, getResult!());
          bodyStmts.push(guardedBody);
          armResult = this.mod.block(null, bodyStmts, bodyResultType);
          // Wrap in block that sets result local and does the tag check
          const cond = this.mod.i32.eq(getTag(), this.mod.i32.const(variantIndex));
          result = this.mod.block(null, [
            setResult!(result),
            this.mod.if(cond, armResult, getResult!()),
          ], bodyResultType);
        } else {
          bodyStmts.push(bodyExpr);
          armResult = bodyStmts.length === 1
            ? bodyStmts[0]
            : this.mod.block(null, bodyStmts, bodyResultType);

          const cond = this.mod.i32.eq(getTag(), this.mod.i32.const(variantIndex));
          result = this.mod.if(cond, armResult, result);
        }

        // Restore locals (pattern vars are scoped to the arm)
        // (We don't actually need to remove them since they won't conflict in WASM locals)
      }
    }

    // Determine the result type of the match expression
    const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
    return this.mod.block(null, [setPtr, setTag, result], matchResultType);
  }

  private generateGenericMatch(
    scrutinee: binaryen.ExpressionRef,
    scrutineeType: ClarityType,
    arms: import("../ast/nodes.js").MatchArm[],
    expectedType?: ClarityType,
  ): binaryen.ExpressionRef {
    const wasmType = clarityTypeToWasm(scrutineeType);
    const tempIndex = this.localIndex++;
    this.additionalLocals.push(wasmType);
    const setTemp = this.mod.local.set(tempIndex, scrutinee);
    const getTemp = () => this.mod.local.get(tempIndex, wasmType);

    let result: binaryen.ExpressionRef = this.mod.unreachable();

    for (let i = arms.length - 1; i >= 0; i--) {
      const arm = arms[i];
      const body = this.generateExpr(arm.body, expectedType);

      if (arm.pattern.kind === "WildcardPattern" || arm.pattern.kind === "BindingPattern") {
        if (arm.pattern.kind === "BindingPattern") {
          const bindIndex = this.localIndex++;
          this.additionalLocals.push(wasmType);
          this.locals.set(arm.pattern.name, {
            index: bindIndex,
            wasmType,
            clarityType: scrutineeType,
          });
          // Bind BEFORE evaluating guard
          const bindStmt = this.mod.local.set(bindIndex, getTemp());
          if (arm.guard) {
            const guardCond = this.generateExpr(arm.guard);
            const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
            const guardedResult = this.mod.if(guardCond, body, result);
            result = this.mod.block(null, [bindStmt, guardedResult], bodyResultType);
          } else {
            const bodyResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
            result = this.mod.block(null, [bindStmt, body], bodyResultType);
          }
        } else {
          if (arm.guard) {
            const guardCond = this.generateExpr(arm.guard);
            result = this.mod.if(guardCond, body, result);
          } else {
            result = body;
          }
        }
      } else if (arm.pattern.kind === "LiteralPattern") {
        let cond = this.generatePatternCondition(getTemp(), arm.pattern, scrutineeType);
        if (arm.guard) {
          const guardCond = this.generateExpr(arm.guard);
          cond = this.mod.i32.and(cond, guardCond);
        }
        result = this.mod.if(cond, body, result);
      } else if (arm.pattern.kind === "RangePattern") {
        let cond = this.generateRangePatternCondition(getTemp, arm.pattern);
        if (arm.guard) {
          const guardCond = this.generateExpr(arm.guard);
          cond = this.mod.i32.and(cond, guardCond);
        }
        result = this.mod.if(cond, body, result);
      }
    }

    const matchResultType = expectedType ? clarityTypeToWasm(expectedType) : undefined;
    return this.mod.block(null, [setTemp, result], matchResultType);
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
    if (pattern.value.kind === "StringLiteral" && scrutineeType.kind === "String") {
      const ptr = this.allocStringLiteral(pattern.value.value);
      return this.mod.call("string_eq", [scrutinee, this.mod.i32.const(ptr)], binaryen.i32);
    }
    return this.mod.i32.const(1);
  }

  private generateRangePatternCondition(
    getScrutinee: () => binaryen.ExpressionRef,
    pattern: import("../ast/nodes.js").RangePattern,
  ): binaryen.ExpressionRef {
    const startVal = pattern.start.value;
    const endVal = pattern.end.value;
    const startLow = Number(startVal & BigInt(0xFFFFFFFF));
    const startHigh = Number((startVal >> BigInt(32)) & BigInt(0xFFFFFFFF));
    const endLow = Number(endVal & BigInt(0xFFFFFFFF));
    const endHigh = Number((endVal >> BigInt(32)) & BigInt(0xFFFFFFFF));
    // scrutinee >= start AND scrutinee <= end (signed)
    // Use separate getScrutinee() calls to create fresh expression refs (binaryen tree invariant)
    const gteStart = this.mod.i64.ge_s(getScrutinee(), this.mod.i64.const(startLow, startHigh));
    const lteEnd = this.mod.i64.le_s(getScrutinee(), this.mod.i64.const(endLow, endHigh));
    return this.mod.i32.and(gteStart, lteEnd);
  }

  // ============================================================
  // Type Inference Helpers
  // ============================================================

  private inferExprType(expr: Expr): ClarityType {
    // Use the resolved type from the checker if available (preferred path).
    // If we're inside a monomorphized body, substitute any TypeVars that the
    // checker left in the resolvedType with their concrete bindings.
    if (expr.resolvedType && expr.resolvedType.kind !== "Error") {
      return this.typeVarSubst.size > 0
        ? substituteTypeVars(expr.resolvedType, this.typeVarSubst)
        : expr.resolvedType;
    }

    // Fallback for expressions not annotated by the checker (e.g., codegen
    // internals or sub-expressions in match patterns).
    switch (expr.kind) {
      case "IntLiteral": return INT64;
      case "FloatLiteral": return FLOAT64;
      case "BoolLiteral": return BOOL;
      case "StringLiteral": return { kind: "String" };

      case "IdentifierExpr": {
        const local = this.locals.get(expr.name);
        if (local) return local.clarityType;
        const ctor = this.findConstructorType(expr.name);
        if (ctor) return ctor.union;
        // Function reference — return Function type
        if (this.functionTableIndices.has(expr.name)) {
          const fn = this.allFunctions.get(expr.name);
          if (fn) return this.inferFunctionType(fn);
        }
        return INT64;
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
        if (expr.callee.kind === "IdentifierExpr") {
          const name = expr.callee.name;
          // Check for indirect call through function-typed local
          const local = this.locals.get(name);
          if (local && local.clarityType.kind === "Function") {
            return local.clarityType.returnType;
          }
          if (expr.args.length > 0) {
            const argType = this.inferExprType(expr.args[0].value);
            if (argType.kind === "List") {
              switch (name) {
                case "head": case "nth": return argType.element;
                case "tail": case "append": case "concat": case "reverse": return argType;
                case "length": case "list_length": return INT64;
                case "is_empty": return BOOL;
              }
            }
            if (argType.kind === "Map") {
              switch (name) {
                case "map_size": return INT64;
                case "map_has": return BOOL;
                case "map_set": case "map_remove": return argType;
                case "map_keys": return { kind: "List", element: argType.key };
                case "map_values": return { kind: "List", element: argType.value };
                // map_get returns Option<V> — fall through to resolvedType (set by checker)
              }
            }
          }
          // map_new returns Map type — use resolvedType from checker
          if (name === "map_new") {
            if (expr.resolvedType && expr.resolvedType.kind !== "Error") return expr.resolvedType;
          }
          // list_set returns the same list type
          if (name === "list_set" && expr.args.length > 0) {
            return this.inferExprType(expr.args[0].value);
          }
          return this.inferFunctionReturnType(name);
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
      case "AssignmentExpr": return UNIT;

      case "BlockExpr": {
        if (expr.result) return this.inferExprType(expr.result);
        return UNIT;
      }

      case "MemberExpr": {
        const objType = this.inferExprType(expr.object);
        if (objType.kind === "Record") {
          const fieldType = objType.fields.get(expr.member);
          if (fieldType) return fieldType;
        }
        return INT64;
      }

      case "ListLiteral": {
        if (expr.elements.length > 0) {
          return { kind: "List", element: this.inferExprType(expr.elements[0]) };
        }
        return { kind: "List", element: INT64 };
      }

      case "RecordLiteral": {
        const fieldNames = new Set(expr.fields.map(f => f.name));
        for (const [, type] of this.allTypeDecls) {
          if (type.kind === "Record") {
            const typeFieldNames = new Set(type.fields.keys());
            if (typeFieldNames.size === fieldNames.size && [...fieldNames].every(n => typeFieldNames.has(n))) {
              return type;
            }
          }
        }
        return INT64;
      }

      default: return INT64;
    }
  }

  private inferFunctionType(decl: FunctionDecl): ClarityType {
    const params = decl.params.map(p =>
      assertResolvedType(this.checker.resolveTypeRef(p.typeAnnotation), `parameter '${p.name}' in '${decl.name}'`),
    );
    const returnType = assertResolvedType(this.checker.resolveTypeRef(decl.returnType), `return type of '${decl.name}'`);
    return { kind: "Function", params, returnType, effects: new Set(decl.effects) };
  }

  private inferFunctionReturnType(name: string): ClarityType {
    if (name === this.currentFunction.name) {
      return assertResolvedType(
        this.checker.resolveTypeRef(this.currentFunction.returnType),
        `return type of '${name}'`,
      );
    }
    const fn = this.allFunctions.get(name);
    if (fn) {
      return assertResolvedType(this.checker.resolveTypeRef(fn.returnType), `return type of '${name}'`);
    }

    // Check if it's a union constructor
    const ctor = this.findConstructorType(name);
    if (ctor) {
      return ctor.union;
    }

    // Built-in function return types
    const builtinReturnTypes: Record<string, ClarityType> = {
      // I/O
      print_string: UNIT, print_int: UNIT, print_float: UNIT,
      log_info: UNIT, log_warn: UNIT, print_stderr: UNIT,
      // String ops
      string_concat: { kind: "String" }, string_eq: BOOL,
      string_length: INT64, substring: { kind: "String" }, char_at: { kind: "String" },
      contains: BOOL, string_starts_with: BOOL, string_ends_with: BOOL, index_of: INT64, trim: { kind: "String" },
      char_code: INT64, char_from_code: { kind: "String" } as ClarityType,
      split: { kind: "List", element: { kind: "String" } } as ClarityType,
      string_replace: { kind: "String" } as ClarityType,
      string_repeat: { kind: "String" } as ClarityType,
      // Type conversions
      int_to_float: FLOAT64, float_to_int: INT64,
      int_to_string: { kind: "String" }, float_to_string: { kind: "String" },
      string_to_int: { kind: "Union", name: "Option<Int64>", variants: [{ name: "Some", fields: new Map([["value", INT64]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      string_to_float: { kind: "Union", name: "Option<Float64>", variants: [{ name: "Some", fields: new Map([["value", FLOAT64]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      // Math
      abs_int: INT64, min_int: INT64, max_int: INT64,
      int_clamp: INT64, float_clamp: FLOAT64,
      sqrt: FLOAT64, pow: FLOAT64, floor: FLOAT64, ceil: FLOAT64,
      // List ops
      list_length: INT64,
      // Random
      random_int: INT64, random_float: FLOAT64,
      // Network
      http_get: { kind: "Union", name: "Result<String, String>", variants: [{ name: "Ok", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "Err", fields: new Map([["error", { kind: "String" } as ClarityType]]) }] } as ClarityType,
      http_post: { kind: "Union", name: "Result<String, String>", variants: [{ name: "Ok", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "Err", fields: new Map([["error", { kind: "String" } as ClarityType]]) }] } as ClarityType,
      http_listen: { kind: "Union", name: "Result<String, String>", variants: [{ name: "Ok", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "Err", fields: new Map([["error", { kind: "String" } as ClarityType]]) }] } as ClarityType,
      http_request: { kind: "Union", name: "Result<String, String>", variants: [{ name: "Ok", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "Err", fields: new Map([["error", { kind: "String" } as ClarityType]]) }] } as ClarityType,
      // JSON
      json_parse_object: { kind: "Union", name: "Result<Map<String, String>, String>", variants: [{ name: "Ok", fields: new Map([["value", { kind: "Map", key: { kind: "String" } as ClarityType, value: { kind: "String" } as ClarityType } as ClarityType]]) }, { name: "Err", fields: new Map([["error", { kind: "String" } as ClarityType]]) }] } as ClarityType,
      json_stringify_object: { kind: "String" } as ClarityType,
      // DB
      db_execute: { kind: "Union", name: "Result<Int64, String>", variants: [{ name: "Ok", fields: new Map([["value", INT64]]) }, { name: "Err", fields: new Map([["error", { kind: "String" } as ClarityType]]) }] } as ClarityType,
      db_query: { kind: "Union", name: "Result<List<Map<String, String>>, String>", variants: [{ name: "Ok", fields: new Map([["value", { kind: "List", element: { kind: "Map", key: { kind: "String" } as ClarityType, value: { kind: "String" } as ClarityType } as ClarityType } as ClarityType]]) }, { name: "Err", fields: new Map([["error", { kind: "String" } as ClarityType]]) }] } as ClarityType,
      // I/O primitives
      read_line: { kind: "String" }, read_all_stdin: { kind: "String" },
      read_file: { kind: "String" }, write_file: UNIT,
      get_args: { kind: "List", element: { kind: "String" } } as ClarityType,
      exit: UNIT,
      // Test assertions
      assert_eq: UNIT, assert_eq_float: UNIT, assert_eq_string: UNIT,
      assert_true: UNIT, assert_false: UNIT,
      // Bytes
      bytes_new: BYTES, bytes_length: INT64, bytes_get: INT64,
      bytes_set: BYTES, bytes_slice: BYTES, bytes_concat: BYTES,
      bytes_from_string: BYTES, bytes_to_string: { kind: "String" } as ClarityType,
      // Regex
      regex_match: BOOL,
      regex_captures: { kind: "Union", name: "Option<List<String>>", variants: [{ name: "Some", fields: new Map([["value", { kind: "List", element: { kind: "String" } as ClarityType } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      // Timestamp
      now: TIMESTAMP, timestamp_to_string: { kind: "String" } as ClarityType,
      timestamp_to_int: INT64, timestamp_from_int: TIMESTAMP,
      timestamp_parse_iso: { kind: "Union", name: "Option<Timestamp>", variants: [{ name: "Some", fields: new Map([["value", TIMESTAMP]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      timestamp_add: TIMESTAMP, timestamp_diff: INT64,
      // Crypto
      sha256: { kind: "String" } as ClarityType,
      // JSON
      json_parse: {
        kind: "Union",
        name: "Option<Map<String, String>>",
        variants: [
          { name: "Some", fields: new Map([["value", { kind: "Map", key: { kind: "String" }, value: { kind: "String" } } as ClarityType]]) },
          { name: "None", fields: new Map() },
        ],
      } as ClarityType,
      json_stringify: { kind: "String" } as ClarityType,
      json_get: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      json_get_path: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      json_get_nested: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      json_array_length: { kind: "Union", name: "Option<Int64>", variants: [{ name: "Some", fields: new Map([["value", INT64]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      json_array_get: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      json_keys: { kind: "Union", name: "Option<List<String>>", variants: [{ name: "Some", fields: new Map([["value", { kind: "List", element: { kind: "String" } as ClarityType } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      json_escape_string: { kind: "String" } as ClarityType,
      // Timestamp
      sleep: UNIT,
      // Network
      http_request_full: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      // Map ops — return i32 handle or bool/int; exact type inferred from Map type args
      map_new: { kind: "Map", key: INT64, value: INT64 } as ClarityType, // placeholder
      map_size: INT64, map_has: BOOL,
      map_get: { kind: "Union", name: "Option<Int64>", variants: [{ name: "Some", fields: new Map([["value", INT64]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      map_set: { kind: "Map", key: INT64, value: INT64 } as ClarityType,
      map_remove: { kind: "Map", key: INT64, value: INT64 } as ClarityType,
      map_keys: { kind: "List", element: INT64 } as ClarityType,
      map_values: { kind: "List", element: INT64 } as ClarityType,
      // Memory management
      arena_save: INT64,
      arena_restore: UNIT,
      arena_restore_keeping_str: { kind: "String" } as ClarityType,
      memory_stats: { kind: "String" } as ClarityType,
      // Secret
      get_secret: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      // Model
      call_model: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      call_model_system: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      list_models: { kind: "List", element: { kind: "String" } } as ClarityType,
      // MCP
      mcp_connect: { kind: "Result", ok: INT64, err: { kind: "String" } as ClarityType } as ClarityType,
      mcp_list_tools: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      mcp_call_tool: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      mcp_disconnect: UNIT,
      // A2A
      a2a_discover: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      a2a_submit: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      a2a_poll: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      a2a_cancel: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      // Policy
      policy_is_url_allowed: BOOL,
      policy_is_effect_allowed: BOOL,
      // Trace
      trace_start: INT64,
      trace_end: UNIT,
      trace_log: UNIT,
      // Persist
      checkpoint_save: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      checkpoint_load: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      checkpoint_delete: UNIT,
      checkpoint_save_raw: BOOL,
      // HumanInLoop
      hitl_ask: { kind: "String" } as ClarityType,
      // Embed
      embed_text: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      cosine_similarity: FLOAT64,
      chunk_text: { kind: "String" } as ClarityType,
      embed_and_retrieve: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      // Eval
      eval_exact: BOOL,
      eval_contains: BOOL,
      eval_llm_judge: { kind: "Result", ok: { kind: "String" } as ClarityType, err: { kind: "String" } as ClarityType } as ClarityType,
      eval_semantic: { kind: "Result", ok: FLOAT64, err: { kind: "String" } as ClarityType } as ClarityType,
      // Streaming
      stream_start: { kind: "Result", ok: INT64, err: { kind: "String" } as ClarityType } as ClarityType,
      stream_next: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      stream_close: { kind: "String" } as ClarityType,
      // SSE client
      sse_connect: { kind: "Result", ok: INT64, err: { kind: "String" } as ClarityType } as ClarityType,
      sse_next_event: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      sse_close: UNIT,
      sse_next_event_timeout: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      // stdin non-blocking
      stdin_try_read: { kind: "Union", name: "Option<String>", variants: [{ name: "Some", fields: new Map([["value", { kind: "String" } as ClarityType]]) }, { name: "None", fields: new Map() }] } as ClarityType,
      // URL encoding (pure)
      url_encode: { kind: "String" } as ClarityType,
      url_decode: { kind: "String" } as ClarityType,
    };
    if (name in builtinReturnTypes) return builtinReturnTypes[name];
    return INT64;
  }

  private inferWasmReturnType(name: string): binaryen.Type {
    const clarityType = this.inferFunctionReturnType(name);
    return clarityTypeToWasm(clarityType);
  }
}
