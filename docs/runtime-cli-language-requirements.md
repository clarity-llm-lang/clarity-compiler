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
| `LANG-RUNTIME-CLI-EOF-001` | `LLM-runtime` | P1 | Open | Ensure deterministic piped `read_line()`/EOF behavior for menu-style CLI loops. | `LLM-runtime/docs/requirements/layered-runtime-requirements.md` (Layer 8 remaining) |
| `RQ-LANG-CLI-TTY-003` | `LLM-cli` | P1 | Open | Make `tty_read_key()` reliably deliver interactive key events on macOS terminals without fallback. | `LLM-lang/docs/runtime-agent-cli-requirements.md` |

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
