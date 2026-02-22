<p align="center">
  <img src="assets/clarity-logo.svg" alt="Clarity" width="480">
</p>

<p align="center">
  <strong>A programming language designed for LLM code generation.</strong><br>
  Statically typed · Compiles to WASM · Built for agents
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/version-0.9.0-green.svg" alt="Version">
  <img src="https://img.shields.io/badge/tests-379%20passing-brightgreen.svg" alt="Tests">
  <img src="https://img.shields.io/badge/target-WebAssembly-purple.svg" alt="Target: WASM">
</p>

---

Clarity is a statically typed language that compiles to WebAssembly. It is built from first principles around two goals: **LLMs generate correct code on the first attempt**, and **agents run reliably in production**.

```
module Example

import { run } from "std/agent"
import { prompt } from "std/llm"

effect[Model, Persist] function my_step(state: String) -> String {
  let answer = prompt("claude-3-5-haiku-20241022", "Summarize this in one sentence: " ++ state);
  match answer {
    Ok(summary) -> "{\"done\":true,\"result\":\"" ++ summary ++ "\"}",
    Err(_) -> state
  }
}

effect[Model, Persist] function main() -> Result<String, String> {
  run("summarizer", "{\"text\":\"Clarity is a language for agents.\"}", my_step)
}
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

# Run a specific function with arguments
clarityc run myfile.clarity -f fibonacci -a 10

# Type-check only
clarityc compile --check-only

# Introspect all language capabilities (JSON — great for LLM context)
clarityc introspect
```

---

## Why Clarity for Agents?

Every mainstream language was designed for humans to write. Clarity is designed for **LLMs to write and agents to run**.

### Agents need determinism

No implicit type coercions. No null. No exceptions. No hidden state. What an LLM writes is exactly what runs, every time.

### Agents need explicit side effects

Every I/O capability is declared in the function signature and enforced at compile time. The effect system tells you — and the LLM — exactly what a function can do.

```
// This function can ONLY compute. No I/O allowed.
function score(text: String) -> Int64 { ... }

// This function can call LLMs and access the file system.
effect[Model, FileSystem] function analyze(path: String) -> String { ... }

// Calling an effectful function from a pure one is a compile error.
```

### Agents need resumability

The `Persist` effect and `std/agent` provide a checkpoint-and-resume loop out of the box. If your agent crashes or is restarted, it picks up exactly where it left off.

### Agents need human oversight

The `HumanInLoop` effect lets any step in your agent pause and wait for a human to review, approve, or edit the proposed output before continuing.

---

## Agent Standard Library

### `std/agent` — Resumable agent loops

```
import { run, resume } from "std/agent"

// Run a loop that checkpoints after every step.
// Resumes automatically from the last checkpoint on restart.
// Terminates when step_fn returns state containing "done":true
effect[Model, Persist] function main() -> Result<String, String> {
  run("my-agent", "{}", my_step)
}
```

### `std/llm` — Multi-provider LLM calls

```
import { prompt, chat } from "std/llm"

// Anthropic (claude-* models) — requires ANTHROPIC_API_KEY
// OpenAI / Groq / Ollama — requires OPENAI_API_KEY + OPENAI_BASE_URL
effect[Model] function ask(question: String) -> String {
  let result = prompt("claude-3-5-haiku-20241022", question);
  match result {
    Ok(response) -> response,
    Err(e) -> "Error: " ++ e
  }
}
```

### `std/hitl` — Human-in-the-loop

```
import { ask, confirm, supervised_step } from "std/hitl"

// Pause agent, present a question to a human operator, return their response.
// Uses CLARITY_HITL_DIR (default .clarity-hitl/) for the file handshake.
effect[HumanInLoop] function review(summary: String) -> String {
  ask("review-step", "Does this summary look correct?\n\n" ++ summary)
}

// Or supervise an entire step — human can approve, edit, or reject.
effect[Model, HumanInLoop] function supervised(state: String) -> String {
  supervised_step("step-review", state, my_step_fn)
}
```

The `clarity-hitl-broker` tool (separate project) provides the operator-facing CLI and web UI — see `docs/hitl-broker-spec.md`.

### `std/rag` — Retrieval-augmented generation

```
import { retrieve } from "std/rag"

effect[Embed] function answer_from_doc(query: String, doc: String) -> String {
  // chunk → embed → rank → return top-k chunks as JSON
  retrieve(query, doc, 512, 3)
}
```

### `std/stream` — Streaming LLM responses

```
import { call } from "std/stream"

effect[Model] function stream_summary(text: String) -> Result<String, String> {
  call("gpt-4o-mini", "Summarize: " ++ text)
}
```

### `std/mcp` and `std/a2a` — Agent interop

```
import { connect, call_tool } from "std/mcp"
import { submit, poll, is_done } from "std/a2a"

// MCP: connect to a tool server, call a tool
effect[MCP] function use_browser(url: String) -> Result<String, String> {
  let session = connect("http://localhost:3000");
  call_tool(session, "navigate", "{\"url\":\"" ++ url ++ "\"}")
}

// A2A: discover and delegate to another agent
effect[A2A] function delegate(task: String) -> Result<String, String> {
  let agent_url = "http://agent-b:8080";
  submit(agent_url, "process", task)
}
```

