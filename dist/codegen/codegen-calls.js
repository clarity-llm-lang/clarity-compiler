// ---------------------------------------------------------------------------
// Call generation helpers (function calls, constructors, list/map ops).
// Extracted from codegen.ts to keep file sizes under the 600-line limit.
// ---------------------------------------------------------------------------
import binaryen from "binaryen";
import { typeToString, substituteTypeVars, unifyTypes, } from "../checker/types.js";
import { clarityTypeToWasm } from "./wasm-types.js";
import { recordLayout as _recordLayout, unionSize as _unionSize, storeField as _storeField, fieldSize as _fieldSize, } from "./codegen-memory.js";
import { findConstructorType as _findConstructorType, assertResolvedType, } from "./codegen-infer.js";
function fieldSize(type) {
    return _fieldSize(type);
}
function unionSize(variants) {
    return _unionSize(variants);
}
function storeField(mod, basePtr, offset, value, type) {
    return _storeField(mod, basePtr, offset, value, type);
}
function recordLayout(fields) {
    return _recordLayout(fields);
}
// Resolve a type reference with type parameter names treated as TypeVars.
export function resolveTypeRefWithTypeParams(ctx, node, typeParams) {
    if (node.kind === "FunctionType") {
        return {
            kind: "Function",
            params: node.paramTypes.map(pt => resolveTypeRefWithTypeParams(ctx, pt, typeParams)),
            returnType: resolveTypeRefWithTypeParams(ctx, node.returnType, typeParams),
            effects: new Set(),
        };
    }
    if (node.kind === "TypeRef" && typeParams.includes(node.name) && node.typeArgs.length === 0) {
        return { kind: "TypeVar", name: node.name };
    }
    if (node.kind === "TypeRef" && node.typeArgs.length > 0) {
        const args = node.typeArgs.map(a => resolveTypeRefWithTypeParams(ctx, a, typeParams));
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
    return assertResolvedType(ctx.checker.resolveTypeRef(node), `type '${node.name ?? "unknown"}'`);
}
export function generateCall(ctx, expr) {
    if (expr.callee.kind !== "IdentifierExpr") {
        throw new Error("Only direct function calls supported in MVP");
    }
    const name = expr.callee.name;
    const local = ctx.locals.get(name);
    if (local && local.clarityType.kind === "Function") {
        return generateIndirectCall(ctx, expr, local, local.clarityType);
    }
    const constructorType = findConstructorType(ctx, name);
    if (constructorType) {
        return generateConstructorCall(ctx, name, constructorType, expr.args);
    }
    const listCall = tryGenerateListCall(ctx, name, expr);
    if (listCall)
        return listCall;
    const mapCall = tryGenerateMapCall(ctx, name, expr);
    if (mapCall)
        return mapCall;
    const targetDecl = ctx.allFunctions.get(name);
    if (targetDecl && targetDecl.typeParams.length > 0) {
        return generateMonomorphizedCall(ctx, expr, targetDecl);
    }
    const args = expr.args.map((a) => ctx.generateExpr(a.value));
    const wasmCallName = ctx.currentModuleWasmNames.get(name) ?? name;
    return ctx.mod.call(wasmCallName, args, ctx.inferWasmReturnType(name));
}
export function generateMonomorphizedCall(ctx, expr, genericDecl) {
    const bindings = new Map();
    for (let i = 0; i < expr.args.length; i++) {
        const argType = ctx.inferExprType(expr.args[i].value);
        const paramType = resolveTypeRefWithTypeParams(ctx, genericDecl.params[i].typeAnnotation, genericDecl.typeParams);
        unifyTypes(paramType, argType, bindings);
    }
    const wasmBaseName = ctx.currentModuleWasmNames.get(genericDecl.name) ?? genericDecl.name;
    const typeKey = genericDecl.typeParams.map(tp => {
        const bound = bindings.get(tp);
        return bound ? typeToString(bound) : "unknown";
    }).join("$");
    const monoName = `${wasmBaseName}$${typeKey}`;
    if (!ctx.generatedMonomorphs.has(monoName)) {
        ctx.generatedMonomorphs.add(monoName);
        // Save current function state
        const savedLocals = ctx.locals;
        const savedLocalIndex = ctx.localIndex;
        const savedAdditionalLocals = ctx.additionalLocals;
        const savedCurrentFunction = ctx.currentFunction;
        const savedTypeVarSubst = ctx.typeVarSubst;
        // Set up new function context
        ctx.locals = new Map();
        ctx.localIndex = 0;
        ctx.additionalLocals = [];
        ctx.currentFunction = genericDecl;
        ctx.typeVarSubst = bindings;
        const paramWasmTypes = [];
        for (const param of genericDecl.params) {
            const genericType = resolveTypeRefWithTypeParams(ctx, param.typeAnnotation, genericDecl.typeParams);
            const concreteType = substituteTypeVars(genericType, bindings);
            const wasmType = clarityTypeToWasm(concreteType);
            ctx.locals.set(param.name, {
                index: ctx.localIndex,
                wasmType,
                clarityType: concreteType,
            });
            paramWasmTypes.push(wasmType);
            ctx.localIndex++;
        }
        const genericReturnType = resolveTypeRefWithTypeParams(ctx, genericDecl.returnType, genericDecl.typeParams);
        const concreteReturnType = substituteTypeVars(genericReturnType, bindings);
        const returnWasmType = clarityTypeToWasm(concreteReturnType);
        const paramsType = binaryen.createType(paramWasmTypes);
        const body = ctx.generateExpr(genericDecl.body, concreteReturnType);
        ctx.mod.addFunction(monoName, paramsType, returnWasmType, ctx.additionalLocals, body);
        ctx.mod.addFunctionExport(monoName, monoName);
        // Restore previous function state
        ctx.locals = savedLocals;
        ctx.localIndex = savedLocalIndex;
        ctx.additionalLocals = savedAdditionalLocals;
        ctx.currentFunction = savedCurrentFunction;
        ctx.typeVarSubst = savedTypeVarSubst;
    }
    const args = expr.args.map((a) => ctx.generateExpr(a.value));
    const genericReturnType = resolveTypeRefWithTypeParams(ctx, genericDecl.returnType, genericDecl.typeParams);
    const concreteReturn = substituteTypeVars(genericReturnType, bindings);
    return ctx.mod.call(monoName, args, clarityTypeToWasm(concreteReturn));
}
export function generateIndirectCall(ctx, expr, local, fnType) {
    const getPtr = () => ctx.mod.local.get(local.index, binaryen.i32);
    const funcIdxExpr = ctx.mod.i32.load(0, 4, getPtr());
    const envPtrExpr = ctx.mod.i32.load(4, 4, getPtr());
    const args = expr.args.map((a) => ctx.generateExpr(a.value));
    const paramWasmTypes = [binaryen.i32, ...fnType.params.map(clarityTypeToWasm)];
    const returnWasmType = clarityTypeToWasm(fnType.returnType);
    return ctx.mod.call_indirect("0", funcIdxExpr, [envPtrExpr, ...args], binaryen.createType(paramWasmTypes), returnWasmType);
}
export function findConstructorType(ctx, name) {
    const inferCtx = {
        locals: ctx.locals,
        allFunctions: ctx.allFunctions,
        allTypeDecls: ctx.allTypeDecls,
        functionTableIndices: ctx.functionTableIndices,
        typeVarSubst: ctx.typeVarSubst,
        currentFunction: ctx.currentFunction,
        checker: ctx.checker,
        builtinReturnTypeMap: ctx.builtinReturnTypeMap,
    };
    return _findConstructorType(inferCtx, name);
}
export function generateConstructorCall(ctx, name, info, args) {
    const size = unionSize(info.union.variants);
    const ptrLocal = ctx.localIndex++;
    ctx.additionalLocals.push(binaryen.i32);
    const stmts = [];
    stmts.push(ctx.mod.local.set(ptrLocal, ctx.mod.call("__alloc", [ctx.mod.i32.const(size)], binaryen.i32)));
    const getPtr = () => ctx.mod.local.get(ptrLocal, binaryen.i32);
    stmts.push(ctx.mod.i32.store(0, 4, getPtr(), ctx.mod.i32.const(info.variantIndex)));
    const layout = recordLayout(info.variant.fields);
    const fieldEntries = [...info.variant.fields.entries()];
    for (let i = 0; i < args.length && i < fieldEntries.length; i++) {
        const fieldType = ctx.inferExprType(args[i].value);
        const fieldOffset = layout[i].offset + 8;
        const value = ctx.generateExpr(args[i].value);
        stmts.push(storeField(ctx.mod, getPtr(), fieldOffset, value, fieldType));
    }
    stmts.push(getPtr());
    return ctx.mod.block(null, stmts, binaryen.i32);
}
export function tryGenerateListCall(ctx, name, expr) {
    switch (name) {
        case "length": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            return ctx.mod.call("list_length", [listArg], binaryen.i64);
        }
        case "head": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            const listType = ctx.inferExprType(expr.args[0].value);
            if (listType.kind !== "List")
                return null;
            const elemType = listType.element;
            if (elemType.kind === "Int64" || elemType.kind === "Float64") {
                return ctx.mod.call("list_head_i64", [listArg], binaryen.i64);
            }
            return ctx.mod.call("list_get_i32", [listArg, ctx.mod.i64.const(0, 0)], binaryen.i32);
        }
        case "tail": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            const listType = ctx.inferExprType(expr.args[0].value);
            if (listType.kind !== "List")
                return null;
            const elemSize = fieldSize(listType.element);
            return ctx.mod.call("list_tail", [listArg, ctx.mod.i32.const(elemSize)], binaryen.i32);
        }
        case "append": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            const elemArg = ctx.generateExpr(expr.args[1].value);
            const listType = ctx.inferExprType(expr.args[0].value);
            if (listType.kind !== "List")
                return null;
            const elemType = listType.element.kind === "Error"
                ? ctx.inferExprType(expr.args[1].value)
                : listType.element;
            const elemKind = elemType.kind;
            if (elemKind === "Int64" || elemKind === "Float64") {
                return ctx.mod.call("list_append_i64", [listArg, elemArg], binaryen.i32);
            }
            return ctx.mod.call("list_append_i32", [listArg, elemArg], binaryen.i32);
        }
        case "concat": {
            const aArg = ctx.generateExpr(expr.args[0].value);
            const bArg = ctx.generateExpr(expr.args[1].value);
            const listType = ctx.inferExprType(expr.args[0].value);
            if (listType.kind !== "List")
                return null;
            const elemSize = fieldSize(listType.element);
            return ctx.mod.call("list_concat", [aArg, bArg, ctx.mod.i32.const(elemSize)], binaryen.i32);
        }
        case "reverse": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            const listType = ctx.inferExprType(expr.args[0].value);
            if (listType.kind !== "List")
                return null;
            const elemSize = fieldSize(listType.element);
            return ctx.mod.call("list_reverse", [listArg, ctx.mod.i32.const(elemSize)], binaryen.i32);
        }
        case "is_empty": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            return ctx.mod.i64.eq(ctx.mod.call("list_length", [listArg], binaryen.i64), ctx.mod.i64.const(0, 0));
        }
        case "nth": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            const indexArg = ctx.generateExpr(expr.args[1].value);
            const listType = ctx.inferExprType(expr.args[0].value);
            if (listType.kind !== "List")
                return null;
            const elemType = listType.element;
            if (elemType.kind === "Int64" || elemType.kind === "Float64") {
                return ctx.mod.call("list_get_i64", [listArg, indexArg], binaryen.i64);
            }
            return ctx.mod.call("list_get_i32", [listArg, indexArg], binaryen.i32);
        }
        case "list_set": {
            const listArg = ctx.generateExpr(expr.args[0].value);
            const indexArg = ctx.generateExpr(expr.args[1].value);
            const valueArg = ctx.generateExpr(expr.args[2].value);
            const listType = ctx.inferExprType(expr.args[0].value);
            if (listType.kind !== "List")
                return null;
            const elemKind = listType.element.kind;
            if (elemKind === "Int64" || elemKind === "Float64") {
                return ctx.mod.call("list_set_i64", [listArg, indexArg, valueArg], binaryen.i32);
            }
            return ctx.mod.call("list_set_i32", [listArg, indexArg, valueArg], binaryen.i32);
        }
        default:
            return null;
    }
}
export function tryGenerateMapCall(ctx, name, expr) {
    const isI64Val = (t) => t.kind === "Int64" || t.kind === "Timestamp" || t.kind === "Float64";
    switch (name) {
        case "map_new": {
            return ctx.mod.call("map_new", [], binaryen.i32);
        }
        case "map_size": {
            const mapArg = ctx.generateExpr(expr.args[0].value);
            return ctx.mod.call("map_size", [mapArg], binaryen.i64);
        }
        case "map_has": {
            const mapArg = ctx.generateExpr(expr.args[0].value);
            const keyArg = ctx.generateExpr(expr.args[1].value);
            const mapType = ctx.inferExprType(expr.args[0].value);
            if (mapType.kind !== "Map")
                return null;
            if (mapType.key.kind === "String") {
                return ctx.mod.call("map_has_str", [mapArg, keyArg], binaryen.i32);
            }
            return ctx.mod.call("map_has_i64", [mapArg, keyArg], binaryen.i32);
        }
        case "map_get": {
            const mapArg = ctx.generateExpr(expr.args[0].value);
            const keyArg = ctx.generateExpr(expr.args[1].value);
            const mapType = ctx.inferExprType(expr.args[0].value);
            if (mapType.kind !== "Map")
                return null;
            const valI64 = isI64Val(mapType.value);
            if (mapType.key.kind === "String") {
                return ctx.mod.call(valI64 ? "map_get_str_i64" : "map_get_str_i32", [mapArg, keyArg], binaryen.i32);
            }
            return ctx.mod.call(valI64 ? "map_get_i64_i64" : "map_get_i64_i32", [mapArg, keyArg], binaryen.i32);
        }
        case "map_set": {
            const mapArg = ctx.generateExpr(expr.args[0].value);
            const keyArg = ctx.generateExpr(expr.args[1].value);
            const valArg = ctx.generateExpr(expr.args[2].value);
            const mapType = ctx.inferExprType(expr.args[0].value);
            if (mapType.kind !== "Map")
                return null;
            const valI64 = isI64Val(mapType.value);
            if (mapType.key.kind === "String") {
                return ctx.mod.call(valI64 ? "map_set_str_i64" : "map_set_str_i32", [mapArg, keyArg, valArg], binaryen.i32);
            }
            return ctx.mod.call(valI64 ? "map_set_i64_i64" : "map_set_i64_i32", [mapArg, keyArg, valArg], binaryen.i32);
        }
        case "map_remove": {
            const mapArg = ctx.generateExpr(expr.args[0].value);
            const keyArg = ctx.generateExpr(expr.args[1].value);
            const mapType = ctx.inferExprType(expr.args[0].value);
            if (mapType.kind !== "Map")
                return null;
            if (mapType.key.kind === "String") {
                return ctx.mod.call("map_remove_str", [mapArg, keyArg], binaryen.i32);
            }
            return ctx.mod.call("map_remove_i64", [mapArg, keyArg], binaryen.i32);
        }
        case "map_keys": {
            const mapArg = ctx.generateExpr(expr.args[0].value);
            const mapType = ctx.inferExprType(expr.args[0].value);
            if (mapType.kind !== "Map")
                return null;
            if (mapType.key.kind === "String") {
                return ctx.mod.call("map_keys_str", [mapArg], binaryen.i32);
            }
            return ctx.mod.call("map_keys_i64", [mapArg], binaryen.i32);
        }
        case "map_values": {
            const mapArg = ctx.generateExpr(expr.args[0].value);
            const mapType = ctx.inferExprType(expr.args[0].value);
            if (mapType.kind !== "Map")
                return null;
            if (isI64Val(mapType.value)) {
                return ctx.mod.call("map_values_i64", [mapArg], binaryen.i32);
            }
            return ctx.mod.call("map_values_i32", [mapArg], binaryen.i32);
        }
        default:
            return null;
    }
}
//# sourceMappingURL=codegen-calls.js.map