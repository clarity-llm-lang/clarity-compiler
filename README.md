<p align="center">
  <img src="assets/clarity-logo.svg" alt="Clarity" width="480">
</p>

<p align="center">
  <strong>A programming language designed for LLM code generation.</strong><br>
  Statically typed · Compiles to WASM · MCP · Agents
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/version-0.9.0-green.svg" alt="Version">
  <img src="https://img.shields.io/badge/tests-379%20passing-brightgreen.svg" alt="Tests">
  <img src="https://img.shields.io/badge/target-WebAssembly-purple.svg" alt="Target: WASM">
</p>

---

Clarity is a statically typed language that compiles to WebAssembly, optimized for one thing: **LLMs generating correct code on the first attempt**. It eliminates the ambiguities and footguns that cause LLM-generated code to fail, and ships first-class support for the workloads LLMs are most often used for — MCP services, agents, and RAG pipelines.

```
module Greeter

function greet(name: String) -> String {
  "Hello, " ++ name ++ "!"
}

effect[Test] function test_greet() -> Unit {
  assert_eq_string(greet("World"), "Hello, World!")
}
```

```bash
$ clarityc run greeter.clarity -f greet -a '"World"'
Hello, World!
```

---

## Installation

```bash
npm install -g clarity-lang
```

This installs `clarityc` globally. No `npx` needed.

```bash
clarityc --version    # 0.9.0
clarityc --help
```

To build from source:

```bash
git clone https://github.com/clarity-llm-lang/clarity-compiler.git
cd clarity-compiler
npm install -g .
```

---

## Quick Start

```bash
# Compile the single .clarity file in the current directory
clarityc compile

# Run it (calls main() by default)
clarityc run

# Run with a specific function and arguments
clarityc run myfile.clarity -f fibonacci -a 10

# Type-check only
clarityc compile --check-only

# Introspect all capabilities as JSON (great for LLM context)
clarityc introspect
```

---

## Why Clarity?

Every mainstream language was designed for **humans** to write. Clarity is designed for **LLMs** to write.

When an LLM generates Python or JavaScript it must choose between dozens of ways to express the same logic — every choice is a chance to introduce a bug. Clarity removes those choices.

| Problem | Other languages | Clarity |
|---------|----------------|---------|
| Ways to branch | `if`, ternary, `switch`, `??` | `match` — one way |
| Null handling | `null` + runtime crashes | No null — `Option<T>` enforced at compile time |
| Error handling | Exceptions (easy to forget) | `Result<T, E>` — compiler enforces handling |
| Side effects | Invisible | Declared in the function signature, compiler-enforced |
| Type coercion | `"5" + 3 = "53"` | No implicit conversions — compile error |

The compiler catches what the LLM gets wrong. Error messages are written to explain Clarity idioms to a model that defaults to another language:

```
error: Clarity does not have 'if' expressions
  --> app.clarity:5:3
   = help: Use 'match' for conditional logic:
           match condition { True -> ..., False -> ... }

error: Clarity does not have 'null'
  --> app.clarity:3:12
   = help: Use Option type: Some(value) or None
```

---

## Language Overview

### Types

```
// Built-in: Int64, Float64, String, Bool, Bytes, Timestamp, Unit
// Generic:  List<T>, Option<T>, Result<T, E>, Map<K, V>

// Record types
type User = { id: Int64, email: String, active: Bool }

// Union types (tagged unions)
type Response =
  | Success(data: String)
  | NotFound
  | Error(reason: String)

// Generics
type Wrapper<T> = { value: T }
function identity<T>(x: T) -> T { x }
```

### Control flow — `match` only

```
function grade(score: Int64) -> String {
  match score {
    90..100 -> "A",
    80..89  -> "B",
    70..79  -> "C",
    _       -> "F"
  }
}

// Union destructuring — exhaustiveness is compile-enforced
function describe(r: Response) -> String {
  match r {
    Success(data)  -> data,
    NotFound       -> "not found",
    Error(reason)  -> reason
  }
}
// Forgetting a variant = compile error
```

No `if`/`else`. No `for`/`while`. The LLM always writes it the same way.

### Effect system

