# Runtime Agent CLI Requirements (Clarity)

Status: Active (prototype complete, production migration in progress)  
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

The native Clarity version is now wired into `LLM-cli` as the default runtime-chat engine.
During this migration, the following language/runtime gaps were identified:

1. **RQ-LANG-CLI-001: Input/Stream multiplexing primitive**
   - Need a standard way to concurrently process interactive stdin and SSE events in one loop.
   - Current limitation forces polling-first UX in native Clarity chat clients.
2. **RQ-LANG-CLI-002: URL/path encoding helper**
   - Need built-in URL segment/query encoding helpers for safe endpoint construction (for run IDs and future query params).
3. **RQ-LANG-CLI-003: CLI packaging ergonomics**
   - Need first-class support for shipping Clarity apps as standalone CLI binaries or package-friendly launch artifacts.
4. **RQ-LANG-CLI-004: Runtime integration harness**
   - Need official e2e fixtures for runtime-agent chat contracts to verify behavior against live runtime streams and terminal states.

## TypeScript Removal Requirements (Complete)

### RQ-LANG-CLI-005: Zero-TS runtime-chat path

- `clarity-agent runtime-chat` must run without Node/TypeScript launcher involvement.
- `--bridge ts` fallback must be removed.
- Distribution must provide a direct Clarity-native executable entrypoint for runtime chat.

Acceptance criteria:

- Runtime-chat command behavior is fully covered by Clarity-native tests.
- No TypeScript code path is invoked for runtime-chat in production builds.

### RQ-LANG-CLI-006: Zero-TS full operator CLI surface

- Remaining operator commands currently in TS (`watch`, `list`, `answer`, `cancel`, `serve`, `connect`, `runtime-agents`) must have native Clarity implementations or officially approved replacements.
- Broker protocol compatibility (`.question` / `.answer` + HTTP API semantics) must remain intact.

Acceptance criteria:

- `LLM-cli` can be built and run with no mandatory TypeScript runtime dependency.
- Existing CI behavior parity is maintained (build/lint/test equivalents for native CLI).
- TS command router and runtime client modules are removed or reduced to non-runtime dev tooling only.

## Backlog

- Backlog ID: `LANG-CLI-RT-CHAT-002`
- Priority: `P1`
- Item: Close RQ-LANG-CLI-001..004 and remove the TypeScript runtime-chat fallback bridge from `LLM-cli`.
- Dependency: async stdin/SSE multiplex support + runtime integration fixtures.

- Backlog ID: `LANG-CLI-TS-ZERO-001`
- Priority: `P1`
- Item: Deliver RQ-LANG-CLI-005 and RQ-LANG-CLI-006 so TypeScript can be removed completely from production CLI execution paths.
- Dependency: native packaging/runtime-entrypoint support + broker/server capability parity in Clarity.
