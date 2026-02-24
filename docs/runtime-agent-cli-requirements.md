# Runtime Agent CLI Requirements (Clarity)

Status: Draft  
Target project: `LLM-lang`  
Related implementation: `LLM-cli` TypeScript bridge (`runtime-agents`, `runtime-chat`)

## Problem Statement

Operators need a terminal workflow that can:

1. Connect to a running `LLM-runtime` / `Clarity-runtime`.
2. List available agents.
3. Attach to one agent run (or create one).
4. Exchange chat messages through runtime HITL APIs.

The current implementation lives in TypeScript (`LLM-cli`) and should be treated as the reference behavior.

## Functional Requirements

### RQ-CLI-001: Runtime discovery

- Provide a command to query `GET /api/agents/registry`.
- Show at minimum:
  - `serviceId`
  - `agent.agentId`
  - `agent.name`
  - `agent.triggers`
  - lifecycle/health

### RQ-CLI-002: Runtime chat session

- Provide a command to:
  - create a run (when run id is not provided), and
  - chat with that run over HITL input.
- Run creation must emit:
  - `agent.run_created` (`trigger=api`)
  - `agent.run_started`
- HITL message send must call:
  - `POST /api/agents/runs/:runId/hitl`
- Event rendering must poll:
  - `GET /api/agents/runs/:runId/events`
- Chat exits automatically when run status is terminal (`completed|failed|cancelled`).

### RQ-CLI-003: Operator controls

- Support interactive commands:
  - `/status`
  - `/refresh`
  - `/exit`
- Support optional bearer token auth.

## Language/Stdlib Gaps for Native Clarity Implementation

To implement this CLI directly in Clarity, the following capabilities are required or need hardening:

1. Generic HTTP client primitives for arbitrary REST calls (method, headers, status code, body).
2. Structured JSON parsing for nested objects/arrays (not only flat key-value maps).
3. CLI command parsing ergonomics for multi-command tools.
4. Stable interactive stdin loop patterns suitable for chat-style UX.

## Non-Goals

- Replacing runtime-side validation or sanitization logic.
- Defining new runtime API endpoints in this requirement.

## Backlog

- Backlog ID: `LANG-CLI-RT-CHAT-001`
- Priority: `P1`
- Item: Rewrite `LLM-cli` runtime chat bridge from TypeScript to native Clarity after the required language/runtime capabilities above are available.
