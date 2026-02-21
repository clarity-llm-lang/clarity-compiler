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
import { length, repeat } from "std/string"
import { size, first, push } from "std/list"
import { prompt, is_ok } from "std/llm"    // LLM interop
import { connect, call_tool } from "std/mcp" // MCP tool servers
import { submit, poll, is_done } from "std/a2a" // A2A agents
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
`Model`, `Secret`, `MCP`, `A2A`

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
| `now()` | `-> Timestamp` | Time |
| `get_secret(name)` | `String -> Option<String>` | Secret |

## AI / Agent builtins

### LLM (Model effect)

| Function | Signature | Notes |
|----------|-----------|-------|
| `call_model(model, prompt)` | `String, String -> Result<String, String>` | OpenAI-compatible |
| `call_model_system(model, system, prompt)` | `String, String, String -> Result<String, String>` | With system prompt |
| `list_models()` | `-> List<String>` | Lists provider models |

Set `OPENAI_API_KEY` and optionally `OPENAI_BASE_URL` (works with Ollama, Groq, etc.).

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
| `std/list` | `size`, `first`, `rest`, `push`, `join`, `reversed`, `empty`, `get`, `set_at`, `map`, `filter`, `fold_left`, `fold_right`, `any`, `all`, `count_where`, `zip_with`, `flatten`, `take`, `drop`, `sum`, `product`, `range`, `replicate` |
| `std/llm` | `prompt`, `prompt_with`, `chat`, `prompt_with_system`, `unwrap_or`, `is_ok`, `error_of` |
| `std/mcp` | `connect`, `list_tools`, `call_tool`, `call_tool_no_args`, `disconnect`, `unwrap_or`, `is_ok`, `error_of` |
| `std/a2a` | `discover`, `submit`, `poll`, `cancel`, `is_done`, `is_failed`, `is_canceled`, `unwrap_output`, `unwrap_or`, `is_ok`, `error_of` |

Run `npx clarityc introspect --builtins` for the full built-in list (string ops, math, conversions, etc).

## What Clarity does NOT have
No `if`/`else` (use `match`), no loops (use recursion), no `return` (last expr is return value), no `null` (use `Option<T>`), no exceptions (use `Result<T, E>`), no `class`/`interface` (use `type`), no `var` (use `let`/`let mut`), no implicit conversions, no lambdas/closures (pass named functions only).

## Comments
```
// Single-line only
```
