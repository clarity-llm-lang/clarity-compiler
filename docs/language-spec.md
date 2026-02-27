# Clarity Language Specification

**Version:** 0.3
**Status:** Draft — LLM-optimized programming language

---

## 1. Design Philosophy

Clarity is a programming language designed as an **LLM code generation target**. It prioritizes:

1. **Syntactic regularity** — One way to do each thing. No alternative syntax, no sugar.
2. **Safety by default** — No null, no exceptions, no implicit conversions, no memory management.
3. **Explicit effects** — Side effects are declared in function signatures and enforced at compile time.
4. **Exhaustive checking** — Pattern matches must cover all cases. Errors must be handled.
5. **Minimal surface area** — Small set of primitives that compose well, rather than a large standard library.

These properties make Clarity code **easier for LLMs to generate correctly** by reducing the number of decisions, eliminating implicit behavior, and catching errors at compile time rather than runtime.

### What Clarity deliberately omits

| Construct | Reason | Alternative |
|-----------|--------|-------------|
| `if`/`else` | Ambiguous nesting, easy to forget branches | `match` with exhaustiveness checking |
| `while`/`for` loops | Mutable state bugs, off-by-one errors | Recursion (tail calls optimized to loops) |
| `null`/`nil`/`undefined` | Billion-dollar mistake | `Option<T>` with `Some`/`None` |
| Exceptions (`try`/`catch`/`throw`) | Hidden control flow, forgotten handlers | Union types for errors |
| `class`/`interface`/inheritance | Complex dispatch, fragile hierarchies | Record types + union types |
| `return` keyword | Unclear control flow in nested contexts | Last expression is the return value |
| `var` | Mutable by default leads to bugs | `let` (immutable) / `let mut` (explicit mutable) |
| Operator overloading | Unpredictable semantics | Fixed operator meanings |
| Implicit type conversions | Silent data loss (e.g. int-to-float) | Explicit conversion functions |
| Macros | Code that writes code is hard to reason about | None — keep it simple |

---

## 2. Lexical Structure

### 2.1 Character Set
Source files are UTF-8 encoded. Identifiers are restricted to ASCII: `[a-zA-Z_][a-zA-Z0-9_]*`.

### 2.2 Comments
Only single-line comments:
```
// This is a comment
```
No block comments. This avoids nesting ambiguity.

### 2.3 Whitespace
Spaces, tabs, newlines, and carriage returns are whitespace. Whitespace is insignificant except as token separators.

### 2.4 Keywords
```
module  function  type  const  let  mut  match  effect
True  False  and  or
```

### 2.5 Literals

| Type | Syntax | Examples |
|------|--------|---------|
| Integer | `[0-9]+` | `0`, `42`, `1000000` |
| Float | `[0-9]+.[0-9]+` | `3.14`, `0.5`, `100.0` |
| String | `"..."` with `\n`, `\t`, `\\`, `\"` escapes | `"hello"`, `"line\nbreak"` |
| Boolean | `True` or `False` | `True`, `False` |
| List | `[expr, ...]` | `[1, 2, 3]`, `[]` |

### 2.6 Operators

| Precedence | Operators | Associativity | Operand Types |
|-----------|-----------|---------------|---------------|
| 1 (lowest) | `or` | Left | Bool |
| 2 | `and` | Left | Bool |
| 3 | `==` `!=` | Left | Same type on both sides |
| 4 | `<` `>` `<=` `>=` | Left | Numeric |
| 5 | `+` `-` `++` | Left | Numeric (`+` `-`), String (`++`) |
| 6 | `*` `/` `%` | Left | Numeric |
| 7 (highest) | `-` (unary) `!` | Prefix | Numeric / Bool |

All comparison and logical operators return `Bool`.

---

## 3. Type System

### 3.1 Built-in Types

| Type | Description | WASM representation |
|------|-------------|-------------------|
| `Int64` | 64-bit signed integer | `i64` |
| `Float64` | 64-bit IEEE 754 float | `f64` |
| `Bool` | Boolean (`True` / `False`) | `i32` (0 or 1) |
| `String` | UTF-8 string | `i32` (pointer) |
| `Bytes` | Raw byte sequence | `i32` (pointer) |
| `Timestamp` | Point in time | `i64` |
| `Unit` | No meaningful value (like void) | `none` |

### 3.2 Generic Types

| Type | Description |
|------|-------------|
| `List<T>` | Ordered collection of elements of type `T` |
| `Option<T>` | Either `Some(value: T)` or `None` |
| `Result<T, E>` | Either `Ok(value: T)` or `Err(error: E)` |
| `Map<K, V>` | Immutable key-value mapping; keys are `String` or `Int64` |

`Result<T, E>` is a built-in type for error handling. `Ok` and `Err` are polymorphic constructors — the compiler infers the full `Result` type from context:
```
function divide(a: Int64, b: Int64) -> Result<Int64, String> {
  match b == 0 {
    True -> Err("division by zero"),
    False -> Ok(a / b)
  }
}

function unwrap(r: Result<Int64, String>) -> Int64 {
  match r {
    Ok(value) -> value,
    Err(error) -> 0
  }
}
```

### 3.2.1 Type Aliases

Type aliases create transparent synonyms for existing types:
```
type UserId = Int64
type Email = String
```

Aliases are fully interchangeable with their underlying type — `UserId` and `Int64` can be used interchangeably in all contexts.

### 3.3 Record Types
Named product types with labeled fields:
```
type User = {
  id: Int64,
  email: String,
  created_at: Timestamp,
}
```

Fields are accessed with dot syntax: `user.email`. Trailing commas are permitted.

### 3.4 Union Types
Tagged sum types with named variants:
```
type AuthResult =
  | Success(token: String, user_id: Int64)
  | Failure(reason: String)
  | Pending
```

Variants can have zero or more fields. Variants with no fields (like `Pending`) are unit variants.

Variant names must start with an uppercase letter. They serve as constructors:
```
let result = Success(token: "abc", user_id: 42);
let err = Failure("timeout");
let p = Pending;
```

### 3.5 Function Types
Functions have typed parameters, a return type, and optional effect annotations:
```
function name(param1: Type1, param2: Type2) -> ReturnType { body }
```

Named functions can be passed as arguments using function type syntax:
```
(ParamType1, ParamType2) -> ReturnType
```

