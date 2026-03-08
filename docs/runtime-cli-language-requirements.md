# Runtime + CLI Language Requirements Registry

Status: Active  
Owner: `LLM-lang`  
Scope: language/compiler/runtime capability requests raised by `LLM-runtime` and `LLM-cli`.

## Canonical Intake Rule

- This file is the canonical intake for language requirements coming from runtime and CLI work.
- When `LLM-runtime` or `LLM-cli` hits a language/runtime limitation, add or update an entry here in the same change where the gap is discovered.
- Keep detailed implementation notes in source-repo docs; keep this registry concise and current.

## Open Requirements

| ID | Requested by | Priority | Status | Summary | Source |
| --- | --- | --- | --- | --- | --- |
| `RUNTIME-HITL-CLARITY-001` | `LLM-runtime` | P1 | Open | Replace TypeScript runtime chat executor with native Clarity orchestration. | `LLM-runtime/docs/requirements/runtime-agent-chat-interface-requirements.md` |
| `LANG-RUNTIME-A2A-001` | `LLM-runtime` | P1 | **Done** | Added `agentEventEmitter` callback to `RuntimeConfig`; `mcp_call_tool` emits `agent.tool_called`, `a2a_submit/poll/cancel` emit `agent.a2a_task_*` events. LLM-runtime injects callback when embedding WASM. | `LLM-runtime/docs/requirements/layered-runtime-requirements.md` (Layer 7 remaining) |
| `LANG-RUNTIME-HITL-CAP-001` | `LLM-runtime` | P1 | **Done** | `clarityc start` now auto-detects `HumanInLoop` effect in source (+ transitive local imports) and passes `--agent-hitl` to `clarityctl`. Override via `agent.hitl` in `clarity.json`. | `LLM-runtime/docs/spec/v1/runtime-spec.md` (`metadata.agent.hitl`) |
| `LANG-RUNTIME-ENTRY-001` | `LLM-runtime` | P2 | Planned | Keep `clarityc start` compiler/runtime contract stable for provisioning and onboarding flows. | `LLM-runtime/docs/requirements/layered-runtime-requirements.md` (Layer 6) |
| `LANG-RUNTIME-CLI-EOF-001` | `LLM-runtime` | P1 | **Done** | Added `read_line_or_eof() -> Option<String>` (latched EOF), `stdin_eof_detected() -> Bool`, and EOF latch to `read_line()`. 551 tests pass. | `LLM-runtime/docs/requirements/layered-runtime-requirements.md` (Layer 8 remaining) |
| `LANG-RUNTIME-CONTEXT-001` | `LLM-runtime` | P1 | **Done** | Added `std/context.clarity` with typed helpers for the `context.v1` envelope: `get_task`, `get_instructions`, `get_run_id`, `get_history_*`, `get_runtime_state`, `has_context`, etc. Built on `std/json`. | `LLM-runtime/docs/spec/v1/runtime-spec.md` (`Runtime Chat Handler Context Envelope`) |
| `LANG-RUNTIME-WASM-MARSHAL-001` | `LLM-runtime` | P2 | **Done** | Local wasm `fn__*` calls now accept typed `argTypes` and optional `resultType` descriptors for structured record/list/option/result marshalling. Runtime chat/timer local handlers now receive an additional structured context argument while preserving legacy JSON-string args for backward compatibility. | `LLM-runtime/src/pkg/supervisor/service-manager.ts`, `LLM-runtime/src/pkg/supervisor/local-wasm-worker.ts`, `LLM-runtime/src/tests/local-wasm-parity.test.ts`, `LLM-runtime/src/tests/agent-observability.test.ts` |
| `LANG-CLI-TOOLING-001` | `LLM-cli` | P1 | **Done** | Added `clarityc watch` (file-watcher with debounced recompile), `clarityc lint` (unused declarations/imports via AST), and `clarityc fmt` (text-level formatter with `--write`/`--check`). | `LLM-lang/src/cli/watch.ts`, `lint.ts`, `fmt.ts` |
| `LANG-CLI-PACK-STANDALONE-001` | `LLM-cli` | P1 | **Done** | `clarityc pack` now embeds the required `clarity-lang` version and prints a version-mismatch warning at runtime. `--self-contained` copies the runtime alongside the output for zero-dependency deployment. | `LLM-lang/src/index.ts` |
| `LANG-CLI-REPL-001` | `LLM-cli` | P2 | **Done** | Replaced 7-type sequential brute-force probe with heuristic type ordering + check-only probing; single full WASM compile only after type is determined. | `LLM-lang/src/index.ts` |
| `LANG-SEC-NETWORK-FILE-001` | `LLM-runtime` | P1 | **Done** | `file://` URLs now return an error from all Network-effect HTTP builtins (`http_get`, `http_post`, `http_request`, `http_request_full`). Audit-log entry emitted on each blocked attempt. Use `read_file()` (FileSystem effect) to read local files. | `LLM-lang/src/codegen/runtime/network.ts` |
| `RQ-LANG-CLI-TTY-003` | `LLM-cli` | P1 | **Done** | Fixed `tty_read_key()` macOS escape-sequence reading; added `tty_read_numeric_choice(count)` builtin for terminal-agnostic numeric selection that works in non-raw-mode and CI environments. | `LLM-lang/src/codegen/runtime/tty.ts` |

## Entry Template

```md
### <ID>: <Short Title>
- Requested by: `LLM-runtime` | `LLM-cli`
- Priority: P1 | P2 | P3
- Status: Open | Planned | In progress | Blocked | Done
- Summary: <one sentence>
- Source: <repo/doc path or issue id>
- Last updated: YYYY-MM-DD
```
