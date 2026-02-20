// =============================================================================
// Clarity Built-in Registry — Single Source of Truth
// =============================================================================
//
// This file declares every Clarity-level built-in function and effect.
// The type checker and introspection command read from here.
//
// To add a new built-in function:
//   1. Add an entry to CLARITY_BUILTINS below
//   2. Add the JS runtime implementation in src/codegen/runtime.ts
//   3. If the WASM import shape is new, add it to src/codegen/builtins.ts
//   4. Run `npm test` and `clarityc introspect --builtins` to verify
//
// To add a new effect:
//   1. Add an entry to EFFECT_DEFINITIONS below
//   2. Use the effect name in your built-in's `effects` array

import {
  INT64,
  FLOAT64,
  STRING,
  BOOL,
  UNIT,
  BYTES,
  TIMESTAMP,
  type ClarityType,
} from "../checker/types.js";

// -----------------------------------------------------------------------------
// Interfaces
// -----------------------------------------------------------------------------

export interface ClarityBuiltin {
  /** Function name as used in Clarity source code */
  name: string;
  /** Clarity parameter types */
  params: ClarityType[];
  /** Clarity parameter names (must match params array length) */
  paramNames: string[];
  /** Clarity return type */
  returnType: ClarityType;
  /** Required effects (empty array = pure function) */
  effects: string[];
  /** LLM-readable description of what the function does */
  doc: string;
  /** Category for grouping: "io", "string", "math", "list", "conversion", "test", "log" */
  category: string;
}

export interface EffectDefinition {
  /** Effect name as used in effect[...] annotations */
  name: string;
  /** LLM-readable description of what this effect enables */
  description: string;
}

// -----------------------------------------------------------------------------
// Effect Definitions
// -----------------------------------------------------------------------------

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  { name: "DB", description: "Database read/write operations" },
  { name: "Network", description: "Network and HTTP operations" },
  { name: "Time", description: "Access to current time and timestamps" },
  { name: "Random", description: "Random number generation" },
  { name: "Log", description: "Logging and printing to stdout/stderr" },
  { name: "FileSystem", description: "File I/O, stdin/stdout, command-line args, and process control" },
  { name: "Test", description: "Test assertions for the self-healing test system" },
];

// -----------------------------------------------------------------------------
// Helper types used in definitions
// -----------------------------------------------------------------------------

const LIST_INT: ClarityType = { kind: "List", element: INT64 };
const LIST_STRING: ClarityType = { kind: "List", element: STRING };

// Generic type variable for polymorphic list operations
const T: ClarityType = { kind: "TypeVar", name: "T" };
const LIST_T: ClarityType = { kind: "List", element: T };

// -----------------------------------------------------------------------------
// Built-in Function Definitions
// -----------------------------------------------------------------------------