Example:
```
function double(x: Int64) -> Int64 { x * 2 }
function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
function result() -> Int64 { apply(double, 5) }  // returns 10
```

Lambdas and closures are not yet supported. Only named functions can be passed as values.

### 3.6 Generics (Parametric Polymorphism)

Functions and type declarations can have type parameters:
```
// Generic function — T is inferred from the argument
function identity<T>(x: T) -> T { x }

identity(42)       // T = Int64, returns Int64
identity("hello")  // T = String, returns String
```

Multiple type parameters:
```
function first<A, B>(a: A, b: B) -> A { a }
```

Generic type declarations:
```
type Wrapper<T> = { value: T }
```

Type parameters are inferred automatically at call sites — no explicit type arguments needed.

Built-in list operations are generic:
```
head([1, 2, 3])       // returns Int64 (inferred from List<Int64>)
head(["a", "b"])      // returns String (inferred from List<String>)
tail([1, 2])          // returns List<Int64>
append([1, 2], 3)     // returns List<Int64>
```

Generic functions are monomorphized at compile time — a separate WASM function is generated for each concrete type instantiation.

### 3.7 No Implicit Conversions
There are **no implicit type conversions**. `Int64` and `Float64` cannot be mixed in arithmetic:
```
// COMPILE ERROR: Cannot mix Int64 and Float64 in arithmetic
function bad(a: Int64, b: Float64) -> Float64 { a + b }
```

### 3.8 No Null
There is no `null`, `nil`, or `undefined`. Use `Option<T>`:
```
type Option<T> = | Some(value: T) | None
```

### 3.9 No Exceptions
There are no exceptions. Use `Result<T, E>` for operations that can fail:
```
type Result<T, E> = | Ok(value: T) | Err(error: E)
```

---

## 4. Declarations

### 4.1 Module Declaration
Every source file begins with exactly one module declaration:
```
module ModuleName
```

The module name must start with an uppercase letter.

### 4.2 Function Declaration
```
function function_name(param: Type, ...) -> ReturnType {
  body_expression
}
```

- Parameters are immutable.
- The function body is a block expression. The last expression in the block is the return value.
- There is no `return` keyword.

### 4.3 Effectful Function Declaration
```
effect[Effect1, Effect2] function name(params) -> ReturnType {
  body
}
```

See section 6 (Effect System) for details.

### 4.4 Type Declaration
```
type Name = TypeExpression
```

Where `TypeExpression` is a record type, union type, or type alias.

### 4.5 Constant Declaration
```
const NAME: Type = expression;
```

Constants are module-level immutable bindings. They must have an explicit type annotation and end with a semicolon.

---

## 5. Expressions

### 5.1 Block Expression
```
{
  statement1;
  statement2;
  result_expression
}
```

- Statements are expressions followed by `;`. Their values are discarded.
- The last expression (without `;`) is the block's value.
- An empty block `{}` has type `Unit`.

### 5.2 Let Binding
```
let name = expression;          // immutable
let mut name = expression;      // mutable
let _ = expression;             // discard value
let name: Type = expression;    // with type annotation
```

- Bindings are immutable by default. Only `let mut` allows reassignment.
- The wildcard `_` discards the value (useful for side effects).
- Let bindings have type `Unit`.

### 5.2.1 Assignment
```
name = expression;              // reassign a mutable variable
```

- Only variables declared with `let mut` can be reassigned.
- Assigning to an immutable variable is a compile error.
- The assigned value must match the variable's declared type.
- Assignment expressions have type `Unit`.

### 5.3 Match Expression
```
match scrutinee {
  Pattern1 -> expression1,
  Pattern2 -> expression2,
}
```

- The scrutinee is evaluated once.
- Arms are checked top to bottom. The first matching pattern wins.
- All arms must return the same type.
- Trailing commas after arms are optional.
- **Match must be exhaustive** — all possible values of the scrutinee type must be covered.

### 5.4 Patterns

| Pattern | Syntax | Matches |
|---------|--------|---------|
| Wildcard | `_` | Anything (discards value) |
| Binding | `name` (lowercase) | Anything (binds to name) |
| Literal | `42`, `"hi"`, `True` | Exact value |
| Range | `1..10` | Int64 value in range (inclusive both ends) |
| Constructor | `VariantName(field1, field2)` | Union variant, binding fields |
| Constructor (unit) | `VariantName` (uppercase, no parens) | Unit variant |

Any pattern can have a **guard** — an `if` condition that must also be true:
```
match n {
  x if x > 100 -> "large",
  x if x > 0 -> "small",
  _ -> "non-positive"
}
```

Range patterns match Int64 values within inclusive bounds:
```
match score {
  90..100 -> "A",
  80..89 -> "B",
  _ -> "F"
}
```

Constructor patterns destructure union variants:
```
match result {
  Success(token, user_id) -> token,
  Failure(reason) -> reason,
  Pending -> "waiting",
}
```

Named field destructuring:
```
match result {
  Success(token: t, user_id: id) -> t,
  _ -> "error",
}
```

### 5.5 Function Call
```
function_name(arg1, arg2)
function_name(name: value, other_name: value)
```

Positional and named arguments are supported. Named arguments are validated against parameter names and reordered to match the function's parameter order. All arguments must be either positional or named — mixing is not allowed.

### 5.6 Member Access
```
record.field_name
```

Accesses a field of a record type.

### 5.7 Binary and Unary Expressions
See operator table in section 2.6.

### 5.8 Literals
See section 2.5.

---

## 6. Effect System

### 6.1 Purpose
The effect system tracks **side effects** at the type level. A function that reads from a database, writes to a log, or gets the current time must declare those effects. This prevents accidental side effects and makes function behavior explicit.

### 6.2 Known Effects

| Effect | Description |
|--------|-------------|
| `DB` | Database reads and writes |
| `Network` | HTTP calls, socket operations |
| `Time` | Getting current time, sleeping |
| `Random` | Random number generation |
| `Log` | Logging output |
| `FileSystem` | File reads and writes, stdin, command-line arguments, process control |
| `Test` | Test assertions (used by the self-healing test system) |
| `Model` | LLM completion via OpenAI-compatible or Anthropic API |
| `Secret` | Read secrets from environment variables |
| `MCP` | Connect to MCP tool servers and invoke tools |
| `A2A` | Communicate with A2A-protocol agents |
| `Trace` | Structured span tracing for observability |
| `Persist` | Durable key-value checkpointing for resumable agents |
| `Embed` | Text embedding and vector similarity (network I/O to embeddings API) |
| `Eval` | LLM output evaluation — judge responses against rubrics or measure semantic similarity |