Every I/O capability is declared in the function signature and checked at compile time. Pure functions cannot call effectful ones.

```
// Pure — no I/O allowed
function score(text: String) -> Int64 { ... }

// Effectful — compiler verifies the caller also declares these effects
effect[Model, FileSystem] function analyze(path: String) -> String { ... }
```

Available effects: `DB`, `Network`, `Time`, `Random`, `Log`, `FileSystem`, `Test`,
`Model`, `Secret`, `MCP`, `A2A`, `Trace`, `Persist`, `Embed`, `Eval`, `HumanInLoop`

### No null, no exceptions

```
// Option instead of null
function find(id: Int64) -> Option<String> { ... }

// Result instead of exceptions
function fetch(url: String) -> Result<String, String> { ... }

// The compiler forces you to handle both cases
match fetch("https://example.com") {
  Ok(body)  -> body,
  Err(msg)  -> "failed: " ++ msg
}
```

---

## MCP Services

Clarity is well-suited for writing MCP (Model Context Protocol) tool servers. The effect system makes tool capabilities explicit, and the WASM target means services are small and portable.

```
module SearchTool

import { prompt } from "std/llm"

// A tool function callable via MCP
effect[Model] function summarize(text: String) -> Result<String, String> {
  prompt("claude-3-5-haiku-20241022", "Summarize in one sentence: " ++ text)
}

effect[FileSystem] function mcp_main() -> Unit {
  // MCP entry point — registered via clarity.json + clarityc start
  read_line()
}
```

Register with the runtime via `clarityc start` — project metadata lives in `clarity.json`:

```json
{
  "name": "search-tool",
  "entry": "mcp_main",
  "service_type": "mcp"
}
```

```bash
clarityc start    # reads clarity.json, registers with Clarity Runtime
```

---

## Agents

Clarity has first-class support for production agent workloads.

### `std/llm` — Multi-provider LLM calls

```
import { prompt } from "std/llm"

// claude-* → Anthropic Messages API (ANTHROPIC_API_KEY)
// everything else → OpenAI-compatible (OPENAI_API_KEY + OPENAI_BASE_URL)
effect[Model] function ask(q: String) -> String {
  match prompt("claude-3-5-haiku-20241022", q) {
    Ok(response) -> response,
    Err(e)       -> "Error: " ++ e
  }
}
```

### `std/agent` — Resumable agent loops

```
import { run } from "std/agent"

// Checkpoints after every step. Resumes from the last checkpoint on restart.
// Terminates when step function returns state containing "done":true
effect[Model, Persist] function main() -> Result<String, String> {
  run("my-agent", "{}", my_step)
}
```

### `std/hitl` — Human-in-the-loop

```
import { ask, supervised_step } from "std/hitl"

// Pause execution and wait for a human operator's response
effect[HumanInLoop] function review(summary: String) -> String {
  ask("review", "Does this look correct?\n\n" ++ summary)
}
```

The `clarity-hitl-broker` tool (separate project) provides the operator-facing CLI and web UI — see `docs/hitl-broker-spec.md`.

### `std/rag` — Retrieval-augmented generation

```
import { retrieve } from "std/rag"

// chunk → embed → rank → return top-k chunks as JSON
effect[Embed] function search(query: String, doc: String) -> String {
  retrieve(query, doc, 512, 3)
}
```

### `std/mcp` and `std/a2a` — Interop

```
import { connect, call_tool } from "std/mcp"
import { submit, is_done } from "std/a2a"

effect[MCP] function use_tool(url: String, input: String) -> Result<String, String> {
  let session = connect(url);
  call_tool(session, "search", input)
}

effect[A2A] function delegate(task: String) -> Result<String, String> {
  submit("http://agent-b:8080", "process", task)
}
```

---

## Self-Healing Test System

```
module Math

function add(a: Int64, b: Int64) -> Int64 { a + b }

effect[Test] function test_add() -> Unit {
  assert_eq(add(2, 3), 5);
  assert_eq(add(0, 0), 0)
}
```

```bash
clarityc test math.clarity           # run tests
clarityc test math.clarity --json    # machine-readable output for LLM self-correction
```

