// Shared types and helper type constants for builtin domain files.
import { INT64, FLOAT64, STRING, BOOL, UNIT, BYTES, TIMESTAMP, } from "../../checker/types.js";
export { INT64, FLOAT64, STRING, BOOL, UNIT, BYTES, TIMESTAMP };
// Shared type constants used across domain files
export const LIST_INT = { kind: "List", element: INT64 };
export const LIST_STRING = { kind: "List", element: STRING };
export const MAP_STRING_STRING = { kind: "Map", key: STRING, value: STRING };
export const OPTION_STRING = {
    kind: "Union",
    name: "Option<String>",
    variants: [
        { name: "Some", fields: new Map([["value", STRING]]) },
        { name: "None", fields: new Map() },
    ],
};
export const OPTION_MAP_STRING_STRING = {
    kind: "Union",
    name: "Option<Map<String, String>>",
    variants: [
        { name: "Some", fields: new Map([["value", MAP_STRING_STRING]]) },
        { name: "None", fields: new Map() },
    ],
};
// Generic type variable for polymorphic list operations
export const T = { kind: "TypeVar", name: "T" };
export const LIST_T = { kind: "List", element: T };
// Generic type variables for Map<K, V>
export const K = { kind: "TypeVar", name: "K" };
export const V = { kind: "TypeVar", name: "V" };
export const MAP_KV = { kind: "Map", key: K, value: V };
export const LIST_K = { kind: "List", element: K };
export const LIST_V = { kind: "List", element: V };
//# sourceMappingURL=types.js.map