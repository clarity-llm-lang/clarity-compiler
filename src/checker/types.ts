export type ClarityType =
  | { kind: "Int64" }
  | { kind: "Float64" }
  | { kind: "String" }
  | { kind: "Bool" }
  | { kind: "Bytes" }
  | { kind: "Timestamp" }
  | { kind: "Unit" }
  | { kind: "Record"; name: string; fields: Map<string, ClarityType> }
  | { kind: "Union"; name: string; variants: ClarityVariant[] }
  | { kind: "List"; element: ClarityType }
  | { kind: "Option"; inner: ClarityType }
  | { kind: "Result"; ok: ClarityType; err: ClarityType }
  | { kind: "Function"; params: ClarityType[]; paramNames?: string[]; returnType: ClarityType; effects: Set<string> }
  | { kind: "TypeVar"; name: string }
  | { kind: "Error" };

export interface ClarityVariant {
  name: string;
  fields: Map<string, ClarityType>;
}

// Built-in types
export const INT64: ClarityType = { kind: "Int64" };
export const FLOAT64: ClarityType = { kind: "Float64" };
export const STRING: ClarityType = { kind: "String" };
export const BOOL: ClarityType = { kind: "Bool" };
export const BYTES: ClarityType = { kind: "Bytes" };
export const TIMESTAMP: ClarityType = { kind: "Timestamp" };
export const UNIT: ClarityType = { kind: "Unit" };
export const ERROR_TYPE: ClarityType = { kind: "Error" };

export function typesEqual(a: ClarityType, b: ClarityType): boolean {
  if (a.kind === "Error" || b.kind === "Error") return true; // error propagation
  if (a.kind !== b.kind) return false;

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
      const bRec = b as Extract<ClarityType, { kind: "Record" }>;
      if (a.name !== bRec.name) return false;
      if (a.fields.size !== bRec.fields.size) return false;
      for (const [k, v] of a.fields) {
        const bv = bRec.fields.get(k);
        if (!bv || !typesEqual(v, bv)) return false;
      }
      return true;
    }

    case "Union": {
      const bUnion = b as Extract<ClarityType, { kind: "Union" }>;
      return a.name === bUnion.name;
    }

    case "List": {
      const bList = b as Extract<ClarityType, { kind: "List" }>;
      return typesEqual(a.element, bList.element);
    }

    case "Option": {
      const bOpt = b as Extract<ClarityType, { kind: "Option" }>;
      return typesEqual(a.inner, bOpt.inner);
    }

    case "Result": {
      const bRes = b as Extract<ClarityType, { kind: "Result" }>;
      return typesEqual(a.ok, bRes.ok) && typesEqual(a.err, bRes.err);
    }

    case "Function": {
      const bFn = b as Extract<ClarityType, { kind: "Function" }>;
      if (a.params.length !== bFn.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!typesEqual(a.params[i], bFn.params[i])) return false;
      }
      return typesEqual(a.returnType, bFn.returnType);
    }

    case "TypeVar": {
      const bVar = b as Extract<ClarityType, { kind: "TypeVar" }>;
      return a.name === bVar.name;
    }

    default:
      return false;
  }
}

export function typeToString(t: ClarityType): string {
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
    case "Option": return `Option<${typeToString(t.inner)}>`;
    case "Result": return `Result<${typeToString(t.ok)}, ${typeToString(t.err)}>`;
    case "Function": return `(${t.params.map(typeToString).join(", ")}) -> ${typeToString(t.returnType)}`;
    case "TypeVar": return t.name;
    case "Error": return "<error>";
  }
}

// Resolve a type name to a built-in type
export function resolveBuiltinType(name: string): ClarityType | null {
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
export function containsTypeVar(t: ClarityType): boolean {
  switch (t.kind) {
    case "TypeVar": return true;
    case "List": return containsTypeVar(t.element);
    case "Option": return containsTypeVar(t.inner);
    case "Result": return containsTypeVar(t.ok) || containsTypeVar(t.err);
    case "Function": return t.params.some(containsTypeVar) || containsTypeVar(t.returnType);
    case "Record": return [...t.fields.values()].some(containsTypeVar);
    case "Union": return t.variants.some(v => [...v.fields.values()].some(containsTypeVar));
    default: return false;
  }
}

// Substitute type variables using a mapping
export function substituteTypeVars(t: ClarityType, subst: Map<string, ClarityType>): ClarityType {
  switch (t.kind) {
    case "TypeVar": return subst.get(t.name) ?? t;
    case "List": return { kind: "List", element: substituteTypeVars(t.element, subst) };
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
      const fields = new Map<string, ClarityType>();
      for (const [k, v] of t.fields) fields.set(k, substituteTypeVars(v, subst));
      return { kind: "Record", name: t.name, fields };
    }
    case "Union": {
      const variants = t.variants.map(v => {
        const fields = new Map<string, ClarityType>();
        for (const [k, fv] of v.fields) fields.set(k, substituteTypeVars(fv, subst));
        return { name: v.name, fields };
      });
      return { kind: "Union", name: t.name, variants };
    }
    default: return t;
  }
}

// Unify a generic type with a concrete type, collecting type variable bindings.
// Returns true if unification succeeds.
export function unifyTypes(
  generic: ClarityType,
  concrete: ClarityType,
  bindings: Map<string, ClarityType>,
): boolean {
  if (generic.kind === "Error" || concrete.kind === "Error") return true;

  if (generic.kind === "TypeVar") {
    const existing = bindings.get(generic.name);
    if (existing) {
      return typesEqual(existing, concrete);
    }
    bindings.set(generic.name, concrete);
    return true;
  }

  if (generic.kind !== concrete.kind) return false;

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
      const cList = concrete as Extract<ClarityType, { kind: "List" }>;
      return unifyTypes(generic.element, cList.element, bindings);
    }

    case "Option": {
      const cOpt = concrete as Extract<ClarityType, { kind: "Option" }>;
      return unifyTypes(generic.inner, cOpt.inner, bindings);
    }

    case "Result": {
      const cRes = concrete as Extract<ClarityType, { kind: "Result" }>;
      return unifyTypes(generic.ok, cRes.ok, bindings) && unifyTypes(generic.err, cRes.err, bindings);
    }

    case "Function": {
      const cFn = concrete as Extract<ClarityType, { kind: "Function" }>;
      if (generic.params.length !== cFn.params.length) return false;
      for (let i = 0; i < generic.params.length; i++) {
        if (!unifyTypes(generic.params[i], cFn.params[i], bindings)) return false;
      }
      return unifyTypes(generic.returnType, cFn.returnType, bindings);
    }

    case "Record": {
      const cRec = concrete as Extract<ClarityType, { kind: "Record" }>;
      if (generic.name !== cRec.name) return false;
      for (const [k, v] of generic.fields) {
        const cv = cRec.fields.get(k);
        if (!cv || !unifyTypes(v, cv, bindings)) return false;
      }
      return true;
    }

    case "Union": {
      const cUnion = concrete as Extract<ClarityType, { kind: "Union" }>;
      return generic.name === cUnion.name;
    }

    default:
      return false;
  }
}
