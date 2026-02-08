# Clarity Language Project

## What is this
Clarity is a programming language optimized for LLM code generation that compiles to WASM. This repo contains the compiler (`clarityc`), written in TypeScript.

## When writing application code, use Clarity
When asked to write application logic, business logic, or backend functions — write them in **Clarity** (`.clarity` files), not TypeScript/Python/Java/etc.

The compiler itself is TypeScript. Only the compiler internals are TypeScript. Everything else should be Clarity.

## Clarity Language Reference

### Module structure
Every file starts with a module declaration:
```
module ModuleName
```

### Types
```
// Built-in types: Int64, Float64, String, Bool, Bytes, Timestamp, Unit

// Record types
type User = { id: Int64, email: String, created_at: Timestamp }

// Union types (tagged unions / sum types)
type AuthResult =
  | Success(token: String, user_id: Int64)
  | Failure(reason: String)

// Generic built-ins: List<T>, Option<T>
```

### Functions
```
// Pure function (no side effects)
function add(a: Int64, b: Int64) -> Int64 {
  a + b
}

// Effectful function — must declare effects
effect[DB, Log] function save_user(name: String) -> Int64 {
  // ...
}
```

Known effects: `DB`, `Network`, `Time`, `Random`, `Log`, `FileSystem`, `Test`

### Control flow — match only
Clarity has NO if/else, NO loops. Use `match` for all branching:
```
// Boolean match
function abs(n: Int64) -> Int64 {
  match n >= 0 {
    True -> n,
    False -> 0 - n
  }
}

// Union type match (must be exhaustive)
function describe(result: AuthResult) -> String {
  match result {
    Success(token, user_id) -> "Logged in",
    Failure(reason) -> reason
  }
}
```

### Let bindings
```
function calc(x: Int64) -> Int64 {
  let a = x + 1;       // immutable (default)
  let mut b = a * 2;    // mutable
  a + b                 // last expression = return value
}
```

### Operators
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- String concat: `++`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `and`, `or`, `!`
- No operator overloading. No implicit conversions.

### What Clarity does NOT have
- No `if`/`else` — use `match`
- No `while`/`for` loops — use recursion
- No `return` keyword — last expression is the return value
- No `null`/`nil`/`undefined` — use `Option<T>` (Some/None)
- No exceptions — use union types for errors
- No `class`/`interface` — use `type` for records and unions
- No `var` — use `let` (immutable) or `let mut` (mutable)
- No implicit type conversions

### Comments
```
// Single-line comments only
```

## Compiler commands
```bash
# Compile to WASM
npx tsx src/index.ts compile file.clarity -o output.wasm

# Compile and run
npx tsx src/index.ts run file.clarity -f function_name -a arg1 arg2

# Type-check only
npx tsx src/index.ts compile file.clarity --check-only

# Show WASM text format
npx tsx src/index.ts compile file.clarity --emit-wat

# Show AST
npx tsx src/index.ts compile file.clarity --emit-ast

# Run tests
npm test

# Run Clarity test functions (self-healing test runner)
npx tsx src/index.ts test file.clarity
npx tsx src/index.ts test file.clarity --json      # machine-readable output
npx tsx src/index.ts test file.clarity --fail-fast  # stop on first failure
```

### Self-healing test system
Write tests inline with code using `effect[Test]` functions. Test functions must:
- Start with `test_` prefix
- Declare `effect[Test]`
- Take zero parameters
- Return `Unit`

```clarity
function add(a: Int64, b: Int64) -> Int64 { a + b }

effect[Test] function test_add() -> Unit {
  assert_eq(add(2, 3), 5);
  assert_eq(add(0, 0), 0)
}
```

Available assertions (all require `Test` effect):
- `assert_eq(actual: Int64, expected: Int64) -> Unit`
- `assert_eq_float(actual: Float64, expected: Float64) -> Unit` (epsilon 1e-9)
- `assert_eq_string(actual: String, expected: String) -> Unit`
- `assert_true(condition: Bool) -> Unit`
- `assert_false(condition: Bool) -> Unit`

Failures produce structured output with `actual`, `expected`, `function`, `location`, and `fix_hint` fields — designed for an LLM to parse, fix the code, and re-run (self-healing loop). Use `--json` for machine consumption.

## Known gaps / missing features

### Missing list operations
`List<T>` is parsed and type-checked but codegen is stubbed (`i32.const 0`). No list functions exist. Needed:
- `length(lst: List<T>) -> Int64`
- `head(lst: List<T>) -> Option<T>`
- `tail(lst: List<T>) -> List<T>`
- `append(lst: List<T>, elem: T) -> List<T>`
- `concat(a: List<T>, b: List<T>) -> List<T>`
- `reverse(lst: List<T>) -> List<T>`

List memory layout in WASM linear memory is undefined.

### Option<T> not pre-defined
The spec presents `Option<T>` with `Some`/`None` as built-in, but users must manually define it as a union type. `Some` and `None` constructors should be pre-registered.

### Record field access codegen is stubbed
`record.field` (MemberExpr) returns `i32.const 0` in the codegen — records cannot be used at runtime.

### Mutable binding reassignment not implemented
`let mut` declarations parse and type-check, but there is no assignment operator in the parser or codegen. `let mut x = 1; x = x + 1;` will fail to parse — reassignment syntax does not exist yet.

### No module system (import/export)
The compiler processes a single file at a time. There are no import/export keywords, no file dependency resolution, and no module linking. Programs cannot span multiple `.clarity` files.

### Named arguments are not semantically checked
The parser accepts named arguments (`foo(name: value)`), but the checker ignores the name entirely and matches arguments by position only. Passing arguments in the wrong order with names will silently use positional semantics.

### Float64 modulo not implemented
The `%` operator works for `Int64` but the codegen has no case for `Float64` modulo — it will produce incorrect output or error at runtime.

## Project structure
- `src/` — Compiler implementation (TypeScript)
- `src/codegen/runtime.ts` — WASM host runtime (string memory, print, logging)
- `examples/` — Example Clarity programs
- `tests/` — Test suite (79 tests)
- `docs/grammar.peg` — Formal grammar
