# Clarity Language Project

## What is this
Clarity is a programming language optimized for LLM code generation that compiles to WASM. This repo contains the compiler (`clarityc`), written in TypeScript.

## When writing application code, use Clarity
Write application logic, business logic, and backend functions in **Clarity** (`.clarity` files), not TypeScript/Python/Java/etc.

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

// Generic built-ins: List<T>, Option<T>, Result<T, E>

// Type aliases (transparent)
type UserId = Int64
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

// Pattern guards — add conditions to patterns
function classify(n: Int64) -> String {
  match n {
    x if x > 100 -> "large",
    x if x > 0 -> "small",
    _ -> "non-positive"
  }
}

// Range patterns — match Int64 values in a range (inclusive)
function grade(score: Int64) -> String {
  match score {
    90..100 -> "A",
    80..89 -> "B",
    70..79 -> "C",
    _ -> "F"
  }
}
```

### Let bindings and assignment
```
function calc(x: Int64) -> Int64 {
  let a = x + 1;       // immutable (default)
  let mut b = a * 2;    // mutable
  b = b + 1;            // reassignment (only for let mut)
  a + b                 // last expression = return value
}
```

### Operators
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- String concat: `++`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `and`, `or`, `!`
- No operator overloading. No implicit conversions.

### Higher-order functions
Functions can be passed as arguments using function type syntax:
```
function double(x: Int64) -> Int64 { x * 2 }
function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
function result() -> Int64 { apply(double, 5) }  // returns 10
```

### Generics (parametric polymorphism)
Functions and types can have type parameters. Types are inferred at call sites:
```
function identity<T>(x: T) -> T { x }
function first<A, B>(a: A, b: B) -> A { a }

identity(42)          // T = Int64
identity("hello")     // T = String
first(1, "x")         // A = Int64, B = String

type Wrapper<T> = { value: T }
```

List builtins are generic: `head(xs)` returns the element type of the list.

### What Clarity does NOT have
- No `if`/`else` — use `match`
- No `while`/`for` loops — use recursion
- No `return` keyword — last expression is the return value
- No `null`/`nil`/`undefined` — use `Option<T>` (Some/None)
- No exceptions — use `Result<T, E>` (Ok/Err)
- No `class`/`interface` — use `type` for records and unions
- No `var` — use `let` (immutable) or `let mut` (mutable)
- No implicit type conversions
- No lambdas/closures (yet) — pass named functions only

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
## Clarity language syntax
See `docs/clarity-quickref.md` for the compact language reference (syntax, types, builtins, what's missing).
See `docs/language-spec.md` for the full formal specification.

## Compiler commands
```bash
# Compile to WASM
npx clarityc compile file.clarity -o output.wasm

# Compile and run
npx clarityc run file.clarity -f function_name -a arg1 arg2

# Type-check only
npx clarityc compile file.clarity --check-only

# Show WASM text format / AST
npx clarityc compile file.clarity --emit-wat
npx clarityc compile file.clarity --emit-ast

# Run compiler tests
npm test

# Run Clarity test functions (self-healing test runner)
npx clarityc test file.clarity
npx clarityc test file.clarity --json      # machine-readable output
npx clarityc test file.clarity --fail-fast  # stop on first failure

# Introspect language capabilities (JSON output for LLM consumption)
npx clarityc introspect              # all capabilities
npx clarityc introspect --builtins   # built-in functions only
npx clarityc introspect --effects    # effects only
npx clarityc introspect --types      # built-in types only
```

## Self-healing test system
Test functions must: start with `test_` prefix, declare `effect[Test]`, take zero parameters, return `Unit`.

```clarity
function add(a: Int64, b: Int64) -> Int64 { a + b }

