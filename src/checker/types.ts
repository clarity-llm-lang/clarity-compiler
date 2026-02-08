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
  | { kind: "Function"; params: ClarityType[]; returnType: ClarityType; effects: Set<string> }
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

    case "Function": {
      const bFn = b as Extract<ClarityType, { kind: "Function" }>;
      if (a.params.length !== bFn.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!typesEqual(a.params[i], bFn.params[i])) return false;
      }
      return typesEqual(a.returnType, bFn.returnType);
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
    case "Function": return `(${t.params.map(typeToString).join(", ")}) -> ${typeToString(t.returnType)}`;
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
