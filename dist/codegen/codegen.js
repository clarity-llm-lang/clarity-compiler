import binaryen from "binaryen";
import { clarityTypeToWasm } from "./wasm-types.js";
import { getBuiltins } from "./builtins.js";
import { CLARITY_BUILTINS } from "../registry/builtins-registry.js";
import { allocStringLiteral as _allocStringLiteral, prescanStringLiterals as _prescanStringLiterals, } from "./codegen-strings.js";
import { fieldSize as _fieldSize, fieldAlign as _fieldAlign, recordLayout as _recordLayout, recordSize as _recordSize, unionSize as _unionSize, storeField as _storeField, loadField as _loadField, } from "./codegen-memory.js";
import { inferExprType as _inferExprType, inferFunctionType as _inferFunctionType, inferFunctionReturnType as _inferFunctionReturnType, inferWasmReturnType as _inferWasmReturnType, findConstructorType as _findConstructorType, assertResolvedType, } from "./codegen-infer.js";
import { generateMatch as _generateMatch } from "./codegen-match.js";
import { buildClosureStruct as _buildClosureStruct, getOrCreateWrapper as _getOrCreateWrapper, liftLambda as _liftLambda, } from "./codegen-closures.js";
import { isTailRecursive as _isTailRecursive, generateTailRecursiveBody as _generateTailRecursiveBody, } from "./codegen-tco.js";
import { generateCall as _generateCall, generateConstructorCall as _generateConstructorCall, } from "./codegen-calls.js";
export { assertResolvedType };
const _builtinReturnTypeMap = new Map(CLARITY_BUILTINS.map(b => [b.name, b.returnType]));
// Builds an InferContext from the CodeGenerator's fields.
function mkInferCtx(g) {
    return {
        locals: g.locals, allFunctions: g.allFunctions, allTypeDecls: g.allTypeDecls,
        functionTableIndices: g.functionTableIndices, typeVarSubst: g.typeVarSubst,
        currentFunction: g.currentFunction, checker: g.checker,
        builtinReturnTypeMap: _builtinReturnTypeMap,
    };
}
// Build a live proxy context backed directly by the CodeGenerator.
// Mutations to any field (including localIndex++) are reflected on `g`.
function mkCtx(g, extra) {
    return new Proxy(g, {
        get(target, prop) {
            if (prop in extra)
                return extra[prop];
            return target[prop];
        },
        set(target, prop, val) {
            if (prop in extra) {
                extra[prop] = val;
                return true;
            }
            target[prop] = val;
            return true;
        },
    });
}
export class CodeGenerator {
    mod;
    locals;
    localIndex;
    additionalLocals;
    checker;
    currentFunction;
    stringLiterals = new Map();
    dataSegmentOffset = 0;
    dataSegments = [];
    allFunctions = new Map();
    allTypeDecls = new Map();
    functionTableNames = [];
    functionTableIndices = new Map();
    currentModuleWasmNames = new Map();
    functionDeclWasmNames = new Map();
    lambdaCounter = 0;
    pendingLambdas = [];
    lambdaWrappers = new Map();
    generatedMonomorphs = new Set();
    typeVarSubst = new Map();
    // Callbacks wired into the delegated context objects.
    _genExpr = (e, et) => this.generateExpr(e, et);
    _inferExpr = (e) => this.inferExprType(e);
    _inferWasmRet = (n) => this.inferWasmReturnType(n);
    _allocStr = (v) => this.allocStringLiteral(v);
    _mkMatchCtx() {
        return mkCtx(this, {
            generateExpr: this._genExpr, inferExprType: this._inferExpr, allocStringLiteral: this._allocStr,
        });
    }
    _mkClosureCtx() {
        return mkCtx(this, {
            generateExpr: this._genExpr, inferExprType: this._inferExpr,
        });
    }
    _mkTcoCtx() {
        return mkCtx(this, {
            generateExpr: this._genExpr, inferExprType: this._inferExpr, allocStringLiteral: this._allocStr,
        });
    }
    _mkCallsCtx() {
        return mkCtx(this, {
            generateExpr: this._genExpr, inferExprType: this._inferExpr,
            inferWasmReturnType: this._inferWasmRet, builtinReturnTypeMap: _builtinReturnTypeMap,
        });
    }
    generate(module, checker) {
        this._reset(checker);
        this.setupModule(module);
        if (!this.mod.validate())
            throw new Error("Generated invalid WASM module");
        this.mod.optimize();
        return this.mod.emitBinary();
    }
    generateText(module, checker) {
        this._reset(checker);
        this.setupModule(module);
        this.mod.validate();
        return this.mod.emitText();
    }
    generateMulti(allModules, entryModule, checker) {
        this._reset(checker);
        this.setupModuleMulti(allModules, entryModule);
        if (!this.mod.validate())
            throw new Error("Generated invalid WASM module");
        this.mod.optimize();
        return this.mod.emitBinary();
    }
    generateTextMulti(allModules, entryModule, checker) {
        this._reset(checker);
        this.setupModuleMulti(allModules, entryModule);
        this.mod.validate();
        return this.mod.emitText();
    }
    _reset(checker) {
        this.mod = new binaryen.Module();
        this.checker = checker;
        this.stringLiterals = new Map();
        this.dataSegmentOffset = 0;
        this.dataSegments = [];
        this.allFunctions = new Map();
        this.allTypeDecls = new Map();
        this.functionTableNames = [];
        this.functionTableIndices = new Map();
        this.currentModuleWasmNames = new Map();
        this.functionDeclWasmNames = new Map();
        this.generatedMonomorphs = new Set();
        this.lambdaCounter = 0;
        this.pendingLambdas = [];
        this.lambdaWrappers = new Map();
        this.typeVarSubst = new Map();
    }
    setupModule(module) {
        this._importBuiltins();
        for (const decl of module.declarations) {
            if (decl.kind === "TypeDecl") {
                const r = this.checker.resolveTypeRef({ kind: "TypeRef", name: decl.name, typeArgs: [], span: decl.span });
                if (r)
                    this.allTypeDecls.set(decl.name, r);
            }
            if (decl.kind === "FunctionDecl")
                this.allFunctions.set(decl.name, decl);
        }
        this._scanSigTypes(module.declarations);
        this._registerCheckerTypes();
        _prescanStringLiterals(this, module);
        this._setMemory();
        for (const decl of module.declarations) {
            if (decl.kind === "FunctionDecl" && decl.typeParams.length === 0) {
                this.functionTableIndices.set(decl.name, this.functionTableNames.length);
                this.functionTableNames.push(decl.name);
            }
        }
        for (const decl of module.declarations) {
            if (decl.kind === "FunctionDecl" && decl.typeParams.length === 0)
                this.generateFunction(decl);
        }
        this._finalizeTable();
        this.mod.addGlobal("__heap_base", binaryen.i32, false, this.mod.i32.const(this.dataSegmentOffset || 1024));
        this.mod.addGlobalExport("__heap_base", "__heap_base");
    }
    setupModuleMulti(allModules, entryModule) {
        this._importBuiltins();
        const allDecls = allModules.flatMap(m => m.declarations);
        for (const decl of allDecls) {
            if (decl.kind === "TypeDecl") {
                const r = this.checker.resolveTypeRef({ kind: "TypeRef", name: decl.name, typeArgs: [], span: decl.span });
                if (r)
                    this.allTypeDecls.set(decl.name, r);
            }
            if (decl.kind === "FunctionDecl")
                this.allFunctions.set(decl.name, decl);
        }
        this._scanSigTypes(allDecls);
        this._registerCheckerTypes();
        for (const m of allModules)
            _prescanStringLiterals(this, m);
        this._setMemory();
        for (const m of allModules) {
            for (const d of m.declarations) {
                if (d.kind === "FunctionDecl")
                    this.functionDeclWasmNames.set(d, d.exported ? d.name : `${m.name}$${d.name}`);
            }
        }
        for (const m of allModules) {
            for (const d of m.declarations) {
                if (d.kind === "FunctionDecl" && d.typeParams.length === 0) {
                    const wn = this.functionDeclWasmNames.get(d);
                    if (!this.functionTableIndices.has(wn)) {
                        this.functionTableIndices.set(wn, this.functionTableNames.length);
                        this.functionTableNames.push(wn);
                    }
                }
            }
        }
        const entryNames = new Set(entryModule.declarations.filter(d => d.kind === "FunctionDecl").map(d => d.name));
        for (const m of allModules) {
            this.currentModuleWasmNames = new Map(m.declarations.filter(d => d.kind === "FunctionDecl")
                .map(d => [d.name, this.functionDeclWasmNames.get(d)]));
            for (const d of m.declarations) {
                if (d.kind === "FunctionDecl" && d.typeParams.length === 0)
                    this.generateFunctionMulti(d, entryNames);
            }
        }
        this._finalizeTable();
        this.mod.addGlobal("__heap_base", binaryen.i32, false, this.mod.i32.const(this.dataSegmentOffset || 1024));
        this.mod.addGlobalExport("__heap_base", "__heap_base");
    }
    _importBuiltins() {
        for (const b of getBuiltins())
            this.mod.addFunctionImport(b.name, b.importModule, b.importName, b.params, b.result);
        this.mod.addFunctionImport("__alloc", "env", "__alloc", binaryen.i32, binaryen.i32);
    }
    _scanSigTypes(decls) {
        for (const d of decls) {
            if (d.kind === "FunctionDecl") {
                for (const tn of [...d.params.map(p => p.typeAnnotation), d.returnType]) {
                    const r = this.checker.resolveTypeRef(tn);
                    if (r && r.kind === "Union" && !this.allTypeDecls.has(r.name))
                        this.allTypeDecls.set(r.name, r);
                    if (r)
                        this._regNested(r);
                }
            }
        }
    }
    _registerCheckerTypes() {
        for (const [n, t] of this.checker.getOptionTypes())
            if (!this.allTypeDecls.has(n))
                this.allTypeDecls.set(n, t);
        for (const [, t] of this.checker.getResultTypes())
            if (t.kind === "Union" && !this.allTypeDecls.has(t.name))
                this.allTypeDecls.set(t.name, t);
    }
    _regNested(type) {
        if (!type)
            return;
        switch (type.kind) {
            case "Result": {
                const u = this.checker.resultToUnion(type);
                if (!this.allTypeDecls.has(u.name))
                    this.allTypeDecls.set(u.name, u);
                this._regNested(type.ok);
                this._regNested(type.err);
                break;
            }
            case "List":
                this._regNested(type.element);
                break;
            case "Option":
                this._regNested(type.inner);
                break;
            case "Union":
                for (const v of type.variants)
                    for (const ft of v.fields.values())
                        this._regNested(ft);
                break;
            case "Record":
                for (const ft of type.fields.values())
                    this._regNested(ft);
                break;
            case "Function":
                for (const pt of type.params)
                    this._regNested(pt);
                this._regNested(type.returnType);
                break;
            case "Map":
                this._regNested(type.key);
                this._regNested(type.value);
                break;
        }
    }
    _setMemory() {
        this.mod.setMemory(1, 256, "memory", this.dataSegments.map(s => ({ name: `str_${s.offset}`, offset: this.mod.i32.const(s.offset), data: s.data, passive: false })));
    }
    _finalizeTable() {
        if (this.functionTableNames.length > 0) {
            this.mod.addTable("0", this.functionTableNames.length, this.functionTableNames.length);
            this.mod.addActiveElementSegment("0", "funcs", this.functionTableNames, this.mod.i32.const(0));
        }
    }
    fieldSize(t) { return _fieldSize(t); }
    fieldAlign(t) { return _fieldAlign(t); }
    recordLayout(f) { return _recordLayout(f); }
    recordSize(f) { return _recordSize(f); }
    unionSize(v) { return _unionSize(v); }
    storeField(p, o, v, t) { return _storeField(this.mod, p, o, v, t); }
    loadField(p, o, t) { return _loadField(this.mod, p, o, t); }
    allocStringLiteral(v) { return _allocStringLiteral(this, v); }
    _genFuncBody(decl, ret, retWasm) {
        return _isTailRecursive(decl.body, decl.name)
            ? _generateTailRecursiveBody(this._mkTcoCtx(), decl, ret, retWasm)
            : this.generateExpr(decl.body, ret);
    }
    generateFunction(decl) {
        this.currentFunction = decl;
        this.locals = new Map();
        this.localIndex = 0;
        this.additionalLocals = [];
        const pts = [];
        for (const p of decl.params) {
            const ct = assertResolvedType(this.checker.resolveTypeRef(p.typeAnnotation), `parameter '${p.name}' in '${decl.name}'`);
            this.locals.set(p.name, { index: this.localIndex, wasmType: clarityTypeToWasm(ct), clarityType: ct });
            pts.push(clarityTypeToWasm(ct));
            this.localIndex++;
        }
        const ret = assertResolvedType(this.checker.resolveTypeRef(decl.returnType), `return type of '${decl.name}'`);
        const retWasm = clarityTypeToWasm(ret);
        this.mod.addFunction(decl.name, binaryen.createType(pts), retWasm, this.additionalLocals, this._genFuncBody(decl, ret, retWasm));
        this.mod.addFunctionExport(decl.name, decl.name);
    }
    generateFunctionMulti(decl, entryNames) {
        this.currentFunction = decl;
        this.locals = new Map();
        this.localIndex = 0;
        this.additionalLocals = [];
        const pts = [];
        for (const p of decl.params) {
            const ct = assertResolvedType(this.checker.resolveTypeRef(p.typeAnnotation), `parameter '${p.name}' in '${decl.name}'`);
            this.locals.set(p.name, { index: this.localIndex, wasmType: clarityTypeToWasm(ct), clarityType: ct });
            pts.push(clarityTypeToWasm(ct));
            this.localIndex++;
        }
        const ret = assertResolvedType(this.checker.resolveTypeRef(decl.returnType), `return type of '${decl.name}'`);
        const retWasm = clarityTypeToWasm(ret);
        const wn = this.functionDeclWasmNames.get(decl) ?? decl.name;
        this.mod.addFunction(wn, binaryen.createType(pts), retWasm, this.additionalLocals, this._genFuncBody(decl, ret, retWasm));
        if (entryNames.has(decl.name))
            this.mod.addFunctionExport(wn, decl.name);
    }
    generateExpr(expr, expectedType) {
        switch (expr.kind) {
            case "IntLiteral": {
                const v = expr.value;
                return this.mod.i64.const(Number(v & BigInt(0xFFFFFFFF)), Number((v >> BigInt(32)) & BigInt(0xFFFFFFFF)));
            }
            case "FloatLiteral": return this.mod.f64.const(expr.value);
            case "BoolLiteral": return this.mod.i32.const(expr.value ? 1 : 0);
            case "StringLiteral": return this.mod.i32.const(this.allocStringLiteral(expr.value));
            case "IdentifierExpr": {
                const loc = this.locals.get(expr.name);
                if (loc)
                    return this.mod.local.get(loc.index, loc.wasmType);
                const ci = _findConstructorType(mkInferCtx(this), expr.name);
                if (ci && ci.variant.fields.size === 0)
                    return _generateConstructorCall(this._mkCallsCtx(), expr.name, ci, []);
                const rfn = this.currentModuleWasmNames.get(expr.name) ?? expr.name;
                if (this.functionTableIndices.has(rfn)) {
                    const sym = this.checker.lookupSymbol(expr.name);
                    if (sym && sym.type.kind === "Function") {
                        const wi = _getOrCreateWrapper(this._mkClosureCtx(), rfn, sym.type);
                        return _buildClosureStruct(this._mkClosureCtx(), wi, this.mod.i32.const(0));
                    }
                    return this.mod.i32.const(this.functionTableIndices.get(rfn));
                }
                throw new Error(`Undefined variable in codegen: ${expr.name}`);
            }
            case "BinaryExpr": return this.generateBinary(expr.op, expr.left, expr.right);
            case "UnaryExpr": return this.generateUnary(expr.op, expr.operand);
            case "CallExpr": return _generateCall(this._mkCallsCtx(), expr);
            case "MatchExpr": return _generateMatch(this._mkMatchCtx(), expr, expectedType);
            case "LetExpr": {
                const ct = this.inferExprType(expr.value);
                const val = this.generateExpr(expr.value, ct);
                if (expr.name === "_")
                    return this.mod.drop(val);
                const wt = clarityTypeToWasm(ct);
                const idx = this.localIndex++;
                this.additionalLocals.push(wt);
                this.locals.set(expr.name, { index: idx, wasmType: wt, clarityType: ct });
                return this.mod.local.set(idx, val);
            }
            case "AssignmentExpr": {
                const loc = this.locals.get(expr.name);
                if (!loc)
                    throw new Error(`Undefined variable in codegen: ${expr.name}`);
                return this.mod.local.set(loc.index, this.generateExpr(expr.value));
            }
            case "BlockExpr": {
                const stmts = [];
                for (const s of expr.statements) {
                    const g = this.generateExpr(s);
                    if (s.kind !== "LetExpr" && s.kind !== "AssignmentExpr") {
                        const st = this.inferExprType(s);
                        stmts.push(st.kind === "Unit" ? g : this.mod.drop(g));
                    }
                    else {
                        stmts.push(g);
                    }
                }
                if (expr.result)
                    stmts.push(this.generateExpr(expr.result, expectedType));
                if (stmts.length === 0)
                    return this.mod.nop();
                if (stmts.length === 1)
                    return stmts[0];
                const rt = expr.result ? clarityTypeToWasm(this.inferExprType(expr.result)) : binaryen.none;
                return this.mod.block(null, stmts, rt);
            }
            case "ListLiteral": return this.generateListLiteral(expr);
            case "RecordLiteral": return this.generateRecordLiteral(expr);
            case "MemberExpr": return this.generateMemberAccess(expr);
            case "LambdaExpr": return _liftLambda(this._mkClosureCtx(), expr);
            default:
                throw new Error(`Unsupported expression kind in codegen: ${expr.kind}`);
        }
    }
    generateRecordLiteral(expr) {
        const rt = this.inferExprType(expr);
        if (rt.kind !== "Record")
            throw new Error("Record literal did not resolve to a Record type");
        const layout = this.recordLayout(rt.fields);
        const pl = this.localIndex++;
        this.additionalLocals.push(binaryen.i32);
        const gp = () => this.mod.local.get(pl, binaryen.i32);
        const s = [
            this.mod.local.set(pl, this.mod.call("__alloc", [this.mod.i32.const(this.recordSize(rt.fields))], binaryen.i32)),
        ];
        for (const f of expr.fields) {
            const le = layout.find(l => l.name === f.name);
            if (!le)
                throw new Error(`Record field '${f.name}' not found in layout`);
            s.push(this.storeField(gp(), le.offset, this.generateExpr(f.value), le.type));
        }
        s.push(gp());
        return this.mod.block(null, s, binaryen.i32);
    }
    generateMemberAccess(expr) {
        const ot = this.inferExprType(expr.object);
        const oe = this.generateExpr(expr.object);
        if (ot.kind === "Record") {
            const f = this.recordLayout(ot.fields).find(f => f.name === expr.member);
            if (!f)
                throw new Error(`Record has no field '${expr.member}'`);
            return this.loadField(oe, f.offset, f.type);
        }
        return this.mod.i32.const(0);
    }
    generateListLiteral(expr) {
        if (expr.elements.length === 0) {
            const pl = this.localIndex++;
            this.additionalLocals.push(binaryen.i32);
            return this.mod.block(null, [
                this.mod.local.set(pl, this.mod.call("__alloc", [this.mod.i32.const(4)], binaryen.i32)),
                this.mod.i32.store(0, 4, this.mod.local.get(pl, binaryen.i32), this.mod.i32.const(0)),
                this.mod.local.get(pl, binaryen.i32),
            ], binaryen.i32);
        }
        const et = this.inferExprType(expr.elements[0]);
        const es = this.fieldSize(et);
        const pl = this.localIndex++;
        this.additionalLocals.push(binaryen.i32);
        const gp = () => this.mod.local.get(pl, binaryen.i32);
        const s = [
            this.mod.local.set(pl, this.mod.call("__alloc", [this.mod.i32.const(4 + es * expr.elements.length)], binaryen.i32)),
            this.mod.i32.store(0, 4, gp(), this.mod.i32.const(expr.elements.length)),
        ];
        for (let i = 0; i < expr.elements.length; i++)
            s.push(this.storeField(gp(), 4 + i * es, this.generateExpr(expr.elements[i]), et));
        s.push(gp());
        return this.mod.block(null, s, binaryen.i32);
    }
    generateBinary(op, left, right) {
        const lt = this.inferExprType(left);
        if (lt.kind === "String") {
            const [l, r] = [this.generateExpr(left), this.generateExpr(right)];
            switch (op) {
                case "++": return this.mod.call("string_concat", [l, r], binaryen.i32);
                case "==": return this.mod.call("string_eq", [l, r], binaryen.i32);
                case "!=": return this.mod.i32.xor(this.mod.call("string_eq", [l, r], binaryen.i32), this.mod.i32.const(1));
            }
        }
        const [l, r] = [this.generateExpr(left), this.generateExpr(right)];
        if (lt.kind === "Int64") {
            switch (op) {
                case "+": return this.mod.i64.add(l, r);
                case "-": return this.mod.i64.sub(l, r);
                case "*": return this.mod.i64.mul(l, r);
                case "/": return this.mod.i64.div_s(l, r);
                case "%": return this.mod.i64.rem_s(l, r);
                case "==": return this.mod.i64.eq(l, r);
                case "!=": return this.mod.i64.ne(l, r);
                case "<": return this.mod.i64.lt_s(l, r);
                case ">": return this.mod.i64.gt_s(l, r);
                case "<=": return this.mod.i64.le_s(l, r);
                case ">=": return this.mod.i64.ge_s(l, r);
            }
        }
        if (lt.kind === "Float64") {
            switch (op) {
                case "+": return this.mod.f64.add(l, r);
                case "-": return this.mod.f64.sub(l, r);
                case "*": return this.mod.f64.mul(l, r);
                case "/": return this.mod.f64.div(l, r);
                case "%": return this.mod.call("f64_rem", [l, r], binaryen.f64);
                case "==": return this.mod.f64.eq(l, r);
                case "!=": return this.mod.f64.ne(l, r);
                case "<": return this.mod.f64.lt(l, r);
                case ">": return this.mod.f64.gt(l, r);
                case "<=": return this.mod.f64.le(l, r);
                case ">=": return this.mod.f64.ge(l, r);
            }
        }
        if (lt.kind === "Bool") {
            switch (op) {
                case "and": return this.mod.i32.and(l, r);
                case "or": return this.mod.i32.or(l, r);
                case "==": return this.mod.i32.eq(l, r);
                case "!=": return this.mod.i32.ne(l, r);
            }
        }
        throw new Error(`Unsupported binary op '${op}' for type ${lt.kind}`);
    }
    generateUnary(op, operand) {
        const e = this.generateExpr(operand), t = this.inferExprType(operand);
        if (op === "-") {
            if (t.kind === "Int64")
                return this.mod.i64.sub(this.mod.i64.const(0, 0), e);
            if (t.kind === "Float64")
                return this.mod.f64.neg(e);
        }
        if (op === "!" && t.kind === "Bool")
            return this.mod.i32.xor(e, this.mod.i32.const(1));
        throw new Error(`Unsupported unary op '${op}' for type ${t.kind}`);
    }
    inferExprType(e) { return _inferExprType(mkInferCtx(this), e); }
    inferFunctionType(d) { return _inferFunctionType(mkInferCtx(this), d); }
    inferFunctionReturnType(n) { return _inferFunctionReturnType(mkInferCtx(this), n); }
    inferWasmReturnType(n) { return _inferWasmReturnType(mkInferCtx(this), n); }
}
//# sourceMappingURL=codegen.js.map