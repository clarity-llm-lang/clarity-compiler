// Shared types and helper type constants for builtin domain files.

import {
  INT64,
  FLOAT64,
  STRING,
  BOOL,
  UNIT,
  BYTES,
  TIMESTAMP,
  type ClarityType,
} from "../../checker/types.js";

export { INT64, FLOAT64, STRING, BOOL, UNIT, BYTES, TIMESTAMP };
export type { ClarityType };

export interface ClarityBuiltin {
  name: string;
  params: ClarityType[];
  paramNames: string[];
  returnType: ClarityType;
  effects: string[];
  doc: string;
  category: string;
}

export interface EffectDefinition {
  name: string;
  description: string;
}

// Shared type constants used across domain files
export const LIST_INT: ClarityType = { kind: "List", element: INT64 };
export const LIST_STRING: ClarityType = { kind: "List", element: STRING };
export const MAP_STRING_STRING: ClarityType = { kind: "Map", key: STRING, value: STRING };
export const OPTION_STRING: ClarityType = {
  kind: "Union",
  name: "Option<String>",
  variants: [
    { name: "Some", fields: new Map([["value", STRING]]) },
    { name: "None", fields: new Map() },
  ],
};
export const OPTION_MAP_STRING_STRING: ClarityType = {
  kind: "Union",
  name: "Option<Map<String, String>>",
  variants: [
    { name: "Some", fields: new Map([["value", MAP_STRING_STRING]]) },
    { name: "None", fields: new Map() },
  ],
};

// Generic type variable for polymorphic list operations
export const T: ClarityType = { kind: "TypeVar", name: "T" };
export const LIST_T: ClarityType = { kind: "List", element: T };

// Generic type variables for Map<K, V>
export const K: ClarityType = { kind: "TypeVar", name: "K" };
export const V: ClarityType = { kind: "TypeVar", name: "V" };
export const MAP_KV: ClarityType = { kind: "Map", key: K, value: V };
export const LIST_K: ClarityType = { kind: "List", element: K };
export const LIST_V: ClarityType = { kind: "List", element: V };