### 6.3 Rules

1. **Pure by default**: A function with no `effect[...]` annotation is pure. It cannot call any effectful function.
2. **Effect propagation**: A function calling an effectful function must declare at least the same effects.
3. **Effect superset is allowed**: A function may declare more effects than it actually uses.

```
// Pure function — cannot perform side effects
function add(a: Int64, b: Int64) -> Int64 { a + b }

// Effectful function — must declare DB
effect[DB] function get_user(id: Int64) -> String { ... }

// COMPILE ERROR: pure function calling effectful function
function bad() -> String { get_user(1) }

// OK: caller declares required effects
effect[DB] function good() -> String { get_user(1) }

// OK: caller declares superset of effects
effect[DB, Log] function also_good() -> String { get_user(1) }
```

---

## 7. Exhaustiveness Checking

### 7.1 Boolean Match
Matching on a `Bool` must cover both `True` and `False`, or include a wildcard/binding:
```
// OK — both branches covered
match condition { True -> 1, False -> 0 }

// OK — wildcard covers all
match condition { True -> 1, _ -> 0 }

// COMPILE ERROR — missing False
match condition { True -> 1 }
```

### 7.2 Union Type Match
Matching on a union type must cover all variants:
```
type Color = | Red | Green | Blue

// OK — all variants covered
match c { Red -> 1, Green -> 2, Blue -> 3 }

// OK — wildcard covers remaining
match c { Red -> 1, _ -> 0 }

// COMPILE ERROR — missing Blue
match c { Red -> 1, Green -> 2 }
```

---

## 8. Immutability

### 8.1 Default Immutability
All bindings are immutable by default:
```
let x = 42;
x = 43;  // COMPILE ERROR: Cannot assign to immutable variable 'x'
```

### 8.2 Explicit Mutability
Use `let mut` for mutable bindings:
```
let mut counter = 0;
counter = counter + 1;  // OK — counter is now 1
counter = counter + 1;  // OK — counter is now 2
```

### 8.3 Function Parameters
Function parameters are always immutable. There is no way to make them mutable.

---

## 9. Compilation Target

Clarity compiles to **WebAssembly (WASM)**. The compiler produces standard `.wasm` binaries that can be executed by:

- Node.js (`WebAssembly` API)
- Any web browser
- Standalone runtimes (Wasmtime, Wasmer, WasmEdge)

### 9.1 Type Mapping

| Clarity Type | WASM Type |
|-------------|-----------|
| `Int64` | `i64` |
| `Float64` | `f64` |
| `Bool` | `i32` |
| `Unit` | `none` |
| `String`, `Record`, `Union`, `List` | `i32` (pointer into linear memory) |

### 9.2 Function Exports
All top-level functions are exported from the WASM module and can be called from the host environment.

---

## 10. Module System

### 10.1 Import Declarations
```
import { add, multiply } from "math"
import { User, save_user } from "./db/models"
```

- Module paths are resolved relative to the importing file
- `"math"` resolves to `math.clarity` in the same directory
- `"./db/models"` resolves to `db/models.clarity` relative to the importing file
- `"std/math"` resolves to the compiler's bundled standard library
- Imported names must be explicitly exported by the target module
- Imported names shadow builtins with the same name

### 10.2 Export Declarations
```
export function add(a: Int64, b: Int64) -> Int64 { a + b }
export type Color = | Red | Green | Blue
```

- Only `export`-prefixed declarations are visible to importers
- Exporting a union type automatically exports its variant constructors
- Non-exported declarations are module-private
- All modules are compiled into a single WASM binary (merge compilation)

### 10.3 Compilation Model
- The compiler resolves all imports transitively, building a dependency graph
- Modules are checked in dependency order (dependencies before dependents)
- All modules are merged into a single WASM binary
- Only the entry module's functions appear as WASM exports

### 10.4 Standard Library

The compiler ships with a standard library accessible via `"std/..."` imports:

**std/math** — Numeric utilities
- `abs(n: Int64) -> Int64` — Absolute value
- `min(a: Int64, b: Int64) -> Int64` — Minimum
- `max(a: Int64, b: Int64) -> Int64` — Maximum
- `clamp(n: Int64, lo: Int64, hi: Int64) -> Int64` — Clamp to range
- `sign(n: Int64) -> Int64` — Sign (-1, 0, or 1)
- `is_even(n: Int64) -> Bool` — Even check
- `is_odd(n: Int64) -> Bool` — Odd check
- `square_root(x: Float64) -> Float64` — Square root
- `power(base: Float64, exp: Float64) -> Float64` — Exponentiation
- `floor_f(x: Float64) -> Float64` — Floor
- `ceil_f(x: Float64) -> Float64` — Ceiling

**std/string** — String utilities
- `length(s: String) -> Int64` — String length
- `concat(a: String, b: String) -> String` — Concatenation
- `has(haystack: String, needle: String) -> Bool` — Contains check
- `find(haystack: String, needle: String) -> Int64` — Index of substring
- `strip(s: String) -> String` — Trim whitespace
- `slice(s: String, start: Int64, len: Int64) -> String` — Substring
- `at(s: String, index: Int64) -> String` — Character at index
- `split_by(s: String, delim: String) -> List<String>` — Split by delimiter
- `is_blank(s: String) -> Bool` — Empty string check
- `repeat(s: String, n: Int64) -> String` — Repeat n times
- `to_int(s: String) -> Option<Int64>` — Parse to integer
- `to_float(s: String) -> Option<Float64>` — Parse to float