effect[Test] function test_add() -> Unit {
  assert_eq(add(2, 3), 5);
  assert_eq(add(0, 0), 0)
}
```

Assertions (all require `Test` effect): `assert_eq` (Int64), `assert_eq_float` (Float64, epsilon 1e-9), `assert_eq_string` (String), `assert_true` (Bool), `assert_false` (Bool).

Failures produce structured output with `actual`, `expected`, `function`, `location`, and `fix_hint` fields. Use `--json` for machine consumption.

## Known gaps / missing features

### string_to_int / string_to_float return raw values
These functions return `Int64` / `Float64` (0 on parse failure) instead of `Option<T>`. Proper Option return types require generics (Phase 2).

### No module system (import/export)
The compiler processes a single file at a time. There are no import/export keywords, no file dependency resolution, and no module linking. Programs cannot span multiple `.clarity` files.

### No lambdas or closures
Named functions can be passed as arguments, but there are no anonymous functions (lambdas) or closures. Functions cannot capture variables from enclosing scope.

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
6. ✓ **Mutable reassignment** — `let mut x = 1; x = x + 1;` now works. Parser, checker (mutability + type validation), and codegen all implemented.

### Phase 1.5 — I/O Primitives (v0.2.1)
Make Clarity usable for real CLI programs before tackling the type system.
1. **stdin/stdout** — `read_line() -> String`, `read_all_stdin() -> String` for reading input.
2. **File I/O** — `read_file(path: String) -> String`, `write_file(path: String, content: String) -> Unit`.
3. **Command-line arguments** — `get_args() -> List<String>` to access argv.
4. **Process control** — `exit(code: Int64) -> Unit`.
5. All I/O functions require `FileSystem` effect.

### Phase 2 — Type System Foundations (v0.3)
Make the type system robust enough for real programs.
1. ✓ **Parametric polymorphism / generics** — Type parameters on functions (`function identity<T>(x: T) -> T`) and types (`type Wrapper<T> = { value: T }`). Type inference at call sites. Monomorphization in codegen.
2. ✓ **Proper list builtin typing** — `head : List<T> -> T`, `tail : List<T> -> List<T>`, `append : (List<T>, T) -> List<T>`, etc. All list builtins are now generic.
3. ✓ **Result<T, E> as built-in** — `Ok`/`Err` polymorphic constructors with type inference. Pattern matching with exhaustiveness checking.
4. ✓ **Higher-order functions** — Function types `(T) -> U` as parameters, function references, `call_indirect`. Named functions can be passed as values. Lambdas/closures deferred.
5. ✓ **Type aliases** — `type UserId = Int64` as transparent aliases. Distinct (opaque) aliases deferred.

### Phase 3 — Module System & Multi-File (v0.4)
Support programs larger than a single file.
1. **Import/export syntax** — `import { User } from "models"`, `export function`.
2. **Module resolution** — File-based or package-based.
3. **Separate compilation** — Compile to individual WASM modules or merge.
4. **Standard library** — `std.string`, `std.math`, `std.list`.

### Phase 4 — Runtime & Performance (v0.5)
Make programs viable beyond demos.
1. **Memory management** — Arena allocator, reference counting, or WASM GC proposal.
2. ✓ **Tail call optimization** — Self-recursive tail calls are converted to loops in WASM codegen. Handles tail position in match arms and block results.
3. ✓ **Nested record/list codegen** — `list_append_i32` for pointer-type elements (e.g., List<String>). Supports lists of records, records containing lists.
4. **String interning** — Deduplicate runtime-created strings.

### Phase 5 — Language Completeness (v0.6+)
1. ✓ **Pattern guards** — `match x { n if n > 0 -> "positive", _ -> "non-positive" }`. Guards work on wildcard, binding, literal, and constructor patterns including multiple arms for the same variant with different guards.
2. ✓ **Named argument semantic checking** — Named args validated and reordered to match parameter order.
3. ✓ **Multi-line string literals** — Triple-quote `"""..."""` strings with optional leading newline stripping.
4. **Bytes and Timestamp runtime support** — Currently declared but unusable.
5. ✓ **Range patterns** — `match x { 1..10 -> ..., _ -> ... }`. Inclusive on both ends, Int64 only. Works with guards.
6. **REPL / browser playground**.
- `string_to_int`/`string_to_float` return raw values (0 on failure) instead of `Option<T>`
- No module system — single file at a time, no import/export
- Named arguments are not semantically checked — positional only
- No lambdas or closures — pass named functions only
- No garbage collection — bump allocator, programs leak memory over time

## Workflow rules

### Documentation must stay in sync
After every implementation task, check and update these files if affected:
- `README.md` — Current status, roadmap, test count, feature list
- `docs/language-spec.md` — Language specification
- `docs/clarity-quickref.md` — Quick reference for LLM code generation
- `docs/grammar.peg` — Formal grammar and built-in function inventory

### Trunk-based development
1. Work on a short-lived feature branch
2. Commit with a clear message describing the change
3. Push and create a PR immediately after completing each major task
4. Merge promptly — do not let branches live long

### Test discipline
- Run `npm test` before every commit
- All tests must pass before pushing
- Add e2e tests for every new feature or builtin

## Extending the compiler

### Discovering current capabilities
Before adding features, query what already exists:
```bash
npx clarityc introspect --builtins   # all built-in functions with signatures and docs
npx clarityc introspect --effects    # all effects with their function lists
```

### Adding a new built-in function
1. **Registry entry** — Add to `CLARITY_BUILTINS` in `src/registry/builtins-registry.ts`
   - Specify: name, params, returnType, effects, doc, category
   - If a new effect is needed, also add to `EFFECT_DEFINITIONS`
2. **Runtime implementation** — Add the JS function in `src/codegen/runtime.ts`
   - Use `readString(ptr)` / `writeString(str)` for string handling
   - Use `BigInt` for Int64, `number` for Float64/Bool
3. **WASM import** (only if new parameter shape) — Add to `src/codegen/builtins.ts`
   - Most functions follow existing patterns; only needed for novel param/result combos
4. **Test** — Add an e2e test in `tests/`
5. **Verify** — `npm test` and `npx clarityc introspect --builtins`

### Adding a new effect
1. Add to `EFFECT_DEFINITIONS` in `src/registry/builtins-registry.ts`
2. Add built-in functions for the effect (see above)
3. The checker and introspection derive from the registry automatically

## Project structure
- `src/` — Compiler implementation (TypeScript)
- `src/registry/builtins-registry.ts` — Single source of truth for built-in functions and effects
- `src/codegen/runtime.ts` — WASM host runtime (string memory, print, logging)
- `src/codegen/builtins.ts` — WASM import declarations (codegen internals)
- `examples/` — Example Clarity programs
- `tests/` — Test suite
- `docs/grammar.peg` — Formal grammar
- `docs/language-spec.md` — Full language specification
- `docs/clarity-quickref.md` — Compact language reference for LLM code generation
