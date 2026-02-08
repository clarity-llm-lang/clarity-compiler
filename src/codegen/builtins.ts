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

    // --- Type conversions ---
    { name: "int_to_float", importModule: "env", importName: "int_to_float", params: i64, result: f64 },
    { name: "float_to_int", importModule: "env", importName: "float_to_int", params: f64, result: i64 },
    { name: "int_to_string", importModule: "env", importName: "int_to_string", params: i64, result: i32 },
    { name: "float_to_string", importModule: "env", importName: "float_to_string", params: f64, result: i32 },
    // string_to_int/string_to_float return raw values (0 on failure).
    // Proper Option<T> return requires generics (Phase 2).
    { name: "string_to_int", importModule: "env", importName: "string_to_int", params: i32, result: i64 },
    { name: "string_to_float", importModule: "env", importName: "string_to_float", params: i32, result: f64 },

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
    { name: "list_concat", importModule: "env", importName: "list_concat", params: binaryen.createType([i32, i32, i32]), result: i32 },
    { name: "list_reverse", importModule: "env", importName: "list_reverse", params: pair_i32, result: i32 },

    // --- Test assertions ---
    { name: "assert_eq", importModule: "env", importName: "assert_eq", params: pair_i64, result: none },
    { name: "assert_eq_float", importModule: "env", importName: "assert_eq_float", params: pair_f64, result: none },
    { name: "assert_eq_string", importModule: "env", importName: "assert_eq_string", params: pair_i32, result: none },
    { name: "assert_true", importModule: "env", importName: "assert_true", params: i32, result: none },
    { name: "assert_false", importModule: "env", importName: "assert_false", params: i32, result: none },
  ];
}
