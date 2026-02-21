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
  { name: "Model", description: "LLM inference — call language models and list available models. Requires OPENAI_API_KEY (or compatible) environment variable." },
  { name: "Secret", description: "Read named secrets from environment variables. Prevents secrets from appearing in source code." },
  { name: "MCP", description: "Model Context Protocol — connect to MCP servers, list tools, and call tools via stdio or HTTP." },
  { name: "A2A", description: "Agent-to-Agent protocol — discover agents, submit tasks, poll status, and cancel tasks." },
  { name: "Trace", description: "Structured span tracing — start/end named spans and log events within them. Spans are written to the audit log with timing and event lists." },
  { name: "Persist", description: "Durable key-value checkpointing backed by the local filesystem (CLARITY_CHECKPOINT_DIR). Used to save and resume agent state across restarts." },
  { name: "Embed", description: "Text embedding and vector retrieval — call an embedding model and perform cosine-similarity search over a corpus. Requires OPENAI_API_KEY (or compatible)." },
  { name: "Eval", description: "LLM output evaluation — assess model responses against expected outputs or rubrics. Supports exact match, substring match, semantic similarity, and LLM-as-judge scoring." },
];

// -----------------------------------------------------------------------------
// Helper types used in definitions
// -----------------------------------------------------------------------------

const LIST_INT: ClarityType = { kind: "List", element: INT64 };
const LIST_STRING: ClarityType = { kind: "List", element: STRING };
const MAP_STRING_STRING: ClarityType = { kind: "Map", key: STRING, value: STRING };
const OPTION_STRING: ClarityType = {
  kind: "Union",
  name: "Option<String>",
  variants: [
    { name: "Some", fields: new Map([["value", STRING]]) },
    { name: "None", fields: new Map() },
  ],
};
const OPTION_MAP_STRING_STRING: ClarityType = {
  kind: "Union",
  name: "Option<Map<String, String>>",
  variants: [
    { name: "Some", fields: new Map([["value", MAP_STRING_STRING]]) },
    { name: "None", fields: new Map() },
  ],
};

// Generic type variable for polymorphic list operations
const T: ClarityType = { kind: "TypeVar", name: "T" };
const LIST_T: ClarityType = { kind: "List", element: T };

