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
import { add, User } from "math"      // imports math.clarity from same directory
export function add(a: Int64, b: Int64) -> Int64 { a + b }
export type Color = | Red | Green | Blue
```

## Types
```
// Primitives: Int64, Float64, String, Bool, Unit
// Generic built-ins: List<T>, Option<T> (Some/None), Result<T, E> (Ok/Err)

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

Effects: `DB`, `Network`, `Time`, `Random`, `Log`, `FileSystem`, `Test`

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
| `head(list)` | `List<T> -> T` | — |
| `tail(list)` | `List<T> -> List<T>` | — |
| `append(list, elem)` | `List<T>, T -> List<T>` | — |
| `length(list)` | `List<T> -> Int64` | — |

Run `npx clarityc introspect --builtins` for the full list (string ops, math, conversions, etc).

## What Clarity does NOT have
No `if`/`else` (use `match`), no loops (use recursion), no `return` (last expr is return value), no `null` (use `Option<T>`), no exceptions (use `Result<T, E>`), no `class`/`interface` (use `type`), no `var` (use `let`/`let mut`), no implicit conversions, no lambdas/closures (pass named functions only).

## Comments
```
// Single-line only
```
