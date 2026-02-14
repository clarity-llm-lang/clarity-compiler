<p align="center">
  <img src="assets/clarity-logo.svg" alt="Clarity" width="480">
</p>

<p align="center">
  <strong>A programming language designed for LLM code generation.</strong>
</p>

---

Clarity is a statically typed, compiled language that optimizes for what matters when an LLM writes code: **correctness on first generation**. It compiles to WebAssembly.

```
module Example

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
```

```bash
$ clarityc compile fibonacci.clarity
Compiled fibonacci.clarity -> fibonacci.wasm (116 bytes)

$ clarityc run fibonacci.clarity -f fibonacci -a 10
55
```

---

## Why Clarity?

Every mainstream language was designed for **humans** to write. Clarity is designed for **LLMs** to write.

When an LLM generates Python, JavaScript, or Java, it must choose between dozens of ways to express the same logic — and every choice is a chance to introduce a bug. Clarity eliminates these choices.

### The problem with existing languages

| Issue | Python | JavaScript | Java | Clarity |
|-------|--------|-----------|------|---------|
| Ways to write a conditional | `if`, `elif`, ternary, `match` | `if`, `switch`, ternary, `??` | `if`, `switch`, ternary | `match` (one way) |
| Null/undefined handling | `None` + crashes | `null` + `undefined` + crashes | `null` + NullPointerException | No null. `Option<T>` enforced at compile time |
| Error handling | Exceptions (easy to forget) | Exceptions + callbacks + Promise rejection | Checked + unchecked exceptions | Union types. Compiler enforces handling |
| Side effects | Invisible | Invisible | Invisible | Declared in function signature, compiler-enforced |
| Type coercion | `"5" + 3 = "53"` | `"5" + 3 = "53"` | String concat rules | No implicit conversions. Compile error |
| Mutable state | Default | Default | Default | Immutable by default |

### What this means for LLM-generated code

**Fewer tokens generated** — Clarity is more compact than Java and has less boilerplate than Python. Fewer tokens = lower cost per generation, lower latency, and fewer chances to hallucinate.

**Higher first-pass accuracy** — One syntax for branching (`match`), mandatory exhaustiveness checking, no null, no forgotten error handling. The compiler catches what the LLM gets wrong.

**Faster feedback loops** — Compilation is near-instant. The LLM generates code, the compiler validates it in milliseconds, and errors are specific and actionable ("missing pattern for variant `Failure`" rather than a runtime stack trace).

**Deterministic behavior** — No implicit conversions, no hidden state, no undefined behavior. What the LLM writes is what runs.

---

## Language Overview

### Types
```
// Built-in: Int64, Float64, String, Bool, Bytes, Unit

// Record types
type User = {
  id: Int64,
  email: String,
  active: Bool,
}

// Union types (tagged unions)
type Result =
  | Ok(value: Int64)
  | Error(reason: String)

// Generics (on types and functions)
type Wrapper<T> = { value: T }
function identity<T>(x: T) -> T { x }
```

### Functions
```
// Pure function — no side effects allowed
function square(n: Int64) -> Int64 {
  n * n
}

// Effectful function — side effects declared explicitly
effect[DB, Log] function save_user(name: String, email: String) -> Int64 {
  // The compiler ensures:
  // - This function CAN access DB and Log
  // - Pure functions CANNOT call this function
  // - Callers must declare at least [DB, Log] in their effects
  42
}
```

### Pattern Matching (the only control flow)
```
// Boolean branching
function abs(n: Int64) -> Int64 {
  match n >= 0 {
    True -> n,
    False -> 0 - n
  }
}

// Union type destructuring — compiler enforces all variants are handled
function describe(r: Result) -> String {
  match r {
    Ok(value) -> "success",
    Error(reason) -> reason
  }
}
// Forgetting a variant = compile error
```

### Immutable by Default
```
let x = 42;         // immutable
let mut y = 0;       // explicitly mutable
y = y + 1;           // reassignment allowed for let mut
```

### No Null, No Exceptions
```
// Instead of null → Option type
// Instead of exceptions → union types with error variants

type FetchResult =
  | Data(payload: String)
  | NotFound
  | NetworkError(message: String)

// The compiler forces you to handle ALL cases
function handle(r: FetchResult) -> String {
  match r {
    Data(payload) -> payload,
    NotFound -> "not found",
    NetworkError(message) -> message
  }
}
```

---

## Effect System

Clarity tracks side effects at compile time. A pure function cannot call an effectful one:

```
effect[DB] function read_user(id: Int64) -> String { ... }

// COMPILE ERROR:
// Function requires effects [DB] but caller only declares [none]
// help: Add the missing effects: effect[DB]
function bad() -> String {
  read_user(1)
}

// OK:
effect[DB] function good() -> String {
  read_user(1)
}
```

