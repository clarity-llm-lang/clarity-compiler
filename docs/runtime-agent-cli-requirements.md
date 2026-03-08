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
5. **RQ-LANG-CLI-007: Raw terminal key input**
   - Need raw stdin key event support (`up`, `down`, `enter`, `space`, `escape`) for native arrow-key selection UX.
   - Must restore terminal mode on exit/error.
6. **RQ-LANG-CLI-008: Terminal render control**
   - Need cursor/clear primitives for in-place list redraw in TTY UIs, with a documented non-TTY fallback.
7. **RQ-LANG-CLI-009: Multi-run event fan-in**
   - Need a standard primitive/pattern to concurrently consume SSE/poll events for multiple run IDs in one operator loop.
   - Required for native multi-agent room chat and discuss orchestration.
8. **RQ-LANG-CLI-010: Installable compiler packaging for git consumers**
   - Need `clarity-lang` git dependency installs to provide a working `clarityc` binary without manual local linking/workarounds.
   - Distribution must include or build required CLI artifacts reliably for downstream projects (`LLM-cli`) in clean `npm ci` environments.

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
- `claritycli`-level UX is available natively in Clarity:
  - Arrow-key/space/enter selection of one or many agents.
  - Alias assignment for invited participants.
  - Targeted messaging (`@alias`, `/to`) and multi-agent discuss loop.

## Backlog

- Backlog ID: `LANG-CLI-RT-CHAT-002`
- Priority: `P1`
- Item: Close RQ-LANG-CLI-001..004 and remove the TypeScript runtime-chat fallback bridge from `LLM-cli`.
- Dependency: async stdin/SSE multiplex support + runtime integration fixtures.

- Backlog ID: `LANG-CLI-TS-ZERO-001`
- Priority: `P1`
- Item: Deliver RQ-LANG-CLI-005 and RQ-LANG-CLI-006 so TypeScript can be removed completely from production CLI execution paths.
- Dependency: native packaging/runtime-entrypoint support + broker/server capability parity in Clarity.

- Backlog ID: `LANG-CLI-TUI-001`
- Priority: `P1`
- Status: **Done** — `std/tui.clarity` delivers `select_one`, `select_many`, `confirm`, `prompt_line`. Arrow-key TTY mode with automatic non-TTY numeric/readline fallback. Requires `TTY`, `Log`, and `FileSystem` effects. ANSI escapes use new `\e` lexer support. New `print_no_newline` builtin added for inline prompts.
- Item: Deliver RQ-LANG-CLI-007 and RQ-LANG-CLI-008 for native interactive selector UX in Clarity.
- Dependency: terminal raw input + cursor/clear output primitives.

- Backlog ID: `LANG-CLI-ROOM-001`
- Priority: `P1`
- Item: Deliver RQ-LANG-CLI-009 for native multi-agent room and discuss support in Clarity.
- Dependency: multi-stream event fan-in with robust run-scoped dispatch.

- Backlog ID: `LANG-CLI-PKG-002`
- Priority: `P1`
- Item: Deliver RQ-LANG-CLI-010 so downstream git-based installs expose a working `clarityc` with current HTTP server builtins.
- Dependency: packaging/install strategy that does not require manual local symlink workarounds.

## Cross-Project Audit Intake (2026-03-06)

Source session: deep architecture/UX/security/docs/license/CI review across `LLM-lang`, `LLM-runtime`, and `LLM-cli`.

### Architecture Requirements

1. `RQ-LANG-ARCH-001` (P1): **Done** — Added `clarityc watch`, `clarityc fmt`, and `clarityc lint` commands. See `src/cli/watch.ts`, `src/cli/lint.ts`, `src/cli/fmt.ts`.
2. `RQ-LANG-ARCH-002` (P1): **Done** — `clarityc pack` embeds required version with mismatch warning; `--self-contained` copies runtime for zero-dependency deployment. See `src/index.ts`.
3. `RQ-LANG-ARCH-003` (P1): **Done** — All `DB` effect references removed from docs, spec, grammar, and CLAUDE.md. Dead `db_execute`/`db_query` stubs removed from runtime. See `docs/language-spec.md`, `docs/grammar.peg`, `docs/clarity-quickref.md`, `CLAUDE.md`, `src/codegen/runtime/network.ts`.
4. `RQ-LANG-ARCH-004` (P2): Open — Remaining standard-library and coverage gaps (backlog items `#9`, `#14`–`#17`, `#24`–`#26`) need explicit acceptance tests.
5. `RQ-LANG-ARCH-005` (P2): Open — Cross-repo conformance fixtures for language/runtime/CLI contracts needed beyond current baseline.

### UX Requirements

1. `RQ-LANG-UX-001` (P1): **Done** — REPL brute-force probing replaced with heuristic type ordering + check-only probing; single full WASM compile only after type is determined. See `src/index.ts`.
2. `RQ-LANG-UX-002` (P1): Open — Language requirement statuses must stay synchronized between canonical registry and downstream CLI/runtime requirement docs.

### Security Requirements

1. `RQ-LANG-SEC-001` (P1): **Done** — `file://` URLs blocked in all Network-effect HTTP builtins with audit-log entry. See `src/codegen/runtime/network.ts`.
2. `RQ-LANG-SEC-002` (P1): **Done** — `CLARITY_FS_ALLOW_ROOT` and `CLARITY_FS_DENY_PATHS` env vars enforce FileSystem path guardrails in `read_file`, `write_file`, `list_dir`, `file_exists`, `remove_file`, and `make_dir`. See `src/codegen/runtime/fs.ts`.
3. `RQ-LANG-SEC-003` (P2): Open — Evolve coarse global policy knobs toward per-service/per-run policy controls for runtime embedding.

### Documentation, License, and GitHub Setup Requirements

1. `RQ-LANG-DOC-001` (P1): **Done** — `README.md` updated: version 0.10.0, 561 tests, effects list, CLI reference, security section, std-library list. See `README.md`.
2. `RQ-LANG-DOC-002` (P1): **Done** — Stale `DB` effect references removed from all public docs and spec examples. See `docs/language-spec.md`, `docs/clarity-quickref.md`, `docs/grammar.peg`.
3. `RQ-LANG-LIC-001` (P1): **Done** — `LICENSE` (MIT, 2024–2026) added to repository root. See `LICENSE`.
4. `RQ-LANG-CI-001` (P2): **Done** — `.github/workflows/ci.yml` added: build + test matrix (Node 20/22) on push/PR to main; type-check job. Actions pinned to v4 (`actions/checkout`, `actions/setup-node`). See `.github/workflows/ci.yml`.
5. `RQ-LANG-CI-002` (P2): **Done** — Repository governance added: `.github/dependabot.yml` (weekly npm + Actions updates), `.github/CODEOWNERS` (compiler/runtime team routing), `.github/pull_request_template.md`, and issue templates for bugs and feature requests. See `.github/`.