**std/list** — Generic list utilities (higher-order functions require named function references)
- `size<T>(items: List<T>) -> Int64` — List length
- `first<T>(items: List<T>) -> T` — First element (traps on empty)
- `rest<T>(items: List<T>) -> List<T>` — Tail (all but first element)
- `push<T>(items: List<T>, value: T) -> List<T>` — Append one element
- `join<T>(a: List<T>, b: List<T>) -> List<T>` — Concatenate two lists
- `reversed<T>(items: List<T>) -> List<T>` — Reverse a list
- `empty<T>(items: List<T>) -> Bool` — Empty-check
- `get<T>(items: List<T>, index: Int64) -> T` — Index lookup (traps if out of bounds)
- `set_at<T>(items: List<T>, index: Int64, value: T) -> List<T>` — Immutable index update
- `map<A, B>(items: List<A>, f: (A) -> B) -> List<B>` — Transform each element
- `filter<T>(items: List<T>, pred: (T) -> Bool) -> List<T>` — Keep matching elements
- `fold_left<A, B>(items: List<A>, acc: B, f: (B, A) -> B) -> B` — Left fold/reduce
- `fold_right<A, B>(items: List<A>, acc: B, f: (A, B) -> B) -> B` — Right fold
- `any<T>(items: List<T>, pred: (T) -> Bool) -> Bool` — True if any element matches
- `all<T>(items: List<T>, pred: (T) -> Bool) -> Bool` — True if all elements match
- `count_where<T>(items: List<T>, pred: (T) -> Bool) -> Int64` — Count matching elements
- `zip_with<A, B, C>(a: List<A>, b: List<B>, f: (A, B) -> C) -> List<C>` — Combine two lists
- `flatten<T>(items: List<List<T>>) -> List<T>` — Flatten one level
- `take<T>(items: List<T>, n: Int64) -> List<T>` — First n elements
- `drop<T>(items: List<T>, n: Int64) -> List<T>` — Skip first n elements
- `sum(items: List<Int64>) -> Int64` — Sum of integers
- `product(items: List<Int64>) -> Int64` — Product of integers
- `maximum(items: List<Int64>) -> Int64` — Max value (traps on empty)
- `minimum(items: List<Int64>) -> Int64` — Min value (traps on empty)
- `range(start: Int64, end: Int64) -> List<Int64>` — Inclusive integer range
- `replicate<T>(value: T, count: Int64) -> List<T>` — Repeat value n times

**std/llm** — LLM interop (requires `Model` effect; needs `OPENAI_API_KEY` env var)
- `prompt(text: String) -> Result<String, String>` — Call default model with user prompt
- `prompt_with(model: String, text: String) -> Result<String, String>` — Specify model
- `chat(model: String, system: String, user: String) -> Result<String, String>` — System + user
- `prompt_with_system(system: String, user: String) -> Result<String, String>` — System + user with default model
- `unwrap_or(result: Result<String, String>, fallback: String) -> String` — Extract or default
- `is_ok(result: Result<String, String>) -> Bool` — Success check
- `error_of(result: Result<String, String>) -> String` — Extract error message

**std/mcp** — MCP tool-server client (requires `MCP` effect)
- `connect(url: String) -> Result<Int64, String>` — Connect to HTTP MCP server; returns session handle
- `list_tools(session: Int64) -> Result<String, String>` — JSON array of tool descriptors
- `call_tool(session: Int64, tool: String, args_json: String) -> Result<String, String>` — Invoke tool
- `call_tool_no_args(session: Int64, tool: String) -> Result<String, String>` — Tool with no arguments
- `disconnect(session: Int64) -> Unit` — Release session
- `unwrap_or`, `is_ok`, `error_of` — Result helpers (same as std/llm)

**std/a2a** — A2A agent client (requires `A2A` effect; Google A2A JSON-RPC 2.0 protocol)
- `discover(url: String) -> Result<String, String>` — Fetch agent card JSON
- `submit(url: String, message: String) -> Result<String, String>` — Submit task; returns task_id
- `poll(url: String, task_id: String) -> Result<String, String>` — Get status JSON: `{ "id", "status", "output" }`
- `cancel(url: String, task_id: String) -> Result<String, String>` — Cancel task
- `is_done(status_json: String) -> Bool` — True if status contains `"completed"`
- `is_failed(status_json: String) -> Bool` — True if status contains `"failed"`
- `is_canceled(status_json: String) -> Bool` — True if status contains `"canceled"`
- `unwrap_output(status_json: String) -> String` — Extract the `output` field value
- `unwrap_or`, `is_ok`, `error_of` — Result helpers

**std/hitl** — Human-in-the-loop session I/O (requires `HumanInLoop` effect)
- `ask(key: String, question: String) -> String` — Blocking question/answer handshake (existing behavior)
- `session_open(run_id: String) -> Result<String, String>` — Start or attach to an interactive HITL session channel
- `session_send(run_id: String, text: String) -> Result<Unit, String>` — Emit one human-authored CLI line into the active agent run
- `session_recv(run_id: String) -> Result<String, String>` — Receive one pending agent line/event from the interactive session
- `session_close(run_id: String) -> Unit` — Close interactive session resources
- Runtime requirement: when a frontend opens a virtual CLI for an agent run, direct free-text messages MUST be routable to the run even when no `.question` file is pending.
- Runtime requirement: interactive session messages MUST be represented as `agent.human_message` (or a superseding typed equivalent) in runtime telemetry for auditability.

---

## 11. Error Model

Clarity uses **compile-time error detection** wherever possible:

| Error Class | Detection | Mechanism |
|-------------|-----------|-----------|
| Type mismatch | Compile time | Static type checker |
| Undefined variable | Compile time | Scope analysis |
| Missing match arms | Compile time | Exhaustiveness checker |
| Unauthorized side effects | Compile time | Effect system |
| Mixed numeric types | Compile time | No implicit conversion |
| Unused effects | Compile time | Warning |
| Division by zero | Runtime | WASM trap |
| Stack overflow | Runtime | WASM stack limit |

### 10.1 Error Messages
Error messages are designed for LLM consumption — precise, actionable, with fix suggestions:
```
error: Function 'save' requires effects [DB] but caller only declares [none]
  --> app.clarity:12:5
   |
12 |     save(user)
   |     ^^^^^^^^^^
   = help: Add the missing effects to the caller: effect[DB]
```

When an LLM uses a construct from another language, the compiler provides migration hints:
```
error: Clarity does not have 'if' expressions
  --> app.clarity:5:3
   |
5  |   if x > 0 { ... }
   |   ^^
   = help: Use 'match' for conditional logic: match condition { True -> ..., False -> ... }
```

---

## 11. Built-in Functions

### 11.1 I/O and Logging (require `Log` effect)

| Function | Signature | Description |
|----------|-----------|-------------|
| `print_string(s)` | `String -> Unit` | Print a string to stdout |
| `print_int(n)` | `Int64 -> Unit` | Print an integer to stdout |
| `print_float(n)` | `Float64 -> Unit` | Print a float to stdout |
| `log_info(s)` | `String -> Unit` | Log at info level |
| `log_warn(s)` | `String -> Unit` | Log at warning level |

### 11.2 I/O Primitives (require `FileSystem` effect)

| Function | Signature | Description |
|----------|-----------|-------------|
| `read_line()` | `-> String` | Read one line from stdin |
| `read_all_stdin()` | `-> String` | Read all of stdin to a string |
| `read_file(path)` | `String -> String` | Read entire file as string |
| `write_file(path, content)` | `String, String -> Unit` | Write string to file |
| `get_args()` | `-> List<String>` | Get command-line arguments |
| `exit(code)` | `Int64 -> Unit` | Exit process with status code |

Example:
```
effect[FileSystem, Log] function main() -> Unit {
  let input = read_all_stdin();
  let args = get_args();
  let content = read_file("config.txt");
  write_file("output.txt", content);
  print_string("Done: " ++ int_to_string(string_length(input)) ++ " bytes read")
}
```

### 11.3 String Operations

| Function | Signature | Description |
|----------|-----------|-------------|
| `string_concat(a, b)` | `String, String -> String` | Concatenate (also `++` operator) |
| `string_eq(a, b)` | `String, String -> Bool` | String equality |
| `string_length(s)` | `String -> Int64` | Length in characters |
| `substring(s, start, len)` | `String, Int64, Int64 -> String` | Extract substring |
| `char_at(s, i)` | `String, Int64 -> String` | Character at index |
| `contains(haystack, needle)` | `String, String -> Bool` | Check substring presence |
| `index_of(haystack, needle)` | `String, String -> Int64` | First index of substring (-1 if not found) |
| `trim(s)` | `String -> String` | Remove leading/trailing whitespace |
| `split(s, delimiter)` | `String, String -> List<String>` | Split string by delimiter |
| `char_code(s)` | `String -> Int64` | Unicode code point of first character (0 for empty) |
| `char_from_code(code)` | `Int64 -> String` | Single-character string from Unicode code point |

### 11.4 Type Conversions

| Function | Signature | Description |
|----------|-----------|-------------|
| `int_to_float(n)` | `Int64 -> Float64` | Integer to float |
| `float_to_int(n)` | `Float64 -> Int64` | Float to integer (truncates) |
| `int_to_string(n)` | `Int64 -> String` | Integer to string |
| `float_to_string(n)` | `Float64 -> String` | Float to string |
| `string_to_int(s)` | `String -> Option<Int64>` | Parse string to integer. `Some(value)` on success, `None` on failure |
| `string_to_float(s)` | `String -> Option<Float64>` | Parse string to float. `Some(value)` on success, `None` on failure |

### 11.5 Math

| Function | Signature | Description |
|----------|-----------|-------------|
| `abs_int(n)` | `Int64 -> Int64` | Absolute value |
| `min_int(a, b)` | `Int64, Int64 -> Int64` | Minimum |
| `max_int(a, b)` | `Int64, Int64 -> Int64` | Maximum |
| `sqrt(n)` | `Float64 -> Float64` | Square root |
| `pow(base, exp)` | `Float64, Float64 -> Float64` | Power |
| `floor(n)` | `Float64 -> Float64` | Floor |
| `ceil(n)` | `Float64 -> Float64` | Ceiling |

### 11.6 List Operations

| Function | Signature | Description |
|----------|-----------|-------------|
| `length(list)` | `List<T> -> Int64` | Number of elements |
| `head(list)` | `List<T> -> T` | First element |
| `tail(list)` | `List<T> -> List<T>` | All elements except first |
| `append(list, elem)` | `List<T>, T -> List<T>` | Add element to end |
| `concat(a, b)` | `List<T>, List<T> -> List<T>` | Concatenate two lists |
| `reverse(list)` | `List<T> -> List<T>` | Reverse a list |
| `is_empty(list)` | `List<T> -> Bool` | True if list has no elements |
| `nth(list, index)` | `List<T>, Int64 -> T` | Element at index (0-based) |

### 11.7 Bytes Operations

| Function | Signature | Description |
|----------|-----------|-------------|
| `bytes_new(size)` | `Int64 -> Bytes` | Create a zero-filled Bytes buffer |
| `bytes_length(b)` | `Bytes -> Int64` | Length of a Bytes buffer |
| `bytes_get(b, index)` | `Bytes, Int64 -> Int64` | Get byte at index (0-255) |
| `bytes_set(b, index, value)` | `Bytes, Int64, Int64 -> Bytes` | Set byte, returns new Bytes |
| `bytes_slice(b, start, length)` | `Bytes, Int64, Int64 -> Bytes` | Extract sub-range |
| `bytes_concat(a, b)` | `Bytes, Bytes -> Bytes` | Concatenate two buffers |
| `bytes_from_string(s)` | `String -> Bytes` | Encode string as UTF-8 bytes |
| `bytes_to_string(b)` | `Bytes -> String` | Decode bytes as UTF-8 string |

### 11.8 Timestamp Operations

Timestamp is represented as milliseconds since Unix epoch (i64).

| Function | Signature | Description |
|----------|-----------|-------------|
| `now()` | `-> Timestamp` | Current time (requires `Time` effect) |
| `timestamp_to_string(t)` | `Timestamp -> String` | ISO 8601 string |
| `timestamp_to_int(t)` | `Timestamp -> Int64` | Milliseconds since epoch |
| `timestamp_from_int(ms)` | `Int64 -> Timestamp` | Create from milliseconds |
| `timestamp_add(t, ms)` | `Timestamp, Int64 -> Timestamp` | Add milliseconds |
| `timestamp_diff(a, b)` | `Timestamp, Timestamp -> Int64` | Difference in ms (a - b) |

### 11.9 Map Operations

`Map<K, V>` is an immutable persistent key-value store. Every mutating operation (`map_set`, `map_remove`) returns a new handle; the original is unchanged. Keys must be `String` or `Int64`.

| Function | Signature | Description |
|----------|-----------|-------------|
| `map_new()` | `-> Map<K, V>` | Create an empty map (type annotation required) |
| `map_size(m)` | `Map<K, V> -> Int64` | Number of entries |
| `map_has(m, key)` | `Map<K, V>, K -> Bool` | True if key exists |
| `map_get(m, key)` | `Map<K, V>, K -> Option<V>` | Look up a key; returns `Some(v)` or `None` |
| `map_set(m, key, value)` | `Map<K, V>, K, V -> Map<K, V>` | Insert or overwrite a key |
| `map_remove(m, key)` | `Map<K, V>, K -> Map<K, V>` | Remove a key (no-op if absent) |
| `map_keys(m)` | `Map<K, V> -> List<K>` | All keys as a list |
| `map_values(m)` | `Map<K, V> -> List<V>` | All values as a list |

```clarity
let m: Map<String, Int64> = map_new();
let m2 = map_set(m, "score", 42);
match map_get(m2, "score") {
  None -> 0,
  Some(v) -> v        // v : Int64
}
```

### 11.10 JSON Operations

Clarity provides two tiers of JSON support: flat-object helpers and structured nested access.

| Function | Signature | Description |
|----------|-----------|-------------|
| `json_parse(s)` | `String -> Option<Map<String, String>>` | Parse flat JSON object. Returns `Some(map)` on success, `None` on invalid JSON / non-object / nested values |
| `json_stringify(m)` | `Map<String, String> -> String` | Serialize map to JSON object. `null`/`true`/`false`/number-looking values are emitted as literals; others as strings |
| `json_get(json, key)` | `String, String -> Option<String>` | Extract top-level scalar value by key. Returns `None` for missing keys or object/array values |
| `json_get_nested(json, path)` | `String, String -> Option<String>` | Traverse a dot-separated path into nested JSON. Array indices by number (e.g. `"items.0.id"`). Objects/arrays returned as JSON strings; scalars as plain strings |
| `json_array_length(json)` | `String -> Option<Int64>` | Length of a JSON array. `None` if not a valid array |
| `json_array_get(json, index)` | `String, Int64 -> Option<String>` | Element at 0-based index. Objects/arrays returned as JSON strings |
| `json_keys(json)` | `String -> Option<List<String>>` | Top-level keys of a JSON object. `None` if not an object |

### 11.11 Network Operations (require `Network` effect)

| Function | Signature | Description |
|----------|-----------|-------------|
| `http_get(url)` | `String -> Result<String, String>` | GET request. `Ok(body)` on 2xx, `Err(msg)` otherwise |
| `http_post(url, body)` | `String, String -> Result<String, String>` | POST with plain-text body |
| `http_request(method, url, headers_json, body)` | `String, String, String, String -> Result<String, String>` | Generic HTTP. `headers_json` is a JSON object of header name→value pairs (use `"{}"` for none). `body` is the request body (`""` for none). Returns `Ok(body)` on 2xx, `Err("HTTP N: ...")` on non-2xx |
| `http_request_full(method, url, headers_json, body)` | `String, String, String, String -> Result<String, String>` | Like `http_request` but always returns `Ok({"status":N,"body":"..."})` even for non-2xx; only fails on network errors |

The `std/http` module wraps these into ergonomic functions: `get`, `post`, `post_json`, `put_json`, `patch_json`, `delete`, `request`, `request_full`, `get_auth`, `post_json_auth`, `get_auth_full`, `post_json_auth_full`.

---

## 12. Self-Healing Test System

Clarity includes a built-in test framework designed for LLM self-correction loops.

### 12.1 Writing Tests

Test functions must:
- Start with the `test_` prefix
- Declare `effect[Test]`
- Take zero parameters
- Return `Unit`

```
function add(a: Int64, b: Int64) -> Int64 { a + b }

effect[Test] function test_add() -> Unit {
  assert_eq(add(2, 3), 5);
  assert_eq(add(0, 0), 0)
}
```

### 12.2 Assertions (require `Test` effect)

| Function | Signature | Description |
|----------|-----------|-------------|
| `assert_eq(actual, expected)` | `Int64, Int64 -> Unit` | Assert integers equal |
| `assert_eq_float(actual, expected)` | `Float64, Float64 -> Unit` | Assert floats equal (epsilon 1e-9) |
| `assert_eq_string(actual, expected)` | `String, String -> Unit` | Assert strings equal |
| `assert_true(condition)` | `Bool -> Unit` | Assert condition is True |
| `assert_false(condition)` | `Bool -> Unit` | Assert condition is False |

### 12.3 Running Tests

```bash
clarityc test file.clarity              # run tests, human-readable output
clarityc test file.clarity --json       # machine-readable JSON output
clarityc test file.clarity --fail-fast  # stop on first failure
```

### 12.4 Failure Output

When a test fails, the output includes structured fields for LLM consumption:
```
[FAIL] test_broken
  assertion_failed: assert_eq
  actual: -1
  expected: 5
  function: test_broken
  fix_hint: "Expected Int64 value 5 but got -1. Check arithmetic logic and edge cases."
```

The `--json` flag outputs machine-parseable JSON with `actual`, `expected`, `function`, `location`, and `fix_hint` fields, enabling a **compile → test → fix** self-healing loop.

---

## 13. Introspection

The compiler provides machine-readable introspection of all language capabilities via the `introspect` command:

```bash
clarityc introspect              # full JSON: builtins, effects, types
clarityc introspect --builtins   # built-in functions with signatures, docs, categories
clarityc introspect --effects    # effects with their associated function lists
clarityc introspect --types      # built-in types
```

Output is JSON designed for LLM consumption. LLMs can query the compiler's capabilities before generating code or proposing extensions.

All built-in functions and effects are defined in a single registry file (`src/registry/builtins-registry.ts`). See `CLAUDE.md` for the contributor protocol for adding new built-ins.

---

## 14. Native Agent and Model Interop (v0.7)

Clarity provides native interop for LLM APIs, MCP tool servers, and A2A agents through
built-in functions, four new effects, and three standard library modules.

### 14.1 New Effects

| Effect | Description |
|--------|-------------|
| `Model` | LLM completion via OpenAI-compatible API |
| `Secret` | Read secrets from environment variables |
| `MCP` | Connect to MCP tool servers and invoke tools |
| `A2A` | Communicate with A2A-protocol agents |

### 14.2 Built-in Functions

#### Secret (Secret effect)

```clarity
get_secret(name: String) -> Option<String>
```
Reads an environment variable. Returns `Some(value)` if set, `None` if absent.

#### LLM (Model effect)

```clarity
call_model(model: String, prompt: String) -> Result<String, String>
call_model_system(model: String, system_prompt: String, user_prompt: String) -> Result<String, String>
list_models() -> List<String>
```

Calls an OpenAI-compatible chat completions endpoint. Reads `OPENAI_API_KEY` from the
environment; set `OPENAI_BASE_URL` to override the endpoint (Ollama, Groq, etc.).

#### MCP (MCP effect)

```clarity
mcp_connect(url: String) -> Result<Int64, String>      // register server, get session handle
mcp_list_tools(session: Int64) -> Result<String, String>  // JSON array of tool schemas
mcp_call_tool(session: Int64, tool: String, args_json: String) -> Result<String, String>
mcp_disconnect(session: Int64) -> Unit
```

HTTP transport only. `args_json` is a JSON object string. The session handle is an opaque `Int64`.
Tool call output is extracted from the MCP `content[].text` array.

#### A2A (A2A effect)

```clarity
a2a_discover(url: String) -> Result<String, String>            // GET /.well-known/agent.json
a2a_submit(url: String, message: String) -> Result<String, String>  // returns task_id
a2a_poll(url: String, task_id: String) -> Result<String, String>   // status JSON
a2a_cancel(url: String, task_id: String) -> Result<String, String> // final status JSON
```

Implements the Google A2A JSON-RPC 2.0 protocol. `a2a_poll` returns a JSON object:
```json
{ "id": "task-id", "status": "submitted|working|completed|failed|canceled", "output": "..." }
```

#### Policy (no effect required)

```clarity
policy_is_url_allowed(url: String) -> Bool
policy_is_effect_allowed(effect_name: String) -> Bool
```

Query the active runtime policy. Both return `True` when no policy is configured.

### 14.3 Standard Library Modules

See Section 10.4 for the full function lists for `std/llm`, `std/mcp`, and `std/a2a`.

#### Quick usage example — LLM

```clarity
module Main
import { prompt, is_ok, unwrap_or } from "std/llm"

effect[Model, FileSystem] function run() -> Unit {
  match prompt("Explain tail calls in one sentence") {
    Ok(answer) -> print_string(answer),
    Err(msg) -> print_string("Error: " ++ msg)
  }
}
```

#### Quick usage example — MCP

```clarity
module Main
import { connect, call_tool, disconnect, unwrap_or } from "std/mcp"

effect[MCP, FileSystem] function run() -> Unit {
  match connect("http://localhost:3000/mcp") {
    Ok(session) -> {
      let result = call_tool(session, "read_file", """{"path":"/etc/hostname"}""");
      disconnect(session);
      print_string(unwrap_or(result, "error"))
    },
    Err(msg) -> print_string("Connect failed: " ++ msg)
  }
}
```

#### Quick usage example — A2A

```clarity
module Main
import { submit, poll, is_done, unwrap_output, unwrap_or } from "std/a2a"

effect[A2A] function ask(url: String, question: String) -> String {
  match submit(url, question) {
    Ok(task_id) -> wait(url, task_id),
    Err(msg) -> "submit failed: " ++ msg
  }
}

effect[A2A] function wait(url: String, task_id: String) -> String {
  match poll(url, task_id) {
    Ok(status) ->
      match is_done(status) {
        True -> unwrap_output(status),
        False -> wait(url, task_id)
      },
    Err(msg) -> "poll failed: " ++ msg
  }
}
```

### 14.4 Runtime Policy and Audit

Policy is configured entirely via environment variables — no code changes required:

| Variable | Purpose |
|----------|---------|
| `CLARITY_ALLOW_HOSTS` | Comma-separated hostname globs allowed for network ops (e.g. `api.openai.com,*.corp`). Empty = allow all. |
| `CLARITY_DENY_EFFECTS` | Comma-separated effect names to block entirely (e.g. `MCP,A2A`). Denied calls return `Err(...)` or `None`. |
| `CLARITY_AUDIT_LOG` | Path to a JSONL file. Every network call appends: `{ timestamp, effect, op, url/tool/model, result, duration_ms }` |

Policy enforcement is transparent — calls fail with descriptive `Err` messages when denied.

---

## 15. Agent Orchestration & RAG (v0.8)

Clarity v0.8 adds three new effects and two standard library modules for building production agentic and retrieval-augmented-generation (RAG) workloads.

### 15.1 Multi-Provider LLM Routing

The `call_model` and `call_model_system` builtins automatically route to the correct provider based on the model name prefix:

- Model names starting with `claude-` → Anthropic Messages API (`/v1/messages`). Set `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_BASE_URL`.
- All other model names → OpenAI-compatible endpoint (`/v1/chat/completions`). Set `OPENAI_API_KEY` and optionally `OPENAI_BASE_URL`.

No Clarity code change is required to switch providers — only the model name and env var change.

### 15.2 Trace Effect

Structured span tracing for observability. Spans are written to the audit log (`CLARITY_AUDIT_LOG`) with duration and inline events.

```clarity
trace_start(op: String) -> Int64        // start a span; returns span_id
trace_end(span_id: Int64) -> Unit       // end span; compute and log duration
trace_log(span_id: Int64, msg: String) -> Unit  // attach an event to an open span
```

```clarity
module Main

effect[Trace, Model] function run() -> Unit {
  let span = trace_start("llm-call");
  trace_log(span, "sending prompt");
  let res = call_model("gpt-4o", "hello");
  trace_end(span)
}
```

### 15.3 Persist Effect

Durable key-value checkpointing backed by the filesystem. Checkpoint files are stored in `CLARITY_CHECKPOINT_DIR` (default `.clarity-checkpoints/`).

```clarity
checkpoint_save(key: String, value: String) -> Result<String, String>
checkpoint_load(key: String) -> Option<String>
checkpoint_delete(key: String) -> Unit
```

### 15.4 Embed Effect

Text embedding and vector similarity for RAG pipelines. `embed_text` calls the configured embeddings API; `cosine_similarity` and `chunk_text` are pure (no network, no effect required).

```clarity
embed_text(text: String) -> Result<String, String>   // JSON float array; requires Embed
cosine_similarity(a_json: String, b_json: String) -> Float64  // pure
chunk_text(text: String, chunk_size: Int64) -> String         // pure; JSON string array
embed_and_retrieve(query: String, chunks_json: String, top_k: Int64) -> Result<String, String>
```

