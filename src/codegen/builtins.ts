import binaryen from "binaryen";

export interface BuiltinDef {
  name: string;
  importModule: string;
  importName: string;
  params: binaryen.Type;
  result: binaryen.Type;
}

// Built-in functions imported from the host runtime.
// These are provided as JavaScript functions when instantiating the WASM module.
export function getBuiltins(): BuiltinDef[] {
  const i32 = binaryen.i32;
  const i64 = binaryen.i64;
  const f64 = binaryen.f64;
  const none = binaryen.none;
  const pair_i32 = binaryen.createType([i32, i32]);
  const pair_i64 = binaryen.createType([i64, i64]);
  const pair_f64 = binaryen.createType([f64, f64]);
  const str_i64_i64 = binaryen.createType([i32, i64, i64]);

  return [
    // --- I/O & Logging ---
    { name: "print_string", importModule: "env", importName: "print_string", params: i32, result: none },
    { name: "print_int", importModule: "env", importName: "print_int", params: i64, result: none },
    { name: "print_float", importModule: "env", importName: "print_float", params: f64, result: none },
    { name: "log_info", importModule: "env", importName: "log_info", params: i32, result: none },
    { name: "log_warn", importModule: "env", importName: "log_warn", params: i32, result: none },

    // --- String operations ---
    { name: "string_concat", importModule: "env", importName: "string_concat", params: pair_i32, result: i32 },
    { name: "string_eq", importModule: "env", importName: "string_eq", params: pair_i32, result: i32 },
    { name: "string_length", importModule: "env", importName: "string_length", params: i32, result: i64 },
    { name: "substring", importModule: "env", importName: "substring", params: str_i64_i64, result: i32 },
    { name: "char_at", importModule: "env", importName: "char_at", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "contains", importModule: "env", importName: "contains", params: pair_i32, result: i32 },
    { name: "index_of", importModule: "env", importName: "index_of", params: pair_i32, result: i64 },
    { name: "trim", importModule: "env", importName: "trim", params: i32, result: i32 },
    { name: "split", importModule: "env", importName: "split", params: pair_i32, result: i32 },

    { name: "char_code", importModule: "env", importName: "char_code", params: i32, result: i64 },
    { name: "char_from_code", importModule: "env", importName: "char_from_code", params: i64, result: i32 },

    // --- Type conversions ---
    { name: "int_to_float", importModule: "env", importName: "int_to_float", params: i64, result: f64 },
    { name: "float_to_int", importModule: "env", importName: "float_to_int", params: f64, result: i64 },
    { name: "int_to_string", importModule: "env", importName: "int_to_string", params: i64, result: i32 },
    { name: "float_to_string", importModule: "env", importName: "float_to_string", params: f64, result: i32 },
    // string_to_int/string_to_float return Option<T> as heap-allocated union (i32 pointer).
    { name: "string_to_int", importModule: "env", importName: "string_to_int", params: i32, result: i32 },
    { name: "string_to_float", importModule: "env", importName: "string_to_float", params: i32, result: i32 },

    // --- Math builtins ---
    { name: "abs_int", importModule: "env", importName: "abs_int", params: i64, result: i64 },
    { name: "min_int", importModule: "env", importName: "min_int", params: pair_i64, result: i64 },
    { name: "max_int", importModule: "env", importName: "max_int", params: pair_i64, result: i64 },
    { name: "sqrt", importModule: "env", importName: "sqrt", params: f64, result: f64 },
    { name: "pow", importModule: "env", importName: "pow", params: pair_f64, result: f64 },
    { name: "floor", importModule: "env", importName: "floor", params: f64, result: f64 },
    { name: "ceil", importModule: "env", importName: "ceil", params: f64, result: f64 },
    { name: "f64_rem", importModule: "env", importName: "f64_rem", params: pair_f64, result: f64 },

    // --- List operations ---
    { name: "list_length", importModule: "env", importName: "list_length", params: i32, result: i64 },
    { name: "list_get_i64", importModule: "env", importName: "list_get_i64", params: binaryen.createType([i32, i64]), result: i64 },
    { name: "list_get_i32", importModule: "env", importName: "list_get_i32", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "list_head_i64", importModule: "env", importName: "list_head_i64", params: i32, result: i64 },
    { name: "list_tail", importModule: "env", importName: "list_tail", params: pair_i32, result: i32 },
    { name: "list_append_i64", importModule: "env", importName: "list_append_i64", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "list_append_i32", importModule: "env", importName: "list_append_i32", params: pair_i32, result: i32 },
    { name: "list_concat", importModule: "env", importName: "list_concat", params: binaryen.createType([i32, i32, i32]), result: i32 },
    { name: "list_reverse", importModule: "env", importName: "list_reverse", params: pair_i32, result: i32 },
    { name: "list_set_i64", importModule: "env", importName: "list_set_i64", params: str_i64_i64, result: i32 },
    { name: "list_set_i32", importModule: "env", importName: "list_set_i32", params: binaryen.createType([i32, i64, i32]), result: i32 },

    // --- Network operations ---
    // http_get/http_post return Result<String, String> as heap-allocated union pointer (i32).
    { name: "http_get", importModule: "env", importName: "http_get", params: i32, result: i32 },
    { name: "http_post", importModule: "env", importName: "http_post", params: pair_i32, result: i32 },

    // --- I/O primitives ---
    { name: "read_line", importModule: "env", importName: "read_line", params: binaryen.none, result: i32 },
    { name: "read_all_stdin", importModule: "env", importName: "read_all_stdin", params: binaryen.none, result: i32 },
    { name: "read_file", importModule: "env", importName: "read_file", params: i32, result: i32 },
    { name: "write_file", importModule: "env", importName: "write_file", params: pair_i32, result: none },
    { name: "get_args", importModule: "env", importName: "get_args", params: binaryen.none, result: i32 },
    { name: "exit", importModule: "env", importName: "exit", params: i64, result: none },

    // --- Test assertions ---
    { name: "assert_eq", importModule: "env", importName: "assert_eq", params: pair_i64, result: none },
    { name: "assert_eq_float", importModule: "env", importName: "assert_eq_float", params: pair_f64, result: none },
    { name: "assert_eq_string", importModule: "env", importName: "assert_eq_string", params: pair_i32, result: none },
    { name: "assert_true", importModule: "env", importName: "assert_true", params: i32, result: none },
    { name: "assert_false", importModule: "env", importName: "assert_false", params: i32, result: none },

    // --- Bytes operations ---
    { name: "bytes_new", importModule: "env", importName: "bytes_new", params: i64, result: i32 },
    { name: "bytes_length", importModule: "env", importName: "bytes_length", params: i32, result: i64 },
    { name: "bytes_get", importModule: "env", importName: "bytes_get", params: binaryen.createType([i32, i64]), result: i64 },
    { name: "bytes_set", importModule: "env", importName: "bytes_set", params: binaryen.createType([i32, i64, i64]), result: i32 },
    { name: "bytes_slice", importModule: "env", importName: "bytes_slice", params: binaryen.createType([i32, i64, i64]), result: i32 },
    { name: "bytes_concat", importModule: "env", importName: "bytes_concat", params: pair_i32, result: i32 },
    { name: "bytes_from_string", importModule: "env", importName: "bytes_from_string", params: i32, result: i32 },
    { name: "bytes_to_string", importModule: "env", importName: "bytes_to_string", params: i32, result: i32 },

    // --- Crypto operations ---
    { name: "sha256", importModule: "env", importName: "sha256", params: i32, result: i32 },

    // --- Map operations ---
    // Maps are opaque i32 handles. Keys: i32 (String ptr) or i64 (Int64). Values: i32 or i64.
    { name: "map_new", importModule: "env", importName: "map_new", params: binaryen.none, result: i32 },
    { name: "map_size", importModule: "env", importName: "map_size", params: i32, result: i64 },
    // String-keyed
    { name: "map_has_str", importModule: "env", importName: "map_has_str", params: pair_i32, result: i32 },
    { name: "map_get_str_i32", importModule: "env", importName: "map_get_str_i32", params: pair_i32, result: i32 },
    { name: "map_get_str_i64", importModule: "env", importName: "map_get_str_i64", params: pair_i32, result: i32 },
    { name: "map_set_str_i32", importModule: "env", importName: "map_set_str_i32", params: binaryen.createType([i32, i32, i32]), result: i32 },
    { name: "map_set_str_i64", importModule: "env", importName: "map_set_str_i64", params: binaryen.createType([i32, i32, i64]), result: i32 },
    { name: "map_remove_str", importModule: "env", importName: "map_remove_str", params: pair_i32, result: i32 },
    { name: "map_keys_str", importModule: "env", importName: "map_keys_str", params: i32, result: i32 },
    { name: "map_values_i32", importModule: "env", importName: "map_values_i32", params: i32, result: i32 },
    // Int64-keyed
    { name: "map_has_i64", importModule: "env", importName: "map_has_i64", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "map_get_i64_i32", importModule: "env", importName: "map_get_i64_i32", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "map_get_i64_i64", importModule: "env", importName: "map_get_i64_i64", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "map_set_i64_i32", importModule: "env", importName: "map_set_i64_i32", params: binaryen.createType([i32, i64, i32]), result: i32 },
    { name: "map_set_i64_i64", importModule: "env", importName: "map_set_i64_i64", params: binaryen.createType([i32, i64, i64]), result: i32 },
    { name: "map_remove_i64", importModule: "env", importName: "map_remove_i64", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "map_keys_i64", importModule: "env", importName: "map_keys_i64", params: i32, result: i32 },
    { name: "map_values_i64", importModule: "env", importName: "map_values_i64", params: i32, result: i32 },

    // --- Timestamp operations ---
    { name: "now", importModule: "env", importName: "now", params: binaryen.none, result: i64 },
    { name: "timestamp_to_string", importModule: "env", importName: "timestamp_to_string", params: i64, result: i32 },
    { name: "timestamp_to_int", importModule: "env", importName: "timestamp_to_int", params: i64, result: i64 },
    { name: "timestamp_from_int", importModule: "env", importName: "timestamp_from_int", params: i64, result: i64 },
    { name: "timestamp_add", importModule: "env", importName: "timestamp_add", params: binaryen.createType([i64, i64]), result: i64 },
    { name: "timestamp_diff", importModule: "env", importName: "timestamp_diff", params: binaryen.createType([i64, i64]), result: i64 },
  ];
}
