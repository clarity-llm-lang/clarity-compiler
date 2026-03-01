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
    { name: "print_stderr", importModule: "env", importName: "print_stderr", params: i32, result: none },

    // --- String operations ---
    { name: "string_concat", importModule: "env", importName: "string_concat", params: pair_i32, result: i32 },
    { name: "string_eq", importModule: "env", importName: "string_eq", params: pair_i32, result: i32 },
    { name: "string_length", importModule: "env", importName: "string_length", params: i32, result: i64 },
    { name: "substring", importModule: "env", importName: "substring", params: str_i64_i64, result: i32 },
    { name: "char_at", importModule: "env", importName: "char_at", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "contains", importModule: "env", importName: "contains", params: pair_i32, result: i32 },
    { name: "string_starts_with", importModule: "env", importName: "string_starts_with", params: pair_i32, result: i32 },
    { name: "string_ends_with", importModule: "env", importName: "string_ends_with", params: pair_i32, result: i32 },
    { name: "index_of", importModule: "env", importName: "index_of", params: pair_i32, result: i64 },
    { name: "trim", importModule: "env", importName: "trim", params: i32, result: i32 },
    { name: "split", importModule: "env", importName: "split", params: pair_i32, result: i32 },
    { name: "string_replace", importModule: "env", importName: "string_replace", params: binaryen.createType([i32, i32, i32]), result: i32 },
    { name: "string_repeat", importModule: "env", importName: "string_repeat", params: binaryen.createType([i32, i64]), result: i32 },

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
    { name: "int_clamp", importModule: "env", importName: "int_clamp", params: binaryen.createType([i64, i64, i64]), result: i64 },
    { name: "float_clamp", importModule: "env", importName: "float_clamp", params: binaryen.createType([f64, f64, f64]), result: f64 },
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

    // --- Random operations ---
    { name: "random_int", importModule: "env", importName: "random_int", params: pair_i64, result: i64 },
    { name: "random_float", importModule: "env", importName: "random_float", params: binaryen.none, result: f64 },

    // --- Network operations ---
    // http_get/http_post return Result<String, String> as heap-allocated union pointer (i32).
    { name: "http_request", importModule: "env", importName: "http_request", params: binaryen.createType([i32, i32, i32, i32]), result: i32 },
    { name: "http_request_full", importModule: "env", importName: "http_request_full", params: binaryen.createType([i32, i32, i32, i32]), result: i32 },
    { name: "http_get", importModule: "env", importName: "http_get", params: i32, result: i32 },
    { name: "http_post", importModule: "env", importName: "http_post", params: pair_i32, result: i32 },

    // --- JSON helpers ---
    { name: "json_parse_object", importModule: "env", importName: "json_parse_object", params: i32, result: i32 },
    { name: "json_stringify_object", importModule: "env", importName: "json_stringify_object", params: i32, result: i32 },

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

    // --- JSON operations ---
    { name: "json_parse", importModule: "env", importName: "json_parse", params: i32, result: i32 },
    { name: "json_stringify", importModule: "env", importName: "json_stringify", params: i32, result: i32 },
    { name: "json_get", importModule: "env", importName: "json_get", params: pair_i32, result: i32 },
    { name: "json_get_path", importModule: "env", importName: "json_get_path", params: pair_i32, result: i32 },
    { name: "json_get_nested", importModule: "env", importName: "json_get_nested", params: pair_i32, result: i32 },
    { name: "json_array_length", importModule: "env", importName: "json_array_length", params: i32, result: i32 },
    { name: "json_array_get", importModule: "env", importName: "json_array_get", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "json_keys", importModule: "env", importName: "json_keys", params: i32, result: i32 },
    { name: "json_escape_string", importModule: "env", importName: "json_escape_string", params: i32, result: i32 },

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

    // --- Regex operations ---
    { name: "regex_match", importModule: "env", importName: "regex_match", params: pair_i32, result: i32 },
    { name: "regex_captures", importModule: "env", importName: "regex_captures", params: pair_i32, result: i32 },

    // --- Memory management ---
    // arena_save() returns the current heap watermark so it can be passed to arena_restore().
    { name: "arena_save", importModule: "env", importName: "arena_save", params: none, result: i64 },
    // arena_restore(mark) reclaims all heap memory allocated since arena_save() was called.
    // Pointers into the freed region must not be used after this call.
    { name: "arena_restore", importModule: "env", importName: "arena_restore", params: i64, result: none },
    // arena_restore_keeping_str(mark, str) — copy str below mark, restore arena, return new str ptr.
    { name: "arena_restore_keeping_str", importModule: "env", importName: "arena_restore_keeping_str", params: binaryen.createType([i64, i32]), result: i32 },
    // memory_stats() returns a JSON string with current allocator statistics (debugging aid).
    { name: "memory_stats", importModule: "env", importName: "memory_stats", params: none, result: i32 },

    // --- Secret operations ---
    { name: "get_secret", importModule: "env", importName: "get_secret", params: i32, result: i32 },

    // --- Model operations ---
    // call_model(model, prompt) → Result<String, String> as i32 pointer
    { name: "call_model", importModule: "env", importName: "call_model", params: pair_i32, result: i32 },
    // call_model_system(model, system_prompt, user_prompt) → Result<String, String> as i32 pointer
    { name: "call_model_system", importModule: "env", importName: "call_model_system", params: binaryen.createType([i32, i32, i32]), result: i32 },
    // list_models() → List<String> as i32 pointer
    { name: "list_models", importModule: "env", importName: "list_models", params: none, result: i32 },
    // stream_start(model, prompt, system) → Result<Int64, String> as i32 pointer
    { name: "stream_start", importModule: "env", importName: "stream_start", params: binaryen.createType([i32, i32, i32]), result: i32 },
    // stream_next(handle: i64) → Option<String> as i32 pointer
    { name: "stream_next", importModule: "env", importName: "stream_next", params: i64, result: i32 },
    // stream_close(handle: i64) → String as i32 pointer (empty = ok, non-empty = error)
    { name: "stream_close", importModule: "env", importName: "stream_close", params: i64, result: i32 },

    // --- SSE client ---
    // sse_connect(url, headers_json) → Result<Int64, String> as i32 pointer
    { name: "sse_connect", importModule: "env", importName: "sse_connect", params: binaryen.createType([i32, i32]), result: i32 },
    // sse_next_event(handle: i64) → Option<String> as i32 pointer
    { name: "sse_next_event", importModule: "env", importName: "sse_next_event", params: i64, result: i32 },
    // sse_close(handle: i64) → void
    { name: "sse_close", importModule: "env", importName: "sse_close", params: i64, result: none },
    // sse_next_event_timeout(handle: i64, timeout_ms: i64) → Option<String> as i32 pointer
    { name: "sse_next_event_timeout", importModule: "env", importName: "sse_next_event_timeout", params: binaryen.createType([i64, i64]), result: i32 },
    // stdin_try_read(timeout_ms: i64) → Option<String> as i32 pointer
    { name: "stdin_try_read", importModule: "env", importName: "stdin_try_read", params: i64, result: i32 },
    // url_encode(s) → String as i32 pointer
    { name: "url_encode", importModule: "env", importName: "url_encode", params: i32, result: i32 },
    // url_decode(s) → String as i32 pointer
    { name: "url_decode", importModule: "env", importName: "url_decode", params: i32, result: i32 },

    // --- MCP operations ---
    // mcp_connect(url) → Result<Int64, String> as i32 pointer
    { name: "mcp_connect", importModule: "env", importName: "mcp_connect", params: i32, result: i32 },
    // mcp_list_tools(session_id) → Result<String, String> as i32 pointer
    { name: "mcp_list_tools", importModule: "env", importName: "mcp_list_tools", params: i64, result: i32 },
    // mcp_call_tool(session_id, tool_name, args_json) → Result<String, String> as i32 pointer
    { name: "mcp_call_tool", importModule: "env", importName: "mcp_call_tool", params: binaryen.createType([i64, i32, i32]), result: i32 },
    // mcp_disconnect(session_id) → Unit
    { name: "mcp_disconnect", importModule: "env", importName: "mcp_disconnect", params: i64, result: none },

    // --- A2A operations ---
    // a2a_discover(url) → Result<String, String> as i32 pointer
    { name: "a2a_discover", importModule: "env", importName: "a2a_discover", params: i32, result: i32 },
    // a2a_submit(url, message) → Result<String, String> as i32 pointer
    { name: "a2a_submit", importModule: "env", importName: "a2a_submit", params: pair_i32, result: i32 },
    // a2a_poll(url, task_id) → Result<String, String> as i32 pointer
    { name: "a2a_poll", importModule: "env", importName: "a2a_poll", params: pair_i32, result: i32 },
    // a2a_cancel(url, task_id) → Result<String, String> as i32 pointer
    { name: "a2a_cancel", importModule: "env", importName: "a2a_cancel", params: pair_i32, result: i32 },

    // --- Trace operations ---
    { name: "trace_start", importModule: "env", importName: "trace_start", params: i32, result: i64 },
    { name: "trace_end", importModule: "env", importName: "trace_end", params: i64, result: none },
    { name: "trace_log", importModule: "env", importName: "trace_log", params: binaryen.createType([i64, i32]), result: none },

    // --- Persist operations ---
    { name: "checkpoint_save", importModule: "env", importName: "checkpoint_save", params: pair_i32, result: i32 },
    { name: "checkpoint_load", importModule: "env", importName: "checkpoint_load", params: i32, result: i32 },
    { name: "checkpoint_delete", importModule: "env", importName: "checkpoint_delete", params: i32, result: none },
    // checkpoint_save_raw(key, value) → Bool (i32: 1=ok, 0=error) — no heap allocation, safe before arena_restore
    { name: "checkpoint_save_raw", importModule: "env", importName: "checkpoint_save_raw", params: pair_i32, result: i32 },

    // --- HumanInLoop operations ---
    // hitl_ask(key, question) → String (i32 ptr) — blocks until human writes answer file
    { name: "hitl_ask", importModule: "env", importName: "hitl_ask", params: pair_i32, result: i32 },

    // --- Embed operations ---
    { name: "embed_text", importModule: "env", importName: "embed_text", params: i32, result: i32 },
    { name: "cosine_similarity", importModule: "env", importName: "cosine_similarity", params: pair_i32, result: f64 },
    { name: "chunk_text", importModule: "env", importName: "chunk_text", params: binaryen.createType([i32, i64]), result: i32 },
    { name: "embed_and_retrieve", importModule: "env", importName: "embed_and_retrieve", params: binaryen.createType([i32, i32, i64]), result: i32 },

    // --- Eval operations ---
    // eval_exact(got, expected) → Bool (i32)
    { name: "eval_exact", importModule: "env", importName: "eval_exact", params: pair_i32, result: i32 },
    // eval_contains(got, expected) → Bool (i32)
    { name: "eval_contains", importModule: "env", importName: "eval_contains", params: pair_i32, result: i32 },
    // eval_llm_judge(model, prompt, response, rubric) → Result<String,String> (i32)
    { name: "eval_llm_judge", importModule: "env", importName: "eval_llm_judge", params: binaryen.createType([i32, i32, i32, i32]), result: i32 },
    // eval_semantic(got, expected) → Result<Float64,String> (i32)
    { name: "eval_semantic", importModule: "env", importName: "eval_semantic", params: pair_i32, result: i32 },

    // --- Policy introspection ---
    // policy_is_url_allowed(url) → Bool (i32: 1=allowed, 0=denied)
    { name: "policy_is_url_allowed", importModule: "env", importName: "policy_is_url_allowed", params: i32, result: i32 },
    // policy_is_effect_allowed(effect_name) → Bool (i32: 1=allowed, 0=denied)
    { name: "policy_is_effect_allowed", importModule: "env", importName: "policy_is_effect_allowed", params: i32, result: i32 },

    // --- Timestamp operations ---
    { name: "sleep", importModule: "env", importName: "sleep", params: i64, result: none },
    { name: "now", importModule: "env", importName: "now", params: binaryen.none, result: i64 },
    { name: "timestamp_to_string", importModule: "env", importName: "timestamp_to_string", params: i64, result: i32 },
    { name: "timestamp_to_int", importModule: "env", importName: "timestamp_to_int", params: i64, result: i64 },
    { name: "timestamp_from_int", importModule: "env", importName: "timestamp_from_int", params: i64, result: i64 },
    { name: "timestamp_parse_iso", importModule: "env", importName: "timestamp_parse_iso", params: i32, result: i32 },
    { name: "timestamp_add", importModule: "env", importName: "timestamp_add", params: binaryen.createType([i64, i64]), result: i64 },
    { name: "timestamp_diff", importModule: "env", importName: "timestamp_diff", params: binaryen.createType([i64, i64]), result: i64 },
  ];
}