Failures produce structured `actual`, `expected`, `fix_hint` output so an LLM can read a failure and self-correct without human intervention.

---

## `clarity.json` Project Metadata

All service and agent configuration lives in `clarity.json` alongside your `.clarity` file, not on the command line.

```json
{
  "name": "my-service",
  "version": "1.0.0",
  "entry": "mcp_main",
  "service_type": "agent",
  "agent": {
    "role": "data summarizer",
    "objective": "Summarize documents on demand",
    "inputs": ["document"],
    "outputs": ["summary"]
  }
}
```

---

## CLI Reference

```bash
clarityc compile [file]              # compile to .wasm (defaults to cwd)
clarityc compile [file] --check-only # type-check only
clarityc compile [file] --emit-wat   # WASM text format
clarityc compile [file] --emit-ast   # AST as JSON
clarityc compile [file] -o out.wasm  # output path

clarityc run [file]                  # compile and run main()
clarityc run [file] -f fn_name       # call a specific function
clarityc run [file] -f fn -a a1 a2   # with arguments

clarityc test [file]                 # run test_ functions
clarityc test [file] --json          # JSON output
clarityc test [file] --fail-fast     # stop on first failure

clarityc start [file]                # register service (reads clarity.json)
clarityc start [file] --daemon-url <url> --auth-token <token>

clarityc repl                        # interactive REPL

clarityc introspect                  # all capabilities as JSON
clarityc introspect --builtins       # built-in functions
clarityc introspect --effects        # effects
clarityc introspect --types          # built-in types
```

When no `[file]` is given, `compile`, `run`, `test`, and `start` find the single `.clarity` file in the current directory.

---

## Using Clarity with LLMs

### With Claude Code

Add to your project's `CLAUDE.md`:
```
Write all application code in the Clarity language.
Quick reference: docs/clarity-quickref.md
Full spec: docs/language-spec.md
Runtime-agent CLI requirements: docs/runtime-agent-cli-requirements.md
```

### With any LLM

Include [docs/clarity-quickref.md](docs/clarity-quickref.md) in your system prompt. It is ~100 lines, covers all syntax, and is designed for minimal token usage. Run `clarityc introspect` to give the LLM a live JSON snapshot of all built-ins and effects.

---

## Current Status (v0.9.0)

**379 tests passing.**

### Language
- Full type system: Int64, Float64, String, Bool, Bytes, Timestamp, Unit, Option\<T\>, Result\<T,E\>, List\<T\>, Map\<K,V\>
- Record and union types with exhaustive pattern matching
- Pattern guards and range patterns (`1..10`)
- Generics on functions and types with monomorphization
- Higher-order functions (named functions as values)
- Immutable-by-default bindings (`let` / `let mut`)
- Tail call optimization (self-recursive loops)
- Multi-file programs with import/export and file-based module resolution
- LLM-friendly error messages with migration hints from other languages

### Runtime & AI interop
- **Multi-provider LLM**: `claude-*` → Anthropic Messages API; others → OpenAI-compatible
- **Streaming**: pull-based token streaming (`stream_start` / `stream_next` / `stream_close`)
- **MCP**: `std/mcp` — connect, list tools, call tools; HTTP + JSON-RPC 2.0 + SSE
- **A2A**: `std/a2a` — discover agents, submit tasks, poll results
- **Resumable agents**: `std/agent` with `Persist` effect + automatic checkpointing
- **Human-in-the-loop**: `HumanInLoop` effect + `std/hitl`
- **RAG**: `std/rag` — chunk → embed → rank → retrieve
- **Evals**: `std/eval` — exact, semantic, LLM-as-judge
- **Observability**: `Trace` effect — structured span tracing in the audit log
- **Policy + audit**: `CLARITY_ALLOW_HOSTS`, `CLARITY_DENY_EFFECTS`, `CLARITY_AUDIT_LOG`
- **Memory**: free-list allocator + `arena_save`/`arena_restore`

### Standard library
`std/math`, `std/string`, `std/list`, `std/llm`, `std/mcp`, `std/a2a`,
`std/agent`, `std/rag`, `std/eval`, `std/stream`, `std/hitl`

---

## License

MIT