Available effects: `DB`, `Network`, `Time`, `Random`, `Log`, `FileSystem`, `Test`

---

## Error Messages Designed for LLMs

When an LLM accidentally uses a construct from another language, Clarity tells it exactly what to do instead:

```
error: Clarity does not have 'if' expressions
  --> app.clarity:5:3
   = help: Use 'match' for conditional logic:
           match condition { True -> ..., False -> ... }

error: Clarity does not have 'return'
  --> app.clarity:8:3
   = help: The last expression in a block is the return value

error: Clarity does not have 'null'
  --> app.clarity:3:12
   = help: Use Option type: Some(value) or None

error: Clarity does not have exceptions ('try')
  --> app.clarity:10:3
   = help: Use Result type: Ok(value) or Error(reason)
```

These messages are concise, actionable, and optimized for LLM self-correction.

---

## Self-Healing Test System

Clarity includes a built-in test framework designed for LLM self-correction. Write tests inline with your code using `effect[Test]` functions:

```
module Math

function add(a: Int64, b: Int64) -> Int64 { a + b }

effect[Test] function test_add() -> Unit {
  assert_eq(add(2, 3), 5);
  assert_eq(add(0, 0), 0);
  assert_eq(add(-1, 1), 0)
}
```

```bash
$ clarityc test math.clarity
[PASS] test_add (3 assertions)

1 tests, 1 passed, 0 failed
```

When tests fail, the output is structured for LLM consumption:

```
[FAIL] test_broken
  assertion_failed: assert_eq
  actual: -1
  expected: 5
  function: test_broken
  fix_hint: "Expected Int64 value 5 but got -1. Check arithmetic logic and edge cases."
```

The `--json` flag outputs machine-parseable JSON, enabling a **compile → test → fix** self-healing loop where the LLM reads structured failures, modifies the code, and re-runs until all tests pass.

Available assertions: `assert_eq` (Int64), `assert_eq_float` (Float64), `assert_eq_string` (String), `assert_true` (Bool), `assert_false` (Bool). All require `effect[Test]`.

---

## Installation

```bash
git clone https://github.com/clarity-llm-lang/clarity.git
cd clarity
npm install
```

### Compile a `.clarity` file
```bash
npx clarityc compile myfile.clarity
```

### Compile and run
```bash
npx clarityc run myfile.clarity -f function_name -a arg1 arg2
```

### Run inline tests (self-healing test runner)
```bash
npx clarityc test myfile.clarity            # run test functions
npx clarityc test myfile.clarity --json      # machine-readable output
npx clarityc test myfile.clarity --fail-fast  # stop on first failure
```

### Introspect language capabilities (for LLM consumption)
```bash
npx clarityc introspect              # full JSON: builtins, effects, types
npx clarityc introspect --builtins   # built-in functions with signatures and docs
npx clarityc introspect --effects    # effects with their function lists
npx clarityc introspect --types      # built-in types
```

### Other commands
```bash
npx clarityc compile myfile.clarity --check-only   # type-check only
npx clarityc compile myfile.clarity --emit-wat      # show WASM text format
npx clarityc compile myfile.clarity --emit-ast      # show AST as JSON
```

### Run compiler tests
```bash
npm test    # 187 tests across lexer, parser, type checker, and end-to-end
```

---

## Using Clarity with LLMs

### With Claude Code
Add to your project's `CLAUDE.md`:
```
Write all application code in the Clarity language.
Language spec: /path/to/clarity/docs/language-spec.md
Compile: npx tsx /path/to/clarity/src/index.ts compile <file>
```

Then just describe what you want. Claude will write Clarity.

### With any LLM
Include the [quick reference](docs/clarity-quickref.md) in your system prompt or context, then ask the LLM to generate Clarity code. The quickref is ~100 lines and designed for minimal token usage. For the full formal spec, see [language-spec.md](docs/language-spec.md).

