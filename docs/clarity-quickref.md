# Clarity Quick Reference

Compact syntax reference for writing Clarity code. For the full spec see `language-spec.md`.
For the complete list of built-in functions, run: `npx clarityc introspect --builtins`

## Module declaration
Every file starts with:
```
module ModuleName
```

## Imports and exports
```
import { add, User } from "math"           // imports math.clarity from same directory
import { abs, clamp } from "std/math"      // standard library import
import { length, repeat, join, starts_with, json_escape } from "std/string"
import { size, first, push } from "std/list"
import { prompt, is_ok } from "std/llm"    // LLM interop
import { get, post_json, request } from "std/http" // HTTP client
import { connect, call_tool } from "std/mcp" // MCP tool servers
import { submit, poll, is_done } from "std/a2a" // A2A agents
import { run, resume, clear } from "std/agent" // resumable agent loops
import { retrieve, chunk, similarity } from "std/rag" // RAG pipelines
export function add(a: Int64, b: Int64) -> Int64 { a + b }
export type Color = | Red | Green | Blue
```

## Types
```
// Primitives: Int64, Float64, String, Bool, Unit
// Generic built-ins: List<T>, Option<T> (Some/None), Result<T, E> (Ok/Err), Map<K, V>

// Records
type User = { id: Int64, email: String }

// Unions (tagged sum types)
type Shape =
  | Circle(radius: Float64)
  | Rect(w: Float64, h: Float64)

// Type aliases (transparent)
type UserId = Int64
```

## Functions
```
// Pure (no side effects)
function add(a: Int64, b: Int64) -> Int64 { a + b }

// Effectful — must declare effects
effect[DB, Log] function save(name: String) -> Int64 { ... }

// Generic
function identity<T>(x: T) -> T { x }

// Higher-order (named functions only, no lambdas)
function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
```

**All known effects:**
`DB`, `Network`, `Time`, `Random`, `Log`, `FileSystem`, `Test`,
`Model`, `Secret`, `MCP`, `A2A`, `Trace`, `Persist`, `Embed`, `Eval`

## Control flow — match only (no if/else, no loops)
```
// Boolean
match n >= 0 { True -> n, False -> 0 - n }

// Union (must be exhaustive)
match shape {
  Circle(r) -> 3.14 * r * r,
  Rect(w, h) -> w * h
}

// Option / Result
match opt { Some(v) -> v, None -> 0 }
match res { Ok(v) -> v, Err(e) -> 0 }

// Pattern guards
match n { x if x > 100 -> "large", x if x > 0 -> "small", _ -> "other" }

// Range patterns (Int64, inclusive)
match score { 90..100 -> "A", 80..89 -> "B", _ -> "F" }
```

Use recursion instead of loops (tail calls are optimized to loops).

## Let bindings
```
let a = 1;           // immutable
let mut b = 2;       // mutable
b = b + 1;           // reassignment (let mut only)
a + b                // last expression = return value
```

## Operators
- Arithmetic: `+` `-` `*` `/` `%`
- String concat: `++`
- Comparison: `==` `!=` `<` `>` `<=` `>=`
- Logical: `and` `or` `!`
- No operator overloading. No implicit conversions.

## Common builtins