// Generic type variables for Map<K, V>
const K: ClarityType = { kind: "TypeVar", name: "K" };
const V: ClarityType = { kind: "TypeVar", name: "V" };
const MAP_KV: ClarityType = { kind: "Map", key: K, value: V };
const LIST_K: ClarityType = { kind: "List", element: K };
const LIST_V: ClarityType = { kind: "List", element: V };

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
    name: "string_starts_with",
    params: [STRING, STRING],
    paramNames: ["s", "prefix"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if s starts with prefix.",
    category: "string",
  },
  {
    name: "string_ends_with",
    params: [STRING, STRING],
    paramNames: ["s", "suffix"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if s ends with suffix.",
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
    name: "string_replace",
    params: [STRING, STRING, STRING],
    paramNames: ["s", "search", "replacement"],
    returnType: STRING,
    effects: [],
    doc: "Replace all occurrences of search in s with replacement.",
    category: "string",
  },
  {
    name: "string_repeat",
    params: [STRING, INT64],
    paramNames: ["s", "count"],
    returnType: STRING,
    effects: [],
    doc: "Repeat a string count times. Negative counts return an empty string.",
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
    name: "int_clamp",
    params: [INT64, INT64, INT64],
    paramNames: ["value", "min", "max"],
    returnType: INT64,
    effects: [],
    doc: "Clamp an integer into the inclusive range [min, max].",
    category: "math",
  },
  {
    name: "float_clamp",
    params: [FLOAT64, FLOAT64, FLOAT64],
    paramNames: ["value", "min", "max"],
    returnType: FLOAT64,
    effects: [],
    doc: "Clamp a float into the inclusive range [min, max].",
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

  // --- Random operations (require Random effect) ---
  {
    name: "random_int",
    params: [INT64, INT64],
    paramNames: ["min", "max"],
    returnType: INT64,
    effects: ["Random"],
    doc: "Return a random Int64 between min and max inclusive. If max < min, returns min.",
    category: "random",
  },
  {
    name: "random_float",
    params: [],
    paramNames: [],
    returnType: FLOAT64,
    effects: ["Random"],
    doc: "Return a random Float64 in the range [0.0, 1.0).",
    category: "random",
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


  // --- Network operations (require Network effect) ---
  {
    name: "http_get",
    params: [STRING],
    paramNames: ["url"],
    returnType: {
      kind: "Union",
      name: "Result<String, String>",
      variants: [
        { name: "Ok", fields: new Map([["value", STRING]]) },
        { name: "Err", fields: new Map([["error", STRING]]) },
      ],
    },
    effects: ["Network"],
    doc: "Perform an HTTP GET request. Returns Ok(response_body) on success or Err(message) on failure.",
    category: "network",
  },
  {
    name: "http_post",
    params: [STRING, STRING],
    paramNames: ["url", "body"],
    returnType: {
      kind: "Union",
      name: "Result<String, String>",
      variants: [
        { name: "Ok", fields: new Map([["value", STRING]]) },
        { name: "Err", fields: new Map([["error", STRING]]) },
      ],
    },
    effects: ["Network"],
    doc: "Perform an HTTP POST request with a text body. Returns Ok(response_body) on success or Err(message) on failure.",
    category: "network",
  },
  {
    name: "http_listen",
    params: [INT64],
    paramNames: ["port"],
    returnType: {
      kind: "Union",
      name: "Result<String, String>",
      variants: [
        { name: "Ok", fields: new Map([["value", STRING]]) },
        { name: "Err", fields: new Map([["error", STRING]]) },
      ],
    },
    effects: ["Network"],
    doc: "Start an HTTP server on the given port. Current runtime returns Err(not implemented).",
    category: "network",
  },

  // --- JSON object operations (phase 1 helpers) ---
  {
    name: "json_parse_object",
    params: [STRING],
    paramNames: ["json"],
    returnType: {
      kind: "Union",
      name: "Result<Map<String, String>, String>",
      variants: [
        { name: "Ok", fields: new Map([["value", { kind: "Map", key: STRING, value: STRING }]]) },
        { name: "Err", fields: new Map([["error", STRING]]) },
      ],
    },
    effects: [],
    doc: "Parse a JSON object string into Map<String, String>. Returns Err(message) on parse/type errors.",
    category: "json",
  },
  {
    name: "json_stringify_object",
    params: [{ kind: "Map", key: STRING, value: STRING }],
    paramNames: ["obj"],
    returnType: STRING,
    effects: [],
    doc: "Serialize Map<String, String> to a JSON object string.",
    category: "json",
  },

  // --- DB operations (scaffold) ---
  {
    name: "db_execute",
    params: [STRING, LIST_STRING],
    paramNames: ["sql", "params"],
    returnType: {
      kind: "Union",
      name: "Result<Int64, String>",
      variants: [
        { name: "Ok", fields: new Map([["value", INT64]]) },
        { name: "Err", fields: new Map([["error", STRING]]) },
      ],
    },
    effects: ["DB"],
    doc: "Execute a non-query SQL statement. Current runtime returns Err(not implemented).",
    category: "db",
  },
  {
    name: "db_query",
    params: [STRING, LIST_STRING],
    paramNames: ["sql", "params"],
    returnType: {
      kind: "Union",
      name: "Result<List<Map<String, String>>, String>",
      variants: [
        { name: "Ok", fields: new Map([["value", { kind: "List", element: { kind: "Map", key: STRING, value: STRING } }]]) },
        { name: "Err", fields: new Map([["error", STRING]]) },
      ],
    },
    effects: ["DB"],
    doc: "Execute a query SQL statement. Current runtime returns Err(not implemented).",
    category: "db",
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

  // --- JSON builtins ---
  {
    name: "json_parse",
    params: [STRING],
    paramNames: ["json"],
    returnType: OPTION_MAP_STRING_STRING,
    effects: [],
    doc: "Parse a flat JSON object into Some(Map<String, String>). Returns None for invalid JSON, non-object roots, or nested values.",
    category: "json",
  },
  {
    name: "json_stringify",
    params: [MAP_STRING_STRING],
    paramNames: ["obj"],
    returnType: STRING,
    effects: [],
    doc: "Serialize a Map<String, String> to JSON. Values matching JSON literals (null/true/false/number) are emitted as literals; others are emitted as strings.",
    category: "json",
  },
  {
    name: "json_get",
    params: [STRING, STRING],
    paramNames: ["json", "key"],
    returnType: OPTION_STRING,
    effects: [],
    doc: "Extract a single top-level string value from a JSON object by key. Returns Some(value) if the key exists and its value is a scalar, None otherwise. Avoids manual string arithmetic for common JSON field access.",
    category: "json",
  },

  // --- Map<K, V> operations ---
  {
    name: "map_new",
    params: [],
    paramNames: [],
    returnType: MAP_KV,
    effects: [],
    doc: "Create a new empty Map<K, V>. Annotate the binding type to specify key and value types: `let m: Map<String, String> = map_new()`.",
    category: "map",
  },
  {
    name: "map_size",
    params: [MAP_KV],
    paramNames: ["m"],
    returnType: INT64,
    effects: [],
    doc: "Return the number of key-value pairs in a map.",
    category: "map",
  },
  {
    name: "map_has",
    params: [MAP_KV, K],
    paramNames: ["m", "key"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if the map contains the given key.",
    category: "map",
  },
  {
    name: "map_get",
    params: [MAP_KV, K],
    paramNames: ["m", "key"],
    returnType: { kind: "Option", inner: V },
    effects: [],
    doc: "Return Some(value) if the key exists in the map, or None if not found.",
    category: "map",
  },
  {
    name: "map_set",
    params: [MAP_KV, K, V],
    paramNames: ["m", "key", "value"],
    returnType: MAP_KV,
    effects: [],
    doc: "Return a new map with the key-value pair added or updated.",
    category: "map",
  },
  {
    name: "map_remove",
    params: [MAP_KV, K],
    paramNames: ["m", "key"],
    returnType: MAP_KV,
    effects: [],
    doc: "Return a new map with the given key removed.",
    category: "map",
  },
  {
    name: "map_keys",
    params: [MAP_KV],
    paramNames: ["m"],
    returnType: LIST_K,
    effects: [],
    doc: "Return all keys in the map as a list (insertion order).",
    category: "map",
  },
  {
    name: "map_values",
    params: [MAP_KV],
    paramNames: ["m"],
    returnType: LIST_V,
    effects: [],
    doc: "Return all values in the map as a list (insertion order).",
    category: "map",
  },

  // --- Regex operations ---
  {
    name: "regex_match",
    params: [STRING, STRING],
    paramNames: ["pattern", "text"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if pattern matches text.",
    category: "regex",
  },
  {
    name: "regex_captures",
    params: [STRING, STRING],
    paramNames: ["pattern", "text"],
    returnType: {
      kind: "Union",
      name: "Option<List<String>>",
      variants: [
        { name: "Some", fields: new Map([["value", LIST_STRING]]) },
        { name: "None", fields: new Map() },
      ],
    },
    effects: [],
    doc: "Return Some(list) with full match and capture groups when matched, None otherwise.",
    category: "regex",
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
    name: "timestamp_parse_iso",
    params: [STRING],
    paramNames: ["s"],
    returnType: {
      kind: "Union",
      name: "Option<Timestamp>",
      variants: [
        { name: "Some", fields: new Map([["value", TIMESTAMP]]) },
        { name: "None", fields: new Map() },
      ],
    },
    effects: [],
    doc: "Parse an ISO-8601 string into a Timestamp. Returns Some(timestamp) on success, None on failure.",
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

  // --- Memory management ---
  {
    name: "arena_save",
    params: [],
    paramNames: [],
    returnType: INT64,
    effects: [],
    doc: "Save the current heap watermark and return it as an Int64. Pass the returned value to arena_restore() to reclaim all memory allocated since this call. Programs that repeatedly process data should save a mark before each unit of work and restore it when done to prevent unbounded heap growth.",
    category: "memory",
  },
  {
    name: "arena_restore",
    params: [INT64],
    paramNames: ["mark"],
    returnType: UNIT,
    effects: [],
    doc: "Reclaim all heap memory allocated since the matching arena_save() call. Any pointer (string, list, record, etc.) obtained after the saved mark becomes invalid after this call — do not use such pointers afterwards.",
    category: "memory",
  },
  {
    name: "memory_stats",
    params: [],
    paramNames: [],
    returnType: STRING,
    effects: [],
    doc: "Return a JSON string with current allocator statistics: heap_ptr (current top of heap), live_allocs (number of tracked live blocks), free_blocks (blocks available for reuse), interned_strings (number of cached string allocations). Useful for profiling and debugging memory usage.",
    category: "memory",
  },

  // --- Secret operations (require Secret effect) ---
  {
    name: "get_secret",
    params: [STRING],
    paramNames: ["name"],
    returnType: {
      kind: "Union",
      name: "Option<String>",
      variants: [
        { name: "Some", fields: new Map([["value", STRING]]) },
        { name: "None", fields: new Map() },
      ],
    } as ClarityType,
    effects: ["Secret"],
    doc: "Read a named secret from environment variables. Returns Some(value) if the variable is set, None if not. Use this for API keys and credentials instead of hard-coding them. Example: get_secret(\"OPENAI_API_KEY\").",
    category: "secret",
  },

  // --- Model operations (require Model effect) ---
  {
    name: "call_model",
    params: [STRING, STRING],
    paramNames: ["model", "prompt"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["Model"],
    doc: "Call a language model with a user prompt. Returns Ok(response) on success or Err(message) on failure. The model name should be an OpenAI-compatible model identifier (e.g. \"gpt-4o\", \"gpt-4o-mini\"). Requires OPENAI_API_KEY (and optionally OPENAI_BASE_URL) environment variables.",
    category: "model",
  },
  {
    name: "call_model_system",
    params: [STRING, STRING, STRING],
    paramNames: ["model", "system_prompt", "user_prompt"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["Model"],
    doc: "Call a language model with separate system and user prompts. Returns Ok(response) on success or Err(message) on failure. The system prompt sets the model's behavior/persona. Requires OPENAI_API_KEY environment variable.",
    category: "model",
  },
  {
    name: "list_models",
    params: [],
    paramNames: [],
    returnType: LIST_STRING,
    effects: ["Model"],
    doc: "List available model identifiers from the configured LLM provider. Returns an empty list on failure. Requires OPENAI_API_KEY environment variable.",
    category: "model",
  },

  // --- MCP operations (require MCP effect) ---
  {
    name: "mcp_connect",
    params: [STRING],
    paramNames: ["url"],
    returnType: { kind: "Result", ok: INT64, err: STRING } as ClarityType,
    effects: ["MCP"],
    doc: "Register an MCP server HTTP endpoint. Returns an opaque session handle (Int64) on success, or Err(message) if the URL is unreachable. Use the session handle with mcp_list_tools and mcp_call_tool. Example: mcp_connect(\"http://localhost:3000/mcp\").",
    category: "mcp",
  },
  {
    name: "mcp_list_tools",
    params: [INT64],
    paramNames: ["session"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["MCP"],
    doc: "List tools available in an MCP session. Returns a JSON string containing the array of tool descriptors on success. Parse with json_parse or inspect manually.",
    category: "mcp",
  },
  {
    name: "mcp_call_tool",
    params: [INT64, STRING, STRING],
    paramNames: ["session", "tool", "args_json"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["MCP"],
    doc: "Call an MCP tool by name with JSON-encoded arguments. `args_json` must be a JSON object string, e.g. \"{\\\"path\\\":\\\"/tmp/foo\\\"}\". Returns the tool output as a string. Example: mcp_call_tool(session, \"read_file\", \"{\\\"path\\\":\\\"/etc/hosts\\\"}\").",
    category: "mcp",
  },
  {
    name: "mcp_disconnect",
    params: [INT64],
    paramNames: ["session"],
    returnType: UNIT,
    effects: ["MCP"],
    doc: "Close an MCP session and release its resources. Safe to call even if the session was already closed.",
    category: "mcp",
  },

  // --- A2A operations (require A2A effect) ---
  {
    name: "a2a_discover",
    params: [STRING],
    paramNames: ["url"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["A2A"],
    doc: "Fetch the agent card from an A2A-compatible agent at the given base URL. Returns Ok(agent_card_json) on success. The agent card describes the agent's capabilities, name, and supported skills. Example: a2a_discover(\"http://localhost:8080\").",
    category: "a2a",
  },
  {
    name: "a2a_submit",
    params: [STRING, STRING],
    paramNames: ["url", "message"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["A2A"],
    doc: "Submit a text message as a task to an A2A agent. Returns Ok(task_id) on success. The task_id can be used with a2a_poll and a2a_cancel. Example: a2a_submit(\"http://localhost:8080\", \"Summarise this text: ...\").",
    category: "a2a",
  },
  {
    name: "a2a_poll",
    params: [STRING, STRING],
    paramNames: ["url", "task_id"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["A2A"],
    doc: "Poll for the status of an A2A task. Returns Ok(status_json) containing a 'status' field (\"submitted\", \"working\", \"completed\", \"failed\", \"canceled\") and, when completed, an 'output' field with the agent's response text.",
    category: "a2a",
  },
  {
    name: "a2a_cancel",
    params: [STRING, STRING],
    paramNames: ["url", "task_id"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["A2A"],
    doc: "Cancel a running A2A task. Returns Ok(status_json) with the final task state, or Err if the task could not be cancelled (e.g. already completed).",
    category: "a2a",
  },

  // --- Trace operations (require Trace effect) ---
  {
    name: "trace_start",
    params: [STRING],
    paramNames: ["op"],
    returnType: INT64,
    effects: ["Trace"],
    doc: "Start a new trace span with the given operation name. Returns an opaque span ID (Int64) that must be passed to trace_end and trace_log. Example: let id = trace_start(\"embed_query\").",
    category: "trace",
  },
  {
    name: "trace_end",
    params: [INT64],
    paramNames: ["span_id"],
    returnType: UNIT,
    effects: ["Trace"],
    doc: "End the span identified by span_id and flush it to the audit log (CLARITY_AUDIT_LOG) with its duration and any logged events. Calling trace_end on an unknown span is a no-op.",
    category: "trace",
  },
  {
    name: "trace_log",
    params: [INT64, STRING],
    paramNames: ["span_id", "message"],
    returnType: UNIT,
    effects: ["Trace"],
    doc: "Append a timestamped message to the span identified by span_id. Messages appear in the audit log entry when trace_end is called. Example: trace_log(id, \"retrieved 5 chunks\").",
    category: "trace",
  },

  // --- Persist operations (require Persist effect) ---
  {
    name: "checkpoint_save",
    params: [STRING, STRING],
    paramNames: ["key", "value"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["Persist"],
    doc: "Save a string value under the given key. The value is written to CLARITY_CHECKPOINT_DIR (default .clarity-checkpoints/). Returns Ok(\"\") on success or Err(message) on failure. Example: checkpoint_save(\"agent/step\", state_json).",
    category: "persist",
  },
  {
    name: "checkpoint_load",
    params: [STRING],
    paramNames: ["key"],
    returnType: OPTION_STRING,
    effects: ["Persist"],
    doc: "Load a previously saved checkpoint by key. Returns Some(value) if the key exists, None if it has never been saved or was deleted. Example: let saved = checkpoint_load(\"agent/step\").",
    category: "persist",
  },
  {
    name: "checkpoint_delete",
    params: [STRING],
    paramNames: ["key"],
    returnType: UNIT,
    effects: ["Persist"],
    doc: "Delete the checkpoint stored under the given key. Safe to call if the key does not exist. Example: checkpoint_delete(\"agent/step\").",
    category: "persist",
  },

  // --- Embed operations (require Embed effect, except pure computation builtins) ---
  {
    name: "embed_text",
    params: [STRING],
    paramNames: ["text"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["Embed"],
    doc: "Embed a text string using the configured embedding model (CLARITY_EMBED_MODEL, default text-embedding-ada-002) via OPENAI_BASE_URL/v1/embeddings. Returns Ok(json_float_array) or Err(message). The JSON array can be passed to cosine_similarity or embed_and_retrieve.",
    category: "embed",
  },
  {
    name: "cosine_similarity",
    params: [STRING, STRING],
    paramNames: ["a_json", "b_json"],
    returnType: FLOAT64,
    effects: [],
    doc: "Compute the cosine similarity between two embedding vectors represented as JSON float arrays (as returned by embed_text). Returns a value in [0.0, 1.0]. Pure computation — no network call. Example: cosine_similarity(vec_a, vec_b).",
    category: "embed",
  },
  {
    name: "chunk_text",
    params: [STRING, INT64],
    paramNames: ["text", "chunk_size"],
    returnType: STRING,
    effects: [],
    doc: "Split text into non-overlapping chunks of approximately chunk_size characters. Returns a JSON array of strings. Pure computation. Example: chunk_text(document, 512).",
    category: "embed",
  },
  {
    name: "embed_and_retrieve",
    params: [STRING, STRING, INT64],
    paramNames: ["query", "chunks_json", "top_k"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["Embed"],
    doc: "Embed the query and all chunks in chunks_json (a JSON string array), rank chunks by cosine similarity to the query, and return the top_k most relevant chunks as a JSON string array. Example: embed_and_retrieve(query, chunk_text(doc, 512), 5).",
    category: "embed",
  },

  // --- Eval operations ---
  {
    name: "eval_exact",
    params: [STRING, STRING],
    paramNames: ["got", "expected"],
    returnType: BOOL,
    effects: [],
    doc: "Exact string equality check. Returns True when got == expected. Pure — no effect required. Example: eval_exact(response, \"Paris\").",
    category: "eval",
  },
  {
    name: "eval_contains",
    params: [STRING, STRING],
    paramNames: ["got", "expected"],
    returnType: BOOL,
    effects: [],
    doc: "Substring check. Returns True when got contains expected as a substring. Case-sensitive. Pure — no effect required. Example: eval_contains(response, \"France\").",
    category: "eval",
  },
  {
    name: "eval_llm_judge",
    params: [STRING, STRING, STRING, STRING],
    paramNames: ["model", "prompt", "response", "rubric"],
    returnType: { kind: "Result", ok: STRING, err: STRING } as ClarityType,
    effects: ["Eval"],
    doc: "Ask a language model to judge a response against a rubric. Returns Ok(json) where json contains {\"score\": 0.0-1.0, \"pass\": true/false, \"reason\": \"...\"}. model is the judge model name, prompt is the original prompt given to the model under test, response is what it returned, rubric describes the evaluation criteria. Example: eval_llm_judge(\"gpt-4o\", prompt, response, \"Answer must name the capital of France.\").",
    category: "eval",
  },
  {
    name: "eval_semantic",
    params: [STRING, STRING],
    paramNames: ["got", "expected"],
    returnType: { kind: "Result", ok: FLOAT64, err: STRING } as ClarityType,
    effects: ["Eval"],
    doc: "Measure semantic similarity between two strings using text embeddings. Embeds both strings and returns Ok(cosine_similarity) in [0.0, 1.0]. A value above ~0.85 typically indicates semantic equivalence. Requires OPENAI_API_KEY. Example: eval_semantic(response, \"The capital of France is Paris.\").",
    category: "eval",
  },

  // --- Policy introspection (no effect required) ---
  {
    name: "policy_is_url_allowed",
    params: [STRING],
    paramNames: ["url"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if the given URL is permitted by the runtime policy allowlist (CLARITY_ALLOW_HOSTS env var). Returns True when no allowlist is configured. Use this to proactively check access before connecting. Example: policy_is_url_allowed(\"http://api.example.com\").",
    category: "policy",
  },
  {
    name: "policy_is_effect_allowed",
    params: [STRING],
    paramNames: ["effect_name"],
    returnType: BOOL,
    effects: [],
    doc: "Return True if the given effect family is not blocked by the policy deny list (CLARITY_DENY_EFFECTS env var). Returns True when no deny list is configured. Example: policy_is_effect_allowed(\"MCP\").",
    category: "policy",
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