export const CLARITY_BUILTINS: ClarityBuiltin[] = [
  // --- I/O & Logging (require Log effect) ---
  {
    name: "print_string",
    params: [STRING],
    paramNames: ["value"],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Print a string to stdout followed by a newline.",
    category: "log",
  },
  {
    name: "print_int",
    params: [INT64],
    paramNames: ["value"],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Print an integer to stdout followed by a newline.",
    category: "log",
  },
  {
    name: "print_float",
    params: [FLOAT64],
    paramNames: ["value"],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Print a float to stdout followed by a newline.",
    category: "log",
  },
  {
    name: "log_info",
    params: [STRING],
    paramNames: ["message"],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Log an informational message to stderr.",
    category: "log",
  },
  {
    name: "log_warn",
    params: [STRING],
    paramNames: ["message"],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Log a warning message to stderr.",
    category: "log",
  },

  // --- String operations ---
  {
    name: "string_concat",
    params: [STRING, STRING],
    paramNames: ["a", "b"],
    returnType: STRING,
    effects: [],
    doc: "Concatenate two strings. Prefer the ++ operator for literals.",
    category: "string",
  },
  {
    name: "string_eq",
    params: [STRING, STRING],
    paramNames: ["a", "b"],
    returnType: BOOL,
    effects: [],
    doc: "Compare two strings for equality. Returns True if equal.",
    category: "string",
  },
  {
    name: "string_length",
    params: [STRING],
    paramNames: ["s"],
    returnType: INT64,
    effects: [],
    doc: "Return the length of a string in bytes (UTF-8).",
    category: "string",
  },
  {
    name: "substring",
    params: [STRING, INT64, INT64],
    paramNames: ["s", "start", "end"],
    returnType: STRING,
    effects: [],
    doc: "Extract a substring from start index to end index (exclusive).",
    category: "string",
  },
  {
    name: "char_at",
    params: [STRING, INT64],
    paramNames: ["s", "index"],
    returnType: STRING,
    effects: [],
    doc: "Return the character at the given index as a single-character string.",
    category: "string",
  },
  {
    name: "contains",
    params: [STRING, STRING],
    paramNames: ["haystack", "needle"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if the string contains the given substring.",
    category: "string",
  },
  {
    name: "index_of",
    params: [STRING, STRING],
    paramNames: ["haystack", "needle"],
    returnType: INT64,
    effects: [],
    doc: "Return the index of the first occurrence of needle in haystack, or -1 if not found.",
    category: "string",
  },
  {
    name: "trim",
    params: [STRING],
    paramNames: ["s"],
    returnType: STRING,
    effects: [],
    doc: "Remove leading and trailing whitespace from a string.",
    category: "string",
  },
  {
    name: "split",
    params: [STRING, STRING],
    paramNames: ["s", "delimiter"],
    returnType: LIST_STRING,
    effects: [],
    doc: "Split a string by a delimiter, returning a list of substrings.",
    category: "string",
  },

  {
    name: "char_code",
    params: [STRING],
    paramNames: ["s"],
    returnType: INT64,
    effects: [],
    doc: "Return the Unicode code point of the first character in the string. Returns 0 for empty strings.",
    category: "string",
  },
  {
    name: "char_from_code",
    params: [INT64],
    paramNames: ["code"],
    returnType: STRING,
    effects: [],
    doc: "Return a single-character string from a Unicode code point.",
    category: "string",
  },

  // --- Type conversions ---
  {
    name: "int_to_float",
    params: [INT64],
    paramNames: ["value"],
    returnType: FLOAT64,
    effects: [],
    doc: "Convert an Int64 to Float64.",
    category: "conversion",
  },
  {
    name: "float_to_int",
    params: [FLOAT64],
    paramNames: ["value"],
    returnType: INT64,
    effects: [],
    doc: "Convert a Float64 to Int64 by truncation.",
    category: "conversion",
  },
  {
    name: "int_to_string",
    params: [INT64],
    paramNames: ["value"],
    returnType: STRING,
    effects: [],
    doc: "Convert an Int64 to its decimal string representation.",
    category: "conversion",
  },
  {
    name: "float_to_string",
    params: [FLOAT64],
    paramNames: ["value"],
    returnType: STRING,
    effects: [],
    doc: "Convert a Float64 to its string representation.",
    category: "conversion",
  },
  {
    name: "string_to_int",
    params: [STRING],
    paramNames: ["s"],
    returnType: {
      kind: "Union",
      name: "Option<Int64>",
      variants: [
        { name: "Some", fields: new Map([["value", INT64]]) },
        { name: "None", fields: new Map() },
      ],
    },
    effects: [],
    doc: "Parse a string as Int64. Returns Some(value) on success, None on failure.",
    category: "conversion",
  },
  {
    name: "string_to_float",
    params: [STRING],
    paramNames: ["s"],
    returnType: {
      kind: "Union",
      name: "Option<Float64>",
      variants: [
        { name: "Some", fields: new Map([["value", FLOAT64]]) },
        { name: "None", fields: new Map() },
      ],
    },
    effects: [],
    doc: "Parse a string as Float64. Returns Some(value) on success, None on failure.",
    category: "conversion",
  },

  // --- Math builtins ---
  {
    name: "abs_int",
    params: [INT64],
    paramNames: ["n"],
    returnType: INT64,
    effects: [],
    doc: "Return the absolute value of an integer.",
    category: "math",
  },
  {
    name: "min_int",
    params: [INT64, INT64],
    paramNames: ["a", "b"],
    returnType: INT64,
    effects: [],
    doc: "Return the smaller of two integers.",
    category: "math",
  },
  {
    name: "max_int",
    params: [INT64, INT64],
    paramNames: ["a", "b"],
    returnType: INT64,
    effects: [],
    doc: "Return the larger of two integers.",
    category: "math",
  },
  {
    name: "sqrt",
    params: [FLOAT64],
    paramNames: ["x"],
    returnType: FLOAT64,
    effects: [],
    doc: "Return the square root of a float.",
    category: "math",
  },
  {
    name: "pow",
    params: [FLOAT64, FLOAT64],
    paramNames: ["base", "exponent"],
    returnType: FLOAT64,
    effects: [],
    doc: "Return base raised to the power of exponent.",
    category: "math",
  },
  {
    name: "floor",
    params: [FLOAT64],
    paramNames: ["x"],
    returnType: FLOAT64,
    effects: [],
    doc: "Round a float down to the nearest integer value.",
    category: "math",
  },
  {
    name: "ceil",
    params: [FLOAT64],
    paramNames: ["x"],
    returnType: FLOAT64,
    effects: [],
    doc: "Round a float up to the nearest integer value.",
    category: "math",
  },

  // --- List operations (generic over element type T) ---
  {
    name: "list_length",
    params: [LIST_T],
    paramNames: ["list"],
    returnType: INT64,
    effects: [],
    doc: "Return the number of elements in a list.",
    category: "list",
  },
  {
    name: "length",
    params: [LIST_T],
    paramNames: ["list"],
    returnType: INT64,
    effects: [],
    doc: "Return the number of elements in a list (alias for list_length).",
    category: "list",
  },
  {
    name: "head",
    params: [LIST_T],
    paramNames: ["list"],
    returnType: T,
    effects: [],
    doc: "Return the first element of a list. Traps on empty list.",
    category: "list",
  },
  {
    name: "tail",
    params: [LIST_T],
    paramNames: ["list"],
    returnType: LIST_T,
    effects: [],
    doc: "Return a list without its first element.",
    category: "list",
  },
  {
    name: "append",
    params: [LIST_T, T],
    paramNames: ["list", "element"],
    returnType: LIST_T,
    effects: [],
    doc: "Append an element to the end of a list.",
    category: "list",
  },
  {
    name: "concat",
    params: [LIST_T, LIST_T],
    paramNames: ["a", "b"],
    returnType: LIST_T,
    effects: [],
    doc: "Concatenate two lists.",
    category: "list",
  },
  {
    name: "reverse",
    params: [LIST_T],
    paramNames: ["list"],
    returnType: LIST_T,
    effects: [],
    doc: "Reverse a list.",
    category: "list",
  },
  {
    name: "is_empty",
    params: [LIST_T],
    paramNames: ["list"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if the list has no elements.",
    category: "list",
  },
  {
    name: "nth",
    params: [LIST_T, INT64],
    paramNames: ["list", "index"],
    returnType: T,
    effects: [],
    doc: "Return the element at the given index (0-based). Traps if index is out of bounds.",
    category: "list",
  },
  {
    name: "list_set",
    params: [LIST_T, INT64, T],
    paramNames: ["list", "index", "value"],
    returnType: LIST_T,
    effects: [],
    doc: "Return a new list with the element at the given index replaced (0-based). Traps if index is out of bounds.",
    category: "list",
  },

  // --- I/O primitives (require FileSystem effect) ---
  {
    name: "read_line",
    params: [],
    paramNames: [],
    returnType: STRING,
    effects: ["FileSystem"],
    doc: "Read one line from stdin (up to newline).",
    category: "io",
  },
  {
    name: "read_all_stdin",
    params: [],
    paramNames: [],
    returnType: STRING,
    effects: ["FileSystem"],
    doc: "Read all remaining input from stdin.",
    category: "io",
  },
  {
    name: "read_file",
    params: [STRING],
    paramNames: ["path"],
    returnType: STRING,
    effects: ["FileSystem"],
    doc: "Read the entire contents of a file as a string.",
    category: "io",
  },
  {
    name: "write_file",
    params: [STRING, STRING],
    paramNames: ["path", "content"],
    returnType: UNIT,
    effects: ["FileSystem"],
    doc: "Write a string to a file, replacing existing contents.",
    category: "io",
  },
  {
    name: "get_args",
    params: [],
    paramNames: [],
    returnType: LIST_STRING,
    effects: ["FileSystem"],
    doc: "Return command-line arguments as a list of strings.",
    category: "io",
  },
  {
    name: "exit",
    params: [INT64],
    paramNames: ["code"],
    returnType: UNIT,
    effects: ["FileSystem"],
    doc: "Exit the process with the given status code.",
    category: "io",
  },

  // --- Test assertions (require Test effect) ---
  {
    name: "assert_eq",
    params: [INT64, INT64],
    paramNames: ["actual", "expected"],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert two Int64 values are equal.",
    category: "test",
  },
  {
    name: "assert_eq_float",
    params: [FLOAT64, FLOAT64],
    paramNames: ["actual", "expected"],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert two Float64 values are equal (epsilon 1e-9).",
    category: "test",
  },
  {
    name: "assert_eq_string",
    params: [STRING, STRING],
    paramNames: ["actual", "expected"],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert two String values are equal.",
    category: "test",
  },
  {
    name: "assert_true",
    params: [BOOL],
    paramNames: ["condition"],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert a condition is True.",
    category: "test",
  },
  {
    name: "assert_false",
    params: [BOOL],
    paramNames: ["condition"],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert a condition is False.",
    category: "test",
  },

  // --- Bytes builtins ---
  {
    name: "bytes_new",
    params: [INT64],
    paramNames: ["size"],
    returnType: BYTES,
    effects: [],
    doc: "Create a new zero-filled Bytes buffer of the given size.",
    category: "bytes",
  },
  {
    name: "bytes_length",
    params: [BYTES],
    paramNames: ["b"],
    returnType: INT64,
    effects: [],
    doc: "Return the length of a Bytes buffer.",
    category: "bytes",
  },
  {
    name: "bytes_get",
    params: [BYTES, INT64],
    paramNames: ["b", "index"],
    returnType: INT64,
    effects: [],
    doc: "Get the byte at the given index (0-255). Returns 0 for out-of-bounds.",
    category: "bytes",
  },
  {
    name: "bytes_set",
    params: [BYTES, INT64, INT64],
    paramNames: ["b", "index", "value"],
    returnType: BYTES,
    effects: [],
    doc: "Set the byte at the given index. Returns a new Bytes with the modification.",
    category: "bytes",
  },
  {
    name: "bytes_slice",
    params: [BYTES, INT64, INT64],
    paramNames: ["b", "start", "length"],
    returnType: BYTES,
    effects: [],
    doc: "Extract a sub-range of bytes. Returns a new Bytes buffer.",
    category: "bytes",
  },
  {
    name: "bytes_concat",
    params: [BYTES, BYTES],
    paramNames: ["a", "b"],
    returnType: BYTES,
    effects: [],
    doc: "Concatenate two Bytes buffers.",
    category: "bytes",
  },
  {
    name: "bytes_from_string",
    params: [STRING],
    paramNames: ["s"],
    returnType: BYTES,
    effects: [],
    doc: "Encode a String as UTF-8 bytes.",
    category: "bytes",
  },
  {
    name: "bytes_to_string",
    params: [BYTES],
    paramNames: ["b"],
    returnType: STRING,
    effects: [],
    doc: "Decode a Bytes buffer as a UTF-8 string.",
    category: "bytes",
  },

  // --- Crypto builtins ---
  {
    name: "sha256",
    params: [STRING],
    paramNames: ["s"],
    returnType: STRING,
    effects: [],
    doc: "Compute the SHA-256 hash of a string and return the hex digest (64 lowercase hex chars).",
    category: "crypto",
  },

  // --- Timestamp builtins ---
  {
    name: "now",
    params: [],
    paramNames: [],
    returnType: TIMESTAMP,
    effects: ["Time"],
    doc: "Return the current time as milliseconds since Unix epoch.",
    category: "time",
  },
  {
    name: "timestamp_to_string",
    params: [TIMESTAMP],
    paramNames: ["t"],
    returnType: STRING,
    effects: [],
    doc: "Convert a Timestamp to an ISO 8601 string.",
    category: "time",
  },
  {
    name: "timestamp_to_int",
    params: [TIMESTAMP],
    paramNames: ["t"],
    returnType: INT64,
    effects: [],
    doc: "Convert a Timestamp to milliseconds since epoch (Int64).",
    category: "time",
  },
  {
    name: "timestamp_from_int",
    params: [INT64],
    paramNames: ["ms"],
    returnType: TIMESTAMP,
    effects: [],
    doc: "Create a Timestamp from milliseconds since epoch.",
    category: "time",
  },
  {
    name: "timestamp_add",
    params: [TIMESTAMP, INT64],
    paramNames: ["t", "ms"],
    returnType: TIMESTAMP,
    effects: [],
    doc: "Add milliseconds to a Timestamp.",
    category: "time",
  },
  {
    name: "timestamp_diff",
    params: [TIMESTAMP, TIMESTAMP],
    paramNames: ["a", "b"],
    returnType: INT64,
    effects: [],
    doc: "Return the difference in milliseconds between two Timestamps (a - b).",
    category: "time",
  },
];

// -----------------------------------------------------------------------------
// Query helpers
// -----------------------------------------------------------------------------

/** Get the set of all known effect names (for the checker) */
export function getKnownEffectNames(): Set<string> {
  return new Set(EFFECT_DEFINITIONS.map((e) => e.name));
}

/** Get all built-ins for a given effect */
export function getBuiltinsForEffect(effectName: string): ClarityBuiltin[] {
  return CLARITY_BUILTINS.filter((b) => b.effects.includes(effectName));
}

/** Get all built-ins in a given category */
export function getBuiltinsByCategory(category: string): ClarityBuiltin[] {
  return CLARITY_BUILTINS.filter((b) => b.category === category);
}