| Function | Signature | Effect |
|----------|-----------|--------|
| `print_string(s)` | `String -> Unit` | Log |
| `print_int(n)` | `Int64 -> Unit` | Log |
| `read_line()` | `-> String` | FileSystem |
| `read_all_stdin()` | `-> String` | FileSystem |
| `read_file(path)` | `String -> String` | FileSystem |
| `write_file(path, content)` | `String, String -> Unit` | FileSystem |
| `get_args()` | `-> List<String>` | FileSystem |
| `exit(code)` | `Int64 -> Unit` | FileSystem |
| `int_to_string(n)` | `Int64 -> String` | — |
| `string_length(s)` | `String -> Int64` | — |
| `substring(s, start, end)` | `String, Int64, Int64 -> String` | — |
| `contains(s, sub)` | `String, String -> Bool` | — |
| `index_of(s, sub)` | `String, String -> Int64` | — |
| `char_code(s)` | `String -> Int64` | — |
| `char_from_code(code)` | `Int64 -> String` | — |
| `head(list)` | `List<T> -> T` | — |
| `tail(list)` | `List<T> -> List<T>` | — |
| `append(list, elem)` | `List<T>, T -> List<T>` | — |
| `length(list)` | `List<T> -> Int64` | — |
| `nth(list, index)` | `List<T>, Int64 -> T` | — |
| `reverse(list)` | `List<T> -> List<T>` | — |
| `concat(a, b)` | `List<T>, List<T> -> List<T>` | — |
| `is_empty(list)` | `List<T> -> Bool` | — |
| `map_new()` | `-> Map<K, V>` (annotate type) | — |
| `map_get(m, key)` | `Map<K,V>, K -> Option<V>` | — |
| `map_set(m, key, val)` | `Map<K,V>, K, V -> Map<K,V>` | — |
| `map_remove(m, key)` | `Map<K,V>, K -> Map<K,V>` | — |
| `map_has(m, key)` | `Map<K,V>, K -> Bool` | — |
| `map_keys(m)` | `Map<K,V> -> List<K>` | — |
| `json_parse(s)` | `String -> Option<Map<String, String>>` | — |
| `json_stringify(m)` | `Map<String, String> -> String` | — |
| `json_get(json, key)` | `String, String -> Option<String>` | top-level key access |
| `json_get_nested(json, path)` | `String, String -> Option<String>` | dot-path: `"user.name"`, `"items.0.id"` |
| `json_array_length(json)` | `String -> Option<Int64>` | length of JSON array |
| `json_array_get(json, index)` | `String, Int64 -> Option<String>` | element at index |
| `json_keys(json)` | `String -> Option<List<String>>` | top-level object keys |
| `json_escape_string(s)` | `String -> String` | escape for JSON embedding (no surrounding quotes) |
| `print_stderr(s)` | `String -> Unit` | Log; write to stderr without prefix |
| `sleep(ms)` | `Int64 -> Unit` | Time; synchronous delay, useful for polling loops |
| `http_get(url)` | `String -> Result<String, String>` | Network |
| `http_post(url, body)` | `String, String -> Result<String, String>` | Network |
| `http_request(method, url, headers_json, body)` | `String, String, String, String -> Result<String, String>` | Network; generic HTTP |
| `http_request_full(method, url, headers_json, body)` | `String, String, String, String -> Result<String, String>` | Network; returns `{"status":N,"body":"..."}` |
| `now()` | `-> Timestamp` | Time |
| `get_secret(name)` | `String -> Option<String>` | Secret |

## AI / Agent builtins

### LLM (Model effect)

| Function | Signature | Notes |
|----------|-----------|-------|
| `call_model(model, prompt)` | `String, String -> Result<String, String>` | OpenAI-compatible |
| `call_model_system(model, system, prompt)` | `String, String, String -> Result<String, String>` | With system prompt |
| `list_models()` | `-> List<String>` | Lists provider models |

Set `OPENAI_API_KEY` / `OPENAI_BASE_URL` for OpenAI-compatible endpoints (Ollama, Groq, etc.).
For Anthropic models (`claude-*`), set `ANTHROPIC_API_KEY` instead.

### MCP (MCP effect)

| Function | Signature | Notes |
|----------|-----------|-------|
| `mcp_connect(url)` | `String -> Result<Int64, String>` | Returns session handle |
| `mcp_list_tools(session)` | `Int64 -> Result<String, String>` | JSON tool array |
| `mcp_call_tool(session, tool, args_json)` | `Int64, String, String -> Result<String, String>` | `args_json` is a JSON object |
| `mcp_disconnect(session)` | `Int64 -> Unit` | Release session |

### A2A (A2A effect)

| Function | Signature | Notes |
|----------|-----------|-------|
| `a2a_discover(url)` | `String -> Result<String, String>` | Agent card JSON |
| `a2a_submit(url, message)` | `String, String -> Result<String, String>` | Returns task_id |
| `a2a_poll(url, task_id)` | `String, String -> Result<String, String>` | Status JSON |
| `a2a_cancel(url, task_id)` | `String, String -> Result<String, String>` | Final status JSON |

`a2a_poll` status JSON: `{ "id": "...", "status": "working|completed|failed|canceled", "output": "..." }`

### Trace (Trace effect)

| Function | Signature | Notes |
|----------|-----------|-------|
| `trace_start(op)` | `String -> Int64` | Start a span; returns span_id |
| `trace_end(span_id)` | `Int64 -> Unit` | End span; writes to audit log with duration |
| `trace_log(span_id, msg)` | `Int64, String -> Unit` | Attach an event to a span |

### Persist (Persist effect)

| Function | Signature | Notes |
|----------|-----------|-------|
| `checkpoint_save(key, value)` | `String, String -> Result<String, String>` | Save state; backed by `CLARITY_CHECKPOINT_DIR` |
| `checkpoint_load(key)` | `String -> Option<String>` | Load state; `None` if no checkpoint |
| `checkpoint_delete(key)` | `String -> Unit` | Delete checkpoint |

### Embed (Embed effect for network calls; pure for computation)

