import binaryen from "binaryen";
import type {
  ModuleDecl, FunctionDecl, Expr, BinaryOp, UnaryOp,
} from "../ast/nodes.js";
import type { ClarityType, ClarityVariant } from "../checker/types.js";
import { INT64, FLOAT64, BOOL, UNIT } from "../checker/types.js";
import { Checker } from "../checker/checker.js";
import { clarityTypeToWasm } from "./wasm-types.js";
import { getBuiltins } from "./builtins.js";

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

  // String literal data segment tracking
  private stringLiterals: Map<string, number> = new Map();
  private dataSegmentOffset: number = 0;
  private dataSegments: { offset: number; data: Uint8Array }[] = [];

  // All function declarations for cross-function type lookup
  private allFunctions: Map<string, FunctionDecl> = new Map();

  // All type declarations for record/union layout computation
  private allTypeDecls: Map<string, ClarityType> = new Map();

  generate(module: ModuleDecl, checker: Checker): Uint8Array {
    this.mod = new binaryen.Module();
    this.checker = checker;
    this.stringLiterals = new Map();
    this.dataSegmentOffset = 0;
    this.dataSegments = [];
    this.allFunctions = new Map();
    this.allTypeDecls = new Map();

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

    this.setupModule(module);

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

    // Generate all functions
    for (const decl of module.declarations) {
      if (decl.kind === "FunctionDecl") {
        this.generateFunction(decl);
      }
    }

    // Export the heap base so the runtime knows where dynamic allocation starts
    this.mod.addGlobal("__heap_base", binaryen.i32, false, this.mod.i32.const(this.dataSegmentOffset || 1024));
    this.mod.addGlobalExport("__heap_base", "__heap_base");
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
      case "Bool": return 4;
      case "Unit": return 0;
      // Pointer types (i32)
      case "String":
      case "Record":
      case "Union":
      case "List":
      case "Option":
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

  private generateFunction(decl: FunctionDecl): void {
    this.currentFunction = decl;
    this.locals = new Map();
    this.localIndex = 0;
    this.additionalLocals = [];

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

    const body = this.generateExpr(decl.body, returnClarityType);

    this.mod.addFunction(
      decl.name,
      paramsType,
      returnWasmType,
      this.additionalLocals,
      body,
    );
    this.mod.addFunctionExport(decl.name, decl.name);
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
        const value = this.generateExpr(expr.value);
        if (expr.name === "_") {
          return this.mod.drop(value);
        }
        const clarityType = this.inferExprType(expr.value);
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

    // Check if this is a union variant constructor or a regular function
    const constructorType = this.findConstructorType(name);
    if (constructorType) {
      return this.generateConstructorCall(name, constructorType, expr.args);
    }

    // List operation special cases
    const listCall = this.tryGenerateListCall(name, expr);
    if (listCall) return listCall;

    // Regular function call
    const args = expr.args.map((a) => this.generateExpr(a.value));
    return this.mod.call(name, args, this.inferWasmReturnType(name));
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
        if (listType.element.kind === "Int64") {
          return this.mod.call("list_append_i64", [listArg, elemArg], binaryen.i32);
        }
        // For other types, would need list_append_i32/f64 variants
        return null;
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
      const fieldType = fieldEntries[i][1];
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
          result = this.mod.block(null, [
            this.mod.local.set(bindLocal, getPtr()),
            this.generateExpr(arm.body, expectedType),
          ]);
        } else {
          result = this.generateExpr(arm.body, expectedType);
        }
      } else if (arm.pattern.kind === "ConstructorPattern") {
        const variantIndex = unionType.variants.findIndex((v) => v.name === arm.pattern.name);
        if (variantIndex === -1) continue;
        const variant = unionType.variants[variantIndex];

        // Bind variant fields into locals
        const savedLocals = new Map(this.locals);
        const layout = this.recordLayout(variant.fields);
        const fieldEntries = [...variant.fields.entries()];

        for (let fi = 0; fi < arm.pattern.fields.length && fi < fieldEntries.length; fi++) {
          const pat = arm.pattern.fields[fi];
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
        for (let fi = 0; fi < arm.pattern.fields.length && fi < fieldEntries.length; fi++) {
          const pat = arm.pattern.fields[fi];
          if (pat.pattern.kind === "BindingPattern") {
            const fieldType = fieldEntries[fi][1];
            const fieldOffset = layout[fi].offset + 4; // +4 for tag
            const local = this.locals.get(pat.pattern.name)!;
            bodyStmts.push(
              this.mod.local.set(local.index, this.loadField(getPtr(), fieldOffset, fieldType)),
            );
          }
        }

        bodyStmts.push(this.generateExpr(arm.body, expectedType));

        const bodyBlock = bodyStmts.length === 1
          ? bodyStmts[0]
          : this.mod.block(null, bodyStmts, expectedType ? clarityTypeToWasm(expectedType) : undefined);

        const cond = this.mod.i32.eq(getTag(), this.mod.i32.const(variantIndex));
        result = this.mod.if(cond, bodyBlock, result);

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
    if (pattern.value.kind === "StringLiteral" && scrutineeType.kind === "String") {
      const ptr = this.allocStringLiteral(pattern.value.value);
      return this.mod.call("string_eq", [scrutinee, this.mod.i32.const(ptr)], binaryen.i32);
    }
    return this.mod.i32.const(1);
  }

  // ============================================================
  // Type Inference Helpers
  // ============================================================

  private inferExprType(expr: Expr): ClarityType {
    // Use the resolved type from the checker if available (preferred path).
    if (expr.resolvedType && expr.resolvedType.kind !== "Error") {
      return expr.resolvedType;
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
          if (expr.args.length > 0) {
            const argType = this.inferExprType(expr.args[0].value);
            if (argType.kind === "List") {
              switch (name) {
                case "head": return argType.element;
                case "tail": case "append": case "concat": case "reverse": return argType;
                case "length": case "list_length": return INT64;
              }
            }
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

  private inferFunctionReturnType(name: string): ClarityType {
    if (name === this.currentFunction.name) {
      return this.checker.resolveTypeRef(this.currentFunction.returnType) ?? INT64;
    }
    const fn = this.allFunctions.get(name);
    if (fn) {
      return this.checker.resolveTypeRef(fn.returnType) ?? INT64;
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
      log_info: UNIT, log_warn: UNIT,
      // String ops
      string_concat: { kind: "String" }, string_eq: BOOL,
      string_length: INT64, substring: { kind: "String" }, char_at: { kind: "String" },
      // Type conversions
      int_to_float: FLOAT64, float_to_int: INT64,
      int_to_string: { kind: "String" }, float_to_string: { kind: "String" },
      string_to_int: INT64, string_to_float: FLOAT64,
      // Math
      abs_int: INT64, min_int: INT64, max_int: INT64,
      sqrt: FLOAT64, pow: FLOAT64, floor: FLOAT64, ceil: FLOAT64,
      // List ops
      list_length: INT64,
      // I/O primitives
      read_line: { kind: "String" }, read_all_stdin: { kind: "String" },
      read_file: { kind: "String" }, write_file: UNIT,
      get_args: { kind: "List", element: { kind: "String" } } as ClarityType,
      exit: UNIT,
      // Test assertions
      assert_eq: UNIT, assert_eq_float: UNIT, assert_eq_string: UNIT,
      assert_true: UNIT, assert_false: UNIT,
    };
    if (name in builtinReturnTypes) return builtinReturnTypes[name];
    return INT64;
  }

  private inferWasmReturnType(name: string): binaryen.Type {
    const clarityType = this.inferFunctionReturnType(name);
    return clarityTypeToWasm(clarityType);
  }
}
