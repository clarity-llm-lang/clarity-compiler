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

// Generics
type Queue = { items: List<String> }
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

Available effects: `DB`, `Network`, `Time`, `Random`, `Log`, `FileSystem`

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

## Installation

```bash
git clone https://github.com/clarity-llm-lang/clarity.git
cd clarity
npm install
```

### Compile a `.clarity` file
```bash
npx tsx src/index.ts compile myfile.clarity
```

### Compile and run
```bash
npx tsx src/index.ts run myfile.clarity -f function_name -a arg1 arg2
```

### Other commands
```bash
npx tsx src/index.ts compile myfile.clarity --check-only   # type-check only
npx tsx src/index.ts compile myfile.clarity --emit-wat      # show WASM text format
npx tsx src/index.ts compile myfile.clarity --emit-ast      # show AST as JSON
```

### Run tests
```bash
npm test    # 66 tests across lexer, parser, type checker, and end-to-end
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
Include the [language spec](docs/language-spec.md) in your system prompt or context, then ask the LLM to generate Clarity code. The spec is designed to be compact enough to fit in a single context window.

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
│   ├── codegen/            # WASM code generation via binaryen
│   └── errors/             # Diagnostics and error formatting
├── docs/
│   ├── language-spec.md    # Full language specification
│   └── grammar.peg         # Formal PEG grammar
├── examples/               # Example Clarity programs
└── tests/                  # 66 tests
```

---

## Current Status

**Working (Milestones 0–3):**
- Int64 and Float64 arithmetic
- Boolean logic and comparisons
- Pattern matching on booleans and union types
- Exhaustiveness checking
- Let bindings (immutable and mutable)
- Blocks with multiple statements
- Recursive function calls
- Effect system with compile-time enforcement
- Record and union type declarations
- String literals, concatenation, and equality in WASM linear memory
- Built-in functions (print, logging) via host runtime
- WASM compilation and execution
- LLM-friendly error messages with migration hints

**Planned:**
- Record/union values in linear memory
- Standard library (Option, Result, List operations)
- Module imports
- Higher-order functions

---

## License

MIT