| Function | Signature | Effect | Notes |
|----------|-----------|--------|-------|
| `embed_text(text)` | `String -> Result<String, String>` | Embed | Calls `/v1/embeddings`; returns JSON float array |
| `cosine_similarity(a_json, b_json)` | `String, String -> Float64` | — | Pure; JSON float arrays |
| `chunk_text(text, chunk_size)` | `String, Int64 -> String` | — | Pure; returns JSON string array |
| `embed_and_retrieve(query, chunks_json, top_k)` | `String, String, Int64 -> Result<String, String>` | Embed | Full RAG: embed + rank + return top-k |

Set `CLARITY_EMBED_MODEL` to choose the embedding model (default `text-embedding-ada-002`).

### Eval (pure checks need no effect; LLM/embedding calls require Eval effect)

| Function | Signature | Effect | Notes |
|----------|-----------|--------|-------|
| `eval_exact(got, expected)` | `String, String -> Bool` | — | Exact string equality |
| `eval_contains(got, expected)` | `String, String -> Bool` | — | Substring membership |
| `eval_llm_judge(model, prompt, resp, rubric)` | `String×4 -> Result<String, String>` | Eval | Returns `{"score":0.0-1.0,"pass":bool,"reason":"..."}` |
| `eval_semantic(got, expected)` | `String, String -> Result<Float64, String>` | Eval | Cosine similarity via embeddings |

### Policy (no effect required)

| Function | Signature | Notes |
|----------|-----------|-------|
| `policy_is_url_allowed(url)` | `String -> Bool` | Check CLARITY_ALLOW_HOSTS |
| `policy_is_effect_allowed(name)` | `String -> Bool` | Check CLARITY_DENY_EFFECTS |

**Runtime policy env vars:**
- `CLARITY_ALLOW_HOSTS` — comma-separated hostname globs (e.g. `api.openai.com,*.corp`). Empty = allow all.
- `CLARITY_DENY_EFFECTS` — comma-separated effect names to block (e.g. `MCP,A2A`).
- `CLARITY_AUDIT_LOG` — path to a JSONL file; every network call appends a structured audit entry.

## Standard library modules

| Module | Key functions |
|--------|--------------|
| `std/math` | `abs`, `min`, `max`, `clamp`, `sign`, `is_even`, `is_odd`, `square_root`, `power`, `floor_f`, `ceil_f` |
| `std/string` | `length`, `has`, `find`, `strip`, `slice`, `at`, `split_by`, `is_blank`, `repeat`, `to_int`, `to_float` |
| `std/list` | `map`, `filter`, `fold`/`fold_left`/`fold_right`, `find`, `any`, `all`, `count_where`, `flat_map`, `zip_with`, `flatten`, `take`, `drop`, `sum`, `product`, `maximum`, `minimum`, `range`, `replicate`, `size`, `first`, `rest`, `push` |
| `std/llm` | `prompt`, `prompt_with`, `chat`, `prompt_with_system`, `unwrap_or`, `is_ok`, `error_of` |
| `std/mcp` | `connect`, `list_tools`, `call_tool`, `call_tool_no_args`, `disconnect`, `unwrap_or`, `is_ok`, `error_of` |
| `std/a2a` | `discover`, `submit`, `poll`, `cancel`, `is_done`, `is_failed`, `is_canceled`, `unwrap_output`, `unwrap_or`, `is_ok`, `error_of` |
| `std/agent` | `run(key, initial, step_fn)`, `resume(key, step_fn)`, `clear(key)` — resumable agent loop with auto-checkpointing |
| `std/rag` | `retrieve(query, text, chunk_size, top_k)`, `chunk(text, size)`, `embed(text)`, `similarity(a, b)` |
| `std/eval` | `exact(got, expected)`, `has_match(got, expected)`, `semantic(got, expected)`, `judge(model, prompt, resp, rubric)`, `pass(model, prompt, resp, rubric)` |
| `std/stream` | `call(model, prompt)`, `call_with_system(model, system, prompt)` → `Result<String, String>` — pull-based SSE streaming, collects all tokens |

### Streaming builtins (Model effect)

| Function | Signature | Notes |
|----------|-----------|-------|
| `stream_start(model, prompt, system)` | `String×3 -> Result<Int64, String>` | Start SSE stream; returns handle or Err |
| `stream_next(handle)` | `Int64 -> Option<String>` | Block until next token; None = stream ended |
| `stream_close(handle)` | `Int64 -> String` | Cleanup; returns error if stream failed, "" if ok |

Run `npx clarityc introspect --builtins` for the full built-in list (string ops, math, conversions, etc).

## What Clarity does NOT have
No `if`/`else` (use `match`), no loops (use recursion), no `return` (last expr is return value), no `null` (use `Option<T>`), no exceptions (use `Result<T, E>`), no `class`/`interface` (use `type`), no `var` (use `let`/`let mut`), no implicit conversions, no lambdas/closures (pass named functions only).

## Comments
```
// Single-line only
```
