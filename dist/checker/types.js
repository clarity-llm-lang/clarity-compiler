// Built-in types
export const INT64 = { kind: "Int64" };
export const FLOAT64 = { kind: "Float64" };
export const STRING = { kind: "String" };
export const BOOL = { kind: "Bool" };
export const BYTES = { kind: "Bytes" };
export const TIMESTAMP = { kind: "Timestamp" };
export const UNIT = { kind: "Unit" };
export const ERROR_TYPE = { kind: "Error" };
export function typesEqual(a, b) {
    if (a.kind === "Error" || b.kind === "Error")
        return true; // error propagation
    if (a.kind !== b.kind)
        return false;
    switch (a.kind) {
        case "Int64":
        case "Float64":
        case "String":
        case "Bool":
        case "Bytes":
        case "Timestamp":
        case "Unit":
            return true;
        case "Record": {
            const bRec = b;
            if (a.name !== bRec.name)
                return false;
            if (a.fields.size !== bRec.fields.size)
                return false;
            for (const [k, v] of a.fields) {
                const bv = bRec.fields.get(k);
                if (!bv || !typesEqual(v, bv))
                    return false;
            }
            return true;
        }
        case "Union": {
            const bUnion = b;
            if (a.name === bUnion.name)
                return true;
            // Placeholder compatibility: Option<Unit> from bare `None` is compatible with any Option<T>.
            if (a.name.startsWith("Option<") && bUnion.name.startsWith("Option<") &&
                (a.name === "Option<Unit>" || bUnion.name === "Option<Unit>"))
                return true;
            return false;
        }
        case "List": {
            const bList = b;
            if (typesEqual(a.element, bList.element))
                return true;
            // Placeholder compatibility: List<Unit> from bare `[]` is compatible with any List<T>.
            if (a.element.kind === "Unit" || bList.element.kind === "Unit")
                return true;
            return false;
        }
        case "Map": {
            const bMap = b;
            return typesEqual(a.key, bMap.key) && typesEqual(a.value, bMap.value);
        }
        case "Option": {
            const bOpt = b;
            return typesEqual(a.inner, bOpt.inner);
        }
        case "Result": {
            const bRes = b;
            return typesEqual(a.ok, bRes.ok) && typesEqual(a.err, bRes.err);
        }
        case "Function": {
            const bFn = b;
            if (a.params.length !== bFn.params.length)
                return false;
            for (let i = 0; i < a.params.length; i++) {
                if (!typesEqual(a.params[i], bFn.params[i]))
                    return false;
            }
            return typesEqual(a.returnType, bFn.returnType);
        }
        case "TypeVar": {
            const bVar = b;
            return a.name === bVar.name;
        }
        default:
            return false;
    }
}
// Returns true for placeholder types produced by bare None / [] literals.
// These are compatible with any Option<T> / List<T> respectively.
export function isPlaceholderType(t) {
    if (t.kind === "Union" && t.name === "Option<Unit>")
        return true;
    if (t.kind === "List" && t.element.kind === "Unit")
        return true;
    return false;
}
// When two types are compatible (typesEqual returns true), pick the more specific one.
// Promotes placeholder types (Option<Unit>, List<Unit>) to the concrete type.
export function promoteType(a, b) {
    if (isPlaceholderType(a) && !isPlaceholderType(b))
        return b;
    if (isPlaceholderType(b) && !isPlaceholderType(a))
        return a;
    return a;
}
export function typeToString(t) {
    switch (t.kind) {
        case "Int64": return "Int64";
        case "Float64": return "Float64";
        case "String": return "String";
        case "Bool": return "Bool";
        case "Bytes": return "Bytes";
        case "Timestamp": return "Timestamp";
        case "Unit": return "Unit";
        case "Record": return t.name;
        case "Union": return t.name;
        case "List": return `List<${typeToString(t.element)}>`;
        case "Map": return `Map<${typeToString(t.key)}, ${typeToString(t.value)}>`;
        case "Option": return `Option<${typeToString(t.inner)}>`;
        case "Result": return `Result<${typeToString(t.ok)}, ${typeToString(t.err)}>`;
        case "Function": return `(${t.params.map(typeToString).join(", ")}) -> ${typeToString(t.returnType)}`;
        case "TypeVar": return t.name;
        case "Error": return "<error>";
    }
}
// Resolve a type name to a built-in type
export function resolveBuiltinType(name) {
    switch (name) {
        case "Int64": return INT64;
        case "Float64": return FLOAT64;
        case "String": return STRING;
        case "Bool": return BOOL;
        case "Bytes": return BYTES;
        case "Timestamp": return TIMESTAMP;
        case "Unit": return UNIT;
        default: return null;
    }
}
// Check if a type contains any TypeVar
export function containsTypeVar(t) {
    switch (t.kind) {
        case "TypeVar": return true;
        case "List": return containsTypeVar(t.element);
        case "Map": return containsTypeVar(t.key) || containsTypeVar(t.value);
        case "Option": return containsTypeVar(t.inner);
        case "Result": return containsTypeVar(t.ok) || containsTypeVar(t.err);
        case "Function": return t.params.some(containsTypeVar) || containsTypeVar(t.returnType);
        case "Record": return [...t.fields.values()].some(containsTypeVar);
        case "Union": return t.variants.some(v => [...v.fields.values()].some(containsTypeVar));
        default: return false;
    }
}
// Substitute type variables using a mapping
export function substituteTypeVars(t, subst) {
    switch (t.kind) {
        case "TypeVar": return subst.get(t.name) ?? t;
        case "List": return { kind: "List", element: substituteTypeVars(t.element, subst) };
        case "Map": return { kind: "Map", key: substituteTypeVars(t.key, subst), value: substituteTypeVars(t.value, subst) };
        case "Option": return { kind: "Option", inner: substituteTypeVars(t.inner, subst) };
        case "Result": return { kind: "Result", ok: substituteTypeVars(t.ok, subst), err: substituteTypeVars(t.err, subst) };
        case "Function": return {
            kind: "Function",
            params: t.params.map(p => substituteTypeVars(p, subst)),
            paramNames: t.paramNames,
            returnType: substituteTypeVars(t.returnType, subst),
            effects: t.effects,
        };
        case "Record": {
            const fields = new Map();
            for (const [k, v] of t.fields)
                fields.set(k, substituteTypeVars(v, subst));
            return { kind: "Record", name: t.name, fields };
        }
        case "Union": {
            const variants = t.variants.map(v => {
                const fields = new Map();
                for (const [k, fv] of v.fields)
                    fields.set(k, substituteTypeVars(fv, subst));
                return { name: v.name, fields };
            });
            // Update the union name to reflect substituted type variables.
            // e.g. "Option<T>" with T→Int64 becomes "Option<Int64>".
            let name = t.name;
            for (const [varName, concreteType] of subst) {
                // Replace whole-word occurrences of varName in the angle-bracket name.
                // Use a regex that matches varName when followed by ',' '>' or end of name.
                name = name.replace(new RegExp(`\\b${varName}\\b`, "g"), typeToString(concreteType));
            }
            return { kind: "Union", name, variants };
        }
        default: return t;
    }
}
// Unify a generic type with a concrete type, collecting type variable bindings.
// Returns true if unification succeeds.
export function unifyTypes(generic, concrete, bindings) {
    if (generic.kind === "Error" || concrete.kind === "Error")
        return true;
    if (generic.kind === "TypeVar") {
        const existing = bindings.get(generic.name);
        if (existing) {
            return typesEqual(existing, concrete);
        }
        bindings.set(generic.name, concrete);
        return true;
    }
    if (generic.kind !== concrete.kind)
        return false;
    switch (generic.kind) {
        case "Int64":
        case "Float64":
        case "String":
        case "Bool":
        case "Bytes":
        case "Timestamp":
        case "Unit":
            return true;
        case "List": {
            const cList = concrete;
            return unifyTypes(generic.element, cList.element, bindings);
        }
        case "Map": {
            const cMap = concrete;
            return unifyTypes(generic.key, cMap.key, bindings) && unifyTypes(generic.value, cMap.value, bindings);
        }
        case "Option": {
            const cOpt = concrete;
            return unifyTypes(generic.inner, cOpt.inner, bindings);
        }
        case "Result": {
            const cRes = concrete;
            return unifyTypes(generic.ok, cRes.ok, bindings) && unifyTypes(generic.err, cRes.err, bindings);
        }
        case "Function": {
            const cFn = concrete;
            if (generic.params.length !== cFn.params.length)
                return false;
            for (let i = 0; i < generic.params.length; i++) {
                if (!unifyTypes(generic.params[i], cFn.params[i], bindings))
                    return false;
            }
            return unifyTypes(generic.returnType, cFn.returnType, bindings);
        }
        case "Record": {
            const cRec = concrete;
            if (generic.name !== cRec.name)
                return false;
            for (const [k, v] of generic.fields) {
                const cv = cRec.fields.get(k);
                if (!cv || !unifyTypes(v, cv, bindings))
                    return false;
            }
            return true;
        }
        case "Union": {
            const cUnion = concrete;
            return generic.name === cUnion.name;
        }
        default:
            return false;
    }
}
//# sourceMappingURL=types.js.map