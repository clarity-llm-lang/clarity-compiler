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
| Constructor | `VariantName(field1, field2)` | Union variant, binding fields |
| Constructor (unit) | `VariantName` (uppercase, no parens) | Unit variant |

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

## 10. Error Model

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

### 11.4 Type Conversions

| Function | Signature | Description |
|----------|-----------|-------------|
| `int_to_float(n)` | `Int64 -> Float64` | Integer to float |
| `float_to_int(n)` | `Float64 -> Int64` | Float to integer (truncates) |
| `int_to_string(n)` | `Int64 -> String` | Integer to string |
| `float_to_string(n)` | `Float64 -> String` | Float to string |
| `string_to_int(s)` | `String -> Int64` | Parse string to integer (0 on failure) |
| `string_to_float(s)` | `String -> Float64` | Parse string to float (0.0 on failure) |

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