Set `CLARITY_EMBED_MODEL` to choose the model (default `text-embedding-ada-002`).

### 15.5 `std/agent` — Resumable Agent Loop

```clarity
import { run, resume, clear } from "std/agent"
```

- `run(key: String, initial: String, step: (String) -> String) -> Result<String, String>` — Start (or resume from checkpoint) an agent loop. Calls `step(state)` repeatedly, saving state to a checkpoint after each step. Terminates when the returned state JSON contains `"done":true`. Maximum 10 000 steps.
- `resume(key: String, step: (String) -> String) -> Result<String, String>` — Resume from existing checkpoint; returns `Err` if no checkpoint exists.
- `clear(key: String) -> Unit` — Delete the checkpoint for `key`.

State convention: step functions receive and return JSON strings. Signal completion by including `"done":true` in the JSON:

```clarity
module Main
import { run } from "std/agent"

function my_step(state: String) -> String {
  // parse state, do work, return next state
  "{\"done\":true,\"result\":\"hello\"}"
}

effect[Persist] function main() -> Result<String, String> {
  run("my-agent", "{}", my_step)
}
```

### 15.6 `std/rag` — Retrieval-Augmented Generation

```clarity
import { retrieve, chunk, embed, similarity } from "std/rag"
```

- `retrieve(query: String, text: String, chunk_size: Int64, top_k: Int64) -> Result<String, String>` — Full RAG pipeline: split `text` into chunks, embed query and chunks, return top-k most relevant chunks as a JSON string array.
- `chunk(text: String, chunk_size: Int64) -> String` — Split text; returns JSON string array (pure).
- `embed(text: String) -> Result<String, String>` — Embed text; returns JSON float array.
- `similarity(a_json: String, b_json: String) -> Float64` — Cosine similarity between two JSON float arrays (pure).

```clarity
module Main
import { retrieve } from "std/rag"

effect[Embed] function search(doc: String, query: String) -> String {
  match retrieve(query, doc, 512, 3) {
    Ok(chunks_json) -> chunks_json,
    Err(msg) -> "Error: " ++ msg
  }
}
```

### 15.7 `std/eval` — LLM Output Evaluation

```clarity
import { exact, has_match, semantic, judge, pass } from "std/eval"
```

- `exact(got: String, expected: String) -> Bool` — Exact string equality (pure).
- `has_match(got: String, expected: String) -> Bool` — Substring membership (pure).
- `semantic(got: String, expected: String) -> Result<Float64, String>` — Cosine similarity via embeddings; values above ~0.85 indicate semantic equivalence.
- `judge(model: String, prompt: String, response: String, rubric: String) -> Result<String, String>` — Ask a judge LLM to score a response against a rubric. Returns JSON: `{"score": 0.0-1.0, "pass": true/false, "reason": "..."}`.
- `pass(model, prompt, response, rubric) -> Bool` — Convenience: returns `True` when judge score >= 0.7.

```clarity
module Main
import { exact, has_match, judge } from "std/eval"

// Pure checks
function test_exact(resp: String) -> Bool { exact(resp, "Paris") }
function test_contains(resp: String) -> Bool { has_match(resp, "France") }

// LLM-as-judge
effect[Eval] function grade(prompt: String, resp: String) -> Result<String, String> {
  judge("gpt-4o", prompt, resp, "The response must name the capital of France.")
}
```

---

## Appendix A: Complete Grammar

See `docs/grammar.peg` for the formal PEG grammar.

## Appendix B: Example Programs

### B.1 Arithmetic
```
module Math

function factorial(n: Int64) -> Int64 {
  match n <= 1 {
    True -> 1,
    False -> n * factorial(n - 1)
  }
}

function fibonacci(n: Int64) -> Int64 {
  match n <= 1 {
    True -> n,
    False -> {
      let a = fibonacci(n - 1);
      let b = fibonacci(n - 2);
      a + b
    }
  }
}

function max(a: Int64, b: Int64) -> Int64 {
  match a >= b {
    True -> a,
    False -> b
  }
}
```

### B.2 Union Types and Pattern Matching
```
module Shapes

type Shape =
  | Circle(radius: Float64)
  | Rectangle(width: Float64, height: Float64)
  | Triangle(base: Float64, height: Float64)

function area(s: Shape) -> Float64 {
  match s {
    Circle(radius) -> 3.14159265 * radius * radius,
    Rectangle(width, height) -> width * height,
    Triangle(base, height) -> 0.5 * base * height
  }
}
```

### B.3 Effect System
```
module UserService

type User = {
  id: Int64,
  email: String,
}

type AuthResult =
  | Success(token: String)
  | Failure(reason: String)

effect[DB, Log] function authenticate(
  email: String,
  password: String,
) -> AuthResult {
  // Implementation with declared effects
  Success("token_abc")
}

// This would NOT compile — missing DB effect:
// function bad() -> AuthResult { authenticate("a", "b") }
```

### B.4 I/O and CLI Programs
```
module WordCount

function count_chars(s: String, i: Int64, ch: String, acc: Int64) -> Int64 {
  match i >= string_length(s) {
    True -> acc,
    False -> {
      let next = match string_eq(char_at(s, i), ch) {
        True -> acc + 1,
        False -> acc
      };
      count_chars(s, i + 1, ch, next)
    }
  }
}

effect[FileSystem, Log] function main() -> Unit {
  let input = read_all_stdin();
  let spaces = count_chars(input, 0, " ", 0);
  let newlines = count_chars(input, 0, "\n", 0);
  let words = match string_length(input) > 0 {
    True -> spaces + newlines + 1,
    False -> 0
  };
  print_string("words: " ++ int_to_string(words))
}
```

### B.5 Self-Healing Tests
```
module StringUtils

function repeat(s: String, n: Int64) -> String {
  match n <= 0 {
    True -> "",
    False -> s ++ repeat(s, n - 1)
  }
}

effect[Test] function test_repeat() -> Unit {
  assert_eq_string(repeat("ab", 3), "ababab");
  assert_eq_string(repeat("x", 1), "x");
  assert_eq_string(repeat("hi", 0), "");
  assert_eq(string_length(repeat("abc", 4)), 12)
}
```
