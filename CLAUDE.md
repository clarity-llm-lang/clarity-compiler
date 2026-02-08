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

### I/O Primitives
All I/O functions require the `FileSystem` effect.
```
// Read a line from stdin
effect[FileSystem] function get_input() -> String {
  read_line()
}

// Read all of stdin
effect[FileSystem] function slurp() -> String {
  read_all_stdin()
}

// Read/write files
effect[FileSystem] function copy(src: String, dst: String) -> Unit {
  let content = read_file(src);
  write_file(dst, content)
}

// Access command-line arguments
effect[FileSystem] function first_arg() -> String {
  let args = get_args();
  head(args)
}

// Exit with a status code
effect[FileSystem] function bail() -> Unit {
  exit(1)
}
```

Available I/O builtins:
- `read_line() -> String` — read one line from stdin
- `read_all_stdin() -> String` — read all of stdin
- `read_file(path: String) -> String` — read entire file as string
- `write_file(path: String, content: String) -> Unit` — write string to file
- `get_args() -> List<String>` — command-line arguments
- `exit(code: Int64) -> Unit` — exit process with status code

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

### string_to_int / string_to_float return raw values
These functions return `Int64` / `Float64` (0 on parse failure) instead of `Option<T>`. Proper Option return types require generics (Phase 2).

### Mutable binding reassignment not implemented
`let mut` declarations parse and type-check, but there is no assignment operator in the parser or codegen. `let mut x = 1; x = x + 1;` will fail to parse — reassignment syntax does not exist yet.

### No module system (import/export)
The compiler processes a single file at a time. There are no import/export keywords, no file dependency resolution, and no module linking. Programs cannot span multiple `.clarity` files.

### Named arguments are not semantically checked
The parser accepts named arguments (`foo(name: value)`), but the checker ignores the name entirely and matches arguments by position only. Passing arguments in the wrong order with names will silently use positional semantics.

### No generics / parametric polymorphism
List builtins (`head`, `tail`, etc.) are typed as `List<Int64>` placeholders. The checker has no mechanism for generic type parameters on user-defined functions or types.

### No higher-order functions
Functions cannot be passed as arguments or returned from other functions. Without loops, `map`, `filter`, `fold` over lists are essential and require first-class function support.

### No garbage collection
The runtime uses a bump allocator that never frees memory. Every string concatenation, list operation, and constructor call leaks. Programs that run for extended periods will exhaust memory.

## Implementation roadmap

### Phase 1 — Correctness & Soundness (v0.2) ✓ DONE
Make what exists actually correct.
1. ✓ **AST type annotations** — Checker attaches resolved `ClarityType` to AST nodes. Codegen uses these instead of its own `inferExprType()`.
2. ✓ **Fix Option<T> polymorphism** — `Some`/`None` constructors are parameterized per instantiation so `Option<Int64>` and `Option<String>` don't collide.
3. ✓ **Fix `string_to_int`/`string_to_float`** — Changed to return raw Int64/Float64 (0 on failure). Proper Option return deferred to Phase 2 (requires generics).
4. ✓ **Fix record type ambiguity** — Match record literals by field names AND field types for disambiguation.
5. ✓ **Float64 modulo** — Delegates to JS runtime `f64_rem` since WASM has no `f64.rem`.
6. **Mutable reassignment** — Deferred to Phase 2. Add `=` assignment to parser and codegen.

### Phase 1.5 — I/O Primitives (v0.2.1)
Make Clarity usable for real CLI programs before tackling the type system.
1. **stdin/stdout** — `read_line() -> String`, `read_all_stdin() -> String` for reading input.
2. **File I/O** — `read_file(path: String) -> String`, `write_file(path: String, content: String) -> Unit`.
3. **Command-line arguments** — `get_args() -> List<String>` to access argv.
4. **Process control** — `exit(code: Int64) -> Unit`.
5. All I/O functions require `FileSystem` effect.

### Phase 2 — Type System Foundations (v0.3)
Make the type system robust enough for real programs.
1. **Parametric polymorphism / generics** — At minimum for `List<T>`, `Option<T>`, and user-defined generic types.
2. **Proper list builtin typing** — `head : List<T> -> Option<T>`, `tail : List<T> -> List<T>`, etc.
3. **Result<T, E> as built-in** — Reduce boilerplate for error handling.
4. **Higher-order functions** — `map`, `filter`, `fold`. Requires function types as first-class values and closure support.
5. **Type aliases** — `type UserId = Int64` as a distinct type.

### Phase 3 — Module System & Multi-File (v0.4)
Support programs larger than a single file.
1. **Import/export syntax** — `import { User } from "models"`, `export function`.
2. **Module resolution** — File-based or package-based.
3. **Separate compilation** — Compile to individual WASM modules or merge.
4. **Standard library** — `std.string`, `std.math`, `std.list`.

### Phase 4 — Runtime & Performance (v0.5)
Make programs viable beyond demos.
1. **Memory management** — Arena allocator, reference counting, or WASM GC proposal.
2. **Tail call optimization** — Essential since there are no loops. WASM tail-call proposal or trampolining.
3. **Nested record/list codegen** — Records containing lists, lists of records, etc.
4. **String interning** — Deduplicate runtime-created strings.

### Phase 5 — Language Completeness (v0.6+)
1. **Pattern guards and range patterns** — `match x { n if n > 0 -> ... }`.
2. **Named argument semantic checking** — Enforce name matching, not just positional.
3. **Bytes and Timestamp runtime support** — Currently declared but unusable.
4. **Multi-line string literals**.
5. **REPL / browser playground**.

## Project structure
- `src/` — Compiler implementation (TypeScript)
- `src/codegen/runtime.ts` — WASM host runtime (string memory, print, logging)
- `examples/` — Example Clarity programs
- `tests/` — Test suite
- `docs/grammar.peg` — Formal grammar
