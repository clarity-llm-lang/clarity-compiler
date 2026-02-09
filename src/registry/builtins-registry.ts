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
    returnType: UNIT,
    effects: ["Log"],
    doc: "Print a string to stdout followed by a newline.",
    category: "log",
  },
  {
    name: "print_int",
    params: [INT64],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Print an integer to stdout followed by a newline.",
    category: "log",
  },
  {
    name: "print_float",
    params: [FLOAT64],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Print a float to stdout followed by a newline.",
    category: "log",
  },
  {
    name: "log_info",
    params: [STRING],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Log an informational message to stderr.",
    category: "log",
  },
  {
    name: "log_warn",
    params: [STRING],
    returnType: UNIT,
    effects: ["Log"],
    doc: "Log a warning message to stderr.",
    category: "log",
  },

  // --- String operations ---
  {
    name: "string_concat",
    params: [STRING, STRING],
    returnType: STRING,
    effects: [],
    doc: "Concatenate two strings. Prefer the ++ operator for literals.",
    category: "string",
  },
  {
    name: "string_eq",
    params: [STRING, STRING],
    returnType: BOOL,
    effects: [],
    doc: "Compare two strings for equality. Returns True if equal.",
    category: "string",
  },
  {
    name: "string_length",
    params: [STRING],
    returnType: INT64,
    effects: [],
    doc: "Return the length of a string in bytes (UTF-8).",
    category: "string",
  },
  {
    name: "substring",
    params: [STRING, INT64, INT64],
    returnType: STRING,
    effects: [],
    doc: "Extract a substring from start index to end index (exclusive).",
    category: "string",
  },
  {
    name: "char_at",
    params: [STRING, INT64],
    returnType: STRING,
    effects: [],
    doc: "Return the character at the given index as a single-character string.",
    category: "string",
  },

  // --- Type conversions ---
  {
    name: "int_to_float",
    params: [INT64],
    returnType: FLOAT64,
    effects: [],
    doc: "Convert an Int64 to Float64.",
    category: "conversion",
  },
  {
    name: "float_to_int",
    params: [FLOAT64],
    returnType: INT64,
    effects: [],
    doc: "Convert a Float64 to Int64 by truncation.",
    category: "conversion",
  },
  {
    name: "int_to_string",
    params: [INT64],
    returnType: STRING,
    effects: [],
    doc: "Convert an Int64 to its decimal string representation.",
    category: "conversion",
  },
  {
    name: "float_to_string",
    params: [FLOAT64],
    returnType: STRING,
    effects: [],
    doc: "Convert a Float64 to its string representation.",
    category: "conversion",
  },
  {
    name: "string_to_int",
    params: [STRING],
    returnType: INT64,
    effects: [],
    doc: "Parse a string as Int64. Returns 0 on failure. (Proper Option<Int64> return deferred to Phase 2.)",
    category: "conversion",
  },
  {
    name: "string_to_float",
    params: [STRING],
    returnType: FLOAT64,
    effects: [],
    doc: "Parse a string as Float64. Returns 0.0 on failure. (Proper Option<Float64> return deferred to Phase 2.)",
    category: "conversion",
  },

  // --- Math builtins ---
  {
    name: "abs_int",
    params: [INT64],
    returnType: INT64,
    effects: [],
    doc: "Return the absolute value of an integer.",
    category: "math",
  },
  {
    name: "min_int",
    params: [INT64, INT64],
    returnType: INT64,
    effects: [],
    doc: "Return the smaller of two integers.",
    category: "math",
  },
  {
    name: "max_int",
    params: [INT64, INT64],
    returnType: INT64,
    effects: [],
    doc: "Return the larger of two integers.",
    category: "math",
  },
  {
    name: "sqrt",
    params: [FLOAT64],
    returnType: FLOAT64,
    effects: [],
    doc: "Return the square root of a float.",
    category: "math",
  },
  {
    name: "pow",
    params: [FLOAT64, FLOAT64],
    returnType: FLOAT64,
    effects: [],
    doc: "Return base raised to the power of exponent.",
    category: "math",
  },
  {
    name: "floor",
    params: [FLOAT64],
    returnType: FLOAT64,
    effects: [],
    doc: "Round a float down to the nearest integer value.",
    category: "math",
  },
  {
    name: "ceil",
    params: [FLOAT64],
    returnType: FLOAT64,
    effects: [],
    doc: "Round a float up to the nearest integer value.",
    category: "math",
  },

  // --- List operations (generic over element type T) ---
  {
    name: "list_length",
    params: [LIST_T],
    returnType: INT64,
    effects: [],
    doc: "Return the number of elements in a list.",
    category: "list",
  },
  {
    name: "length",
    params: [LIST_T],
    returnType: INT64,
    effects: [],
    doc: "Return the number of elements in a list (alias for list_length).",
    category: "list",
  },
  {
    name: "head",
    params: [LIST_T],
    returnType: T,
    effects: [],
    doc: "Return the first element of a list. Traps on empty list.",
    category: "list",
  },
  {
    name: "tail",
    params: [LIST_T],
    returnType: LIST_T,
    effects: [],
    doc: "Return a list without its first element.",
    category: "list",
  },
  {
    name: "append",
    params: [LIST_T, T],
    returnType: LIST_T,
    effects: [],
    doc: "Append an element to the end of a list.",
    category: "list",
  },
  {
    name: "concat",
    params: [LIST_T, LIST_T],
    returnType: LIST_T,
    effects: [],
    doc: "Concatenate two lists.",
    category: "list",
  },
  {
    name: "reverse",
    params: [LIST_T],
    returnType: LIST_T,
    effects: [],
    doc: "Reverse a list.",
    category: "list",
  },

  // --- I/O primitives (require FileSystem effect) ---
  {
    name: "read_line",
    params: [],
    returnType: STRING,
    effects: ["FileSystem"],
    doc: "Read one line from stdin (up to newline).",
    category: "io",
  },
  {
    name: "read_all_stdin",
    params: [],
    returnType: STRING,
    effects: ["FileSystem"],
    doc: "Read all remaining input from stdin.",
    category: "io",
  },
  {
    name: "read_file",
    params: [STRING],
    returnType: STRING,
    effects: ["FileSystem"],
    doc: "Read the entire contents of a file as a string.",
    category: "io",
  },
  {
    name: "write_file",
    params: [STRING, STRING],
    returnType: UNIT,
    effects: ["FileSystem"],
    doc: "Write a string to a file, replacing existing contents.",
    category: "io",
  },
  {
    name: "get_args",
    params: [],
    returnType: LIST_STRING,
    effects: ["FileSystem"],
    doc: "Return command-line arguments as a list of strings.",
    category: "io",
  },
  {
    name: "exit",
    params: [INT64],
    returnType: UNIT,
    effects: ["FileSystem"],
    doc: "Exit the process with the given status code.",
    category: "io",
  },

  // --- Test assertions (require Test effect) ---
  {
    name: "assert_eq",
    params: [INT64, INT64],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert two Int64 values are equal.",
    category: "test",
  },
  {
    name: "assert_eq_float",
    params: [FLOAT64, FLOAT64],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert two Float64 values are equal (epsilon 1e-9).",
    category: "test",
  },
  {
    name: "assert_eq_string",
    params: [STRING, STRING],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert two String values are equal.",
    category: "test",
  },
  {
    name: "assert_true",
    params: [BOOL],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert a condition is True.",
    category: "test",
  },
  {
    name: "assert_false",
    params: [BOOL],
    returnType: UNIT,
    effects: ["Test"],
    doc: "Assert a condition is False.",
    category: "test",
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