### Extending Clarity (for LLMs)
Clarity is designed to be extended by LLMs. The `introspect` command lets any LLM discover current capabilities as JSON, and the [contributor protocol in CLAUDE.md](CLAUDE.md#extending-the-compiler) describes how to add new built-in functions (2-file edit) or new effects. All built-in functions and effects are defined in a single registry (`src/registry/builtins-registry.ts`).

---

## Compilation Target

Clarity compiles to **WebAssembly (WASM)** — a portable, sandboxed binary format that runs:

- In **Node.js** (built-in `WebAssembly` API)
- In **any browser** (Chrome, Firefox, Safari, Edge)
- In **standalone runtimes** (Wasmtime, Wasmer, WasmEdge)
- On **edge platforms** (Cloudflare Workers, Fastly Compute)

Compiled output is small. The fibonacci example compiles to **116 bytes**.

---

## Project Structure

```
clarity/
├── src/
│   ├── index.ts            # CLI entry point
│   ├── compiler.ts         # Pipeline: lex → parse → check → codegen
│   ├── lexer/              # Tokenizer
│   ├── parser/             # Recursive descent + Pratt parser
│   ├── checker/            # Type checker, effect system, exhaustiveness
│   ├── registry/           # Built-in function & effect registry (single source of truth)
│   ├── codegen/            # WASM code generation via binaryen
│   └── errors/             # Diagnostics and error formatting
├── docs/
│   ├── language-spec.md    # Full language specification
│   └── grammar.peg         # Formal PEG grammar
├── examples/               # Example Clarity programs
└── tests/                  # 187 tests
```

---

## Current Status (v0.2)

**Working:**
- Int64 and Float64 arithmetic (including Float64 modulo)
- Boolean logic and comparisons
- Pattern matching on booleans and union types
- Exhaustiveness checking
- Let bindings (immutable and mutable) with reassignment for `let mut`
- Blocks with multiple statements
- Recursive function calls
- Effect system with compile-time enforcement
- Record types — declaration, construction, field access
- Union types — constructors, pattern matching, destructuring
- Option<T> as built-in (Some/None with correct polymorphism)
- Result<T, E> as built-in (Ok/Err with polymorphic type inference)
- Transparent type aliases (`type UserId = Int64`)
- List literals, length, head, tail, append, concat, reverse, is_empty, nth
- String literals, concatenation, equality, length, substring, char_at, contains, index_of, trim, split
- Named argument validation and reordering
- Type conversions (int_to_float, float_to_int, int_to_string, etc.)
- Math builtins (abs_int, min_int, max_int, sqrt, pow, floor, ceil)
- Built-in functions (print, logging) via host runtime
- I/O primitives: `read_line`, `read_all_stdin`, `read_file`, `write_file`, `get_args`, `exit`
- Higher-order functions (pass named functions as arguments, function type syntax)
- Parametric polymorphism / generics on functions and types (`function identity<T>(x: T) -> T`)
- Properly typed generic list builtins (`head : List<T> -> T`, `tail : List<T> -> List<T>`, etc.)
- Tail call optimization (self-recursive functions compiled to loops)
- Self-healing test system (assert_eq, assert_true, etc. with structured LLM-friendly output)
- WASM compilation and execution
- LLM-friendly error messages with migration hints

---

## Roadmap

Development follows a phased approach. Each phase builds on the previous one.

### Phase 1 — Correctness & Soundness (v0.2) -- DONE
Fix correctness bugs in the type system and codegen so that existing features actually work reliably.
- AST carries resolved types from the checker into codegen (no duplicate type inference)
- Option<T> polymorphism fixed (Option<Int64> and Option<String> coexist)
- Record literal type matching uses declared type names
- Float64 modulo operator
- string_to_int / string_to_float return proper Option-tagged values

### Phase 1.5 — I/O Primitives (v0.2.1) -- DONE
Make Clarity usable for real CLI programs.
- stdin/stdout: `read_line()`, `read_all_stdin()`
- File I/O: `read_file(path)`, `write_file(path, content)`
- Command-line arguments: `get_args() -> List<String>`
- Process control: `exit(code)`

### Phase 2 — Type System Foundations (v0.3)
Make the type system robust enough for real programs.
- ~~Parametric polymorphism / generics~~ (done — `function identity<T>(x: T) -> T` with monomorphization)
- ~~Properly typed list builtins~~ (done — `head : List<T> -> T`, `tail : List<T> -> List<T>`, etc.)
- ~~Built-in `Result<T, E>` type~~ (done — `Ok`/`Err` constructors with polymorphic type inference)
- ~~Type aliases~~ (done — transparent: `type UserId = Int64`)
- ~~Higher-order functions~~ (done — named functions as values via `(T) -> U` type syntax and `call_indirect`)
- ~~Mutable binding reassignment~~ (done — `let mut x = 1; x = x + 1` works)

### Phase 3 — Module System (v0.4)
Support programs larger than a single file.
- Import/export syntax
- File-based module resolution
- Standard library (`std.string`, `std.math`, `std.list`)

### Phase 4 — Runtime & Performance (v0.5)
Make programs viable for real workloads.
- Memory management (arena, refcounting, or WASM GC)
- ~~Tail call optimization~~ (done — self-recursive tail calls converted to loops)
- String interning

### Phase 5 — Language Completeness (v0.6+)
- Pattern guards and range patterns
- ~~Named argument semantic checking~~ (done — named args validated and reordered)
- Bytes and Timestamp runtime support
- REPL / browser playground

---

## License

MIT
