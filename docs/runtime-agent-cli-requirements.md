# Runtime Agent CLI Requirements (Clarity)

Status: Active (language support available; reference implementation in progress)  
Target project: `LLM-lang`  
Related production bridge: `LLM-cli` (`runtime-agents`, `runtime-chat`)

## Goal

Provide a native Clarity CLI flow where one start command handles:

1. Connect to runtime.
2. Show numbered agent list.
3. Select one number and connect.
4. Start chatting with that agent run.

A prototype exists at:

- `examples/26-runtime-agent-chat-cli/main.clarity`

## Functional Requirements

### RQ-CLI-001: Single-start operator flow

- Prompt for runtime URL when not provided.
- Query `GET /api/agents/registry`.
- Display numbered rows with at least:
  - `serviceId`
  - `agent.agentId`
  - `agent.name`
  - `agent.triggers` (when present)
- Accept numeric selection and bind to the selected service.

### RQ-CLI-002: Run bootstrap contract

When attaching to an existing run is not requested, bootstrap via:

- `POST /api/agents/events` with `agent.run_created`
- `POST /api/agents/events` with `agent.run_started`

Required context in `agent.run_created.data`:

- `trigger = "api"`
- `route = "/cli/runtime-chat"`
- `method = "CLI"`
- `requestId = <runId>`
- `caller = "clarity-agent-cli"`

### RQ-CLI-003: Chat message transport

- Send operator messages to:
  - `POST /api/agents/runs/:runId/messages`
- Request body must include:
  - `message`
  - `role = "user"`
  - `service_id`
  - `agent`

### RQ-CLI-004: Event transport and rendering

- Preferred live stream:
  - `GET /api/agents/runs/:runId/events/stream` (SSE)
- Compatibility stream fallback:
  - `GET /api/events` (SSE, client filters by `data.runId`)
- Poll fallback:
  - `GET /api/agents/runs/:runId/events`
- Chat should auto-exit when terminal state is observed:
  - `agent.run_completed`
  - `agent.run_failed`
  - `agent.run_cancelled`
  - or terminal run status from runtime run summaries.

### RQ-CLI-005: Auth

- Optional Bearer token support via:
  - `Authorization: Bearer <token>`

## Language/Runtime Capability Status

The major language requirements are now available:

- HTTP calls with status/body inspection: `http_request_full`
- Structured JSON traversal helpers: `std/json`
- CLI argument helpers: `std/cli`
- SSE client primitives: `std/sse`

## Remaining Gaps for Production Parity

The native Clarity version still needs hardening to replace the TypeScript CLI in production:

1. Robust URL encoding and endpoint composition utilities.
2. Stream lifecycle handling equivalent to TS fallback logic (run-scoped SSE -> global SSE -> polling).
3. Packaged distribution/entrypoint conventions for operator teams.
4. End-to-end runtime integration tests against a live runtime fixture.

## Backlog

- Backlog ID: `LANG-CLI-RT-CHAT-002`
- Priority: `P1`
- Item: Promote native Clarity runtime-chat CLI to production parity and replace the TypeScript bridge as primary implementation.
- Dependency: runtime integration tests and SSE fallback hardening.