---

## Language Overview

### Types

```
// Built-in: Int64, Float64, String, Bool, Bytes, Timestamp, Unit
// Generic: List<T>, Option<T>, Result<T, E>

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

// Union type destructuring — exhaustiveness is compile-enforced
function describe(r: Response) -> String {
  match r {
    Success(data)  -> data,
    NotFound       -> "not found",
    Error(reason)  -> reason
  }
}
```

No `if`/`else`. No `for`/`while`. Use `match` and recursion. The LLM only has one way to write any conditional.

### Effect system

```
effect[DB, Log] function save_user(name: String) -> Int64 {
  // Calling this from a pure function is a compile error.
  // The effect declaration is part of the type signature.
  42
}
```

Available effects: `DB`, `Network`, `Time`, `Random`, `Log`, `FileSystem`, `Test`,
`Model`, `Secret`, `MCP`, `A2A`, `Trace`, `Persist`, `Embed`, `Eval`, `HumanInLoop`

### No null, no exceptions

```
// Option instead of null
function find_user(id: Int64) -> Option<String> { ... }

// Result instead of exceptions
function fetch(url: String) -> Result<String, String> { ... }

// Compiler enforces handling all cases
match fetch("https://example.com") {
  Ok(body)  -> body,
  Err(msg)  -> "failed: " ++ msg
}
```

---

## Starting a Service in Clarity Runtime

To register a compiled `.clarity` file as a running MCP or agent service, use `clarityc start`. Project metadata lives in `clarity.json` — not on the command line.

**`clarity.json`** (in the same directory as your `.clarity` file):
```json
{
  "name": "my-agent",
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

```bash
# Start using metadata from clarity.json in the current directory
clarityc start

# Override the daemon (default: CLARITYD_URL or http://localhost:4707)
clarityc start --daemon-url http://prod-runtime:4707 --auth-token $TOKEN
```

`clarityc start` delegates to `clarityctl add` under the hood.

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
clarityc test math.clarity          # run tests
clarityc test math.clarity --json   # machine-readable output for LLM consumption
```

Failures include structured `actual`, `expected`, `fix_hint` fields designed for LLM self-correction loops.

---

## CLI Reference

```bash
clarityc compile [file]             # compile to .wasm (defaults to cwd)
clarityc compile [file] --check-only # type-check only
clarityc compile [file] --emit-wat  # show WASM text format
clarityc compile [file] --emit-ast  # show AST as JSON
clarityc compile [file] -o out.wasm # specify output path

clarityc run [file]                 # compile and run main()
clarityc run [file] -f fn_name      # call a specific function
clarityc run [file] -f fn -a arg1 arg2 # with arguments

clarityc test [file]                # run test_ functions
clarityc test [file] --json         # JSON output
clarityc test [file] --fail-fast    # stop on first failure

clarityc start [file]               # register service (reads clarity.json)
clarityc start [file] --daemon-url <url> --auth-token <token>

clarityc repl                       # interactive REPL

clarityc introspect                 # all capabilities as JSON
clarityc introspect --builtins      # built-in functions
clarityc introspect --effects       # effects
clarityc introspect --types         # built-in types
```

When no `[file]` is given, `compile`, `run`, `test`, and `start` look for the single `.clarity` file in the current directory.

---

## Using Clarity with LLMs

### With Claude Code

Add to your project's `CLAUDE.md`:
```
Write all application code in the Clarity language.
Quick reference: docs/clarity-quickref.md
Full spec: docs/language-spec.md
```

### With any LLM

Include [docs/clarity-quickref.md](docs/clarity-quickref.md) in your system prompt. It is ~100 lines, covers all syntax, and is designed for minimal token usage.

Use `clarityc introspect` to give the LLM a live JSON snapshot of all available built-ins and effects.

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

### Agent runtime
- **Multi-provider LLM**: `claude-*` → Anthropic Messages API; others → OpenAI-compatible
- **Streaming**: pull-based token streaming via `stream_start` / `stream_next` / `stream_close`
- **Resumable agents**: `std/agent` with `Persist` effect + automatic checkpointing
- **Human-in-the-loop**: `HumanInLoop` effect + `std/hitl`; file-based handshake protocol
- **RAG pipeline**: `std/rag` — chunk → embed → rank → retrieve
- **MCP interop**: `std/mcp` — connect, list tools, call tools
- **A2A interop**: `std/a2a` — discover agents, submit tasks, poll results
- **Observability**: `Trace` effect — structured span tracing in the audit log
- **Policy + audit**: `CLARITY_ALLOW_HOSTS`, `CLARITY_DENY_EFFECTS`, `CLARITY_AUDIT_LOG`
- **Memory**: free-list allocator + `arena_save`/`arena_restore` for step-bounded memory in agent loops

### Standard library
`std/math`, `std/string`, `std/list`, `std/llm`, `std/mcp`, `std/a2a`, `std/agent`, `std/rag`, `std/eval`, `std/stream`, `std/hitl`

---

## License

MIT
