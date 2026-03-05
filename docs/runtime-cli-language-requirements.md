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
| `LANG-RUNTIME-A2A-001` | `LLM-runtime` | P1 | Open | Emit runtime `agent.*` observability events directly from language-level `std/a2a` and `std/mcp`. | `LLM-runtime/docs/requirements/layered-runtime-requirements.md` (Layer 7 remaining) |
| `LANG-RUNTIME-ENTRY-001` | `LLM-runtime` | P2 | Planned | Keep `clarityc start` compiler/runtime contract stable for provisioning and onboarding flows. | `LLM-runtime/docs/requirements/layered-runtime-requirements.md` (Layer 6) |
| `LANG-RUNTIME-CLI-EOF-001` | `LLM-runtime` | P1 | **Done** | Added `read_line_or_eof() -> Option<String>` (latched EOF), `stdin_eof_detected() -> Bool`, and EOF latch to `read_line()`. 551 tests pass. | `LLM-runtime/docs/requirements/layered-runtime-requirements.md` (Layer 8 remaining) |
| `LANG-RUNTIME-CONTEXT-001` | `LLM-runtime` | P1 | Open | Add typed structured function arguments/results for local chat handlers so `context.v1` can be consumed without manual JSON string parsing. | `LLM-runtime/docs/spec/v1/runtime-spec.md` (`Runtime Chat Handler Context Envelope`) |
| `RQ-LANG-CLI-TTY-003` | `LLM-cli` | P1 | **Done** | Fixed `tty_read_key()` macOS escape-sequence reading (follow-up readSync), added terminal-mode restore on exit/SIGINT/SIGTERM/uncaughtException. | `LLM-lang/docs/runtime-agent-cli-requirements.md` |

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
