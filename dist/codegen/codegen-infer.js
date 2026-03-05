import { INT64, FLOAT64, BOOL, UNIT, STRING, substituteTypeVars, } from "../checker/types.js";
import { clarityTypeToWasm } from "./wasm-types.js";
function assertResolvedType(type, context) {
    if (type == null) {
        throw new Error(`Internal compiler error: failed to resolve type for ${context}. This is a bug — the type checker should have caught this.`);
    }
    return type;
}
export function inferExprType(ctx, expr) {
    // Use the resolved type from the checker if available (preferred path).
    // If we're inside a monomorphized body, substitute any TypeVars that the
    // checker left in the resolvedType with their concrete bindings.
    if (expr.resolvedType && expr.resolvedType.kind !== "Error") {
        return ctx.typeVarSubst.size > 0
            ? substituteTypeVars(expr.resolvedType, ctx.typeVarSubst)
            : expr.resolvedType;
    }
    // Fallback for expressions not annotated by the checker (e.g., codegen
    // internals or sub-expressions in match patterns).
    switch (expr.kind) {
        case "IntLiteral": return INT64;
        case "FloatLiteral": return FLOAT64;
        case "BoolLiteral": return BOOL;
        case "StringLiteral": return STRING;
        case "IdentifierExpr": {
            const local = ctx.locals.get(expr.name);
            if (local)
                return local.clarityType;
            const ctor = findConstructorType(ctx, expr.name);
            if (ctor)
                return ctor.union;
            // Function reference — return Function type
            if (ctx.functionTableIndices.has(expr.name)) {
                const fn = ctx.allFunctions.get(expr.name);
                if (fn)
                    return inferFunctionType(ctx, fn);
            }
            return INT64;
        }
        case "BinaryExpr": {
            const leftType = inferExprType(ctx, expr.left);
            if (["==", "!=", "<", ">", "<=", ">="].includes(expr.op))
                return BOOL;
            if (expr.op === "and" || expr.op === "or")
                return BOOL;
            if (expr.op === "++")
                return STRING;
            return leftType;
        }
        case "UnaryExpr": {
            if (expr.op === "!")
                return BOOL;
            return inferExprType(ctx, expr.operand);
        }
        case "CallExpr": {
            if (expr.callee.kind === "IdentifierExpr") {
                const name = expr.callee.name;
                // Check for indirect call through function-typed local
                const local = ctx.locals.get(name);
                if (local && local.clarityType.kind === "Function") {
                    return local.clarityType.returnType;
                }
                if (expr.args.length > 0) {
                    const argType = inferExprType(ctx, expr.args[0].value);
                    if (argType.kind === "List") {
                        switch (name) {
                            case "head":
                            case "nth": return argType.element;
                            case "tail":
                            case "append":
                            case "concat":
                            case "reverse": return argType;
                            case "length":
                            case "list_length": return INT64;
                            case "is_empty": return BOOL;
                        }
                    }
                    if (argType.kind === "Map") {
                        switch (name) {
                            case "map_size": return INT64;
                            case "map_has": return BOOL;
                            case "map_set":
                            case "map_remove": return argType;
                            case "map_keys": return { kind: "List", element: argType.key };
                            case "map_values": return { kind: "List", element: argType.value };
                            // map_get returns Option<V> — fall through to resolvedType (set by checker)
                        }
                    }
                }
                // map_new returns Map type — use resolvedType from checker
                if (name === "map_new") {
                    if (expr.resolvedType && expr.resolvedType.kind !== "Error")
                        return expr.resolvedType;
                }
                // list_set returns the same list type
                if (name === "list_set" && expr.args.length > 0) {
                    return inferExprType(ctx, expr.args[0].value);
                }
                return inferFunctionReturnType(ctx, name);
            }
            return INT64;
        }
        case "MatchExpr": {
            if (expr.arms.length > 0) {
                return inferExprType(ctx, expr.arms[0].body);
            }
            return UNIT;
        }
        case "LetExpr": return UNIT;
        case "AssignmentExpr": return UNIT;
        case "BlockExpr": {
            if (expr.result)
                return inferExprType(ctx, expr.result);
            return UNIT;
        }
        case "MemberExpr": {
            const objType = inferExprType(ctx, expr.object);
            if (objType.kind === "Record") {
                const fieldType = objType.fields.get(expr.member);
                if (fieldType)
                    return fieldType;
            }
            return INT64;
        }
        case "ListLiteral": {
            if (expr.elements.length > 0) {
                return { kind: "List", element: inferExprType(ctx, expr.elements[0]) };
            }
            return { kind: "List", element: INT64 };
        }
        case "RecordLiteral": {
            const fieldNames = new Set(expr.fields.map(f => f.name));
            for (const [, type] of ctx.allTypeDecls) {
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
export function inferFunctionType(ctx, decl) {
    const params = decl.params.map(p => assertResolvedType(ctx.checker.resolveTypeRef(p.typeAnnotation), `parameter '${p.name}' in '${decl.name}'`));
    const returnType = assertResolvedType(ctx.checker.resolveTypeRef(decl.returnType), `return type of '${decl.name}'`);
    return { kind: "Function", params, returnType, effects: new Set(decl.effects) };
}
export function inferFunctionReturnType(ctx, name) {
    if (name === ctx.currentFunction.name) {
        return assertResolvedType(ctx.checker.resolveTypeRef(ctx.currentFunction.returnType), `return type of '${name}'`);
    }
    const fn = ctx.allFunctions.get(name);
    if (fn) {
        return assertResolvedType(ctx.checker.resolveTypeRef(fn.returnType), `return type of '${name}'`);
    }
    // Check if it's a union constructor
    const ctor = findConstructorType(ctx, name);
    if (ctor) {
        return ctor.union;
    }
    // Look up return type from the single source of truth (builtins-registry).
    const regType = ctx.builtinReturnTypeMap.get(name);
    if (regType !== undefined)
        return regType;
    return INT64;
}
export function inferWasmReturnType(ctx, name) {
    const clarityType = inferFunctionReturnType(ctx, name);
    return clarityTypeToWasm(clarityType);
}
export function findConstructorType(ctx, name) {
    for (const [, type] of ctx.allTypeDecls) {
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
//# sourceMappingURL=codegen-infer.js.map