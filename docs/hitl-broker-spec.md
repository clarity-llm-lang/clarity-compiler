# clarity-hitl-broker — Requirements & Protocol Specification

This document defines the requirements for the `clarity-hitl-broker` project —
a standalone tool (CLI + optional web UI) that acts as the operator-facing
interface for the Clarity `HumanInLoop` effect.

## Purpose

When a Clarity agent calls `hitl_ask(key, question)` the runtime writes a
`.question` file and blocks waiting for a `.answer` file. The broker watches the
handshake directory and presents pending questions to a human operator through a
comfortable interface.

The broker is intentionally a **separate project** so it can be:
- Deployed independently from the agent runtime
- Replaced with a custom UI (Slack bot, web dashboard, mobile app)
- Shared across multiple agent processes on the same machine or network

---

## Handshake protocol (file-based)

**Directory:** controlled by `CLARITY_HITL_DIR` env var (default `.clarity-hitl/`).

### Question file — `{dir}/{safeKey}.question`
Written by the Clarity runtime. JSON format:

```json
{
  "key":       "review-step-3",
  "question":  "Does this summary look correct?\n\n...",
  "timestamp": 1708608000000,
  "pid":       12345
}
```

### Answer file — `{dir}/{safeKey}.answer`
Written by the broker (or any external process). Plain UTF-8 text, no JSON
wrapping. The runtime reads, trims whitespace, and returns the content as a
`String`.

### Lifecycle

```
Clarity runtime             Broker / Operator
─────────────────           ──────────────────
write {key}.question  →     broker detects new file
                            display question to human
                      ←     human types response
                            write {key}.answer
read + delete answer  ←
delete {key}.question
return answer string
```

---

## CLI requirements (`clarity-hitl`)

### Installation
```
npm install -g clarity-hitl-broker
# or
npx clarity-hitl-broker watch
```

### Commands

#### `watch [dir]`
Watch `dir` (or `CLARITY_HITL_DIR`, default `.clarity-hitl/`) for question
files. For each new `.question` file:

1. Print a formatted prompt to the terminal:
   ```
   ╔══ HITL request: review-step-3 ══╗
   │ Does this summary look correct?
   │
   │ [summary text here]
   ╚══════════════════════════════════╝
   Answer (Enter to confirm, or type override):
   ```
2. Read a line from stdin.
3. Write the response as `{key}.answer`.
4. Log completion with timestamp.

**Flags:**
- `--dir <path>` — override the handshake directory
- `--timeout <secs>` — skip questions older than N seconds (default: never)
- `--auto-approve` — automatically write empty approval (useful in CI dry-runs)
- `--log <file>` — append a JSONL audit log of all interactions

#### `list [dir]`
List all pending question files (not yet answered). Output:
```
key                  age      question
──────────────────── ──────── ───────────────────────────────
review-step-3        00:02:14  Does this summary look correct?
```

#### `answer <key> <response>`
Programmatically write an answer file. Useful for scripting or testing.
```
clarity-hitl answer review-step-3 "Looks good, proceed"
```

#### `cancel <key>`
Delete the question file without writing an answer. The Clarity runtime will
eventually time out and return `"[hitl_ask timeout]"`.

---

## Web UI requirements

A simple single-page app served locally (or hostable) that:

1. **Connects** to the broker via SSE (`GET /events`) to receive real-time
   question notifications.
2. **Displays** a card per pending question with:
   - The key name
   - Timestamp / age
   - Full question text (rendered as markdown)
3. **Accepts** a free-text response via a textarea + submit button.
4. **Sends** the response via `POST /answer` → broker writes the `.answer` file.
5. **Shows** a history of completed interactions in the session.

### Broker HTTP API (served by `clarity-hitl-broker serve`)

```
GET  /questions              — list pending questions (JSON array)
GET  /events                 — SSE stream of { type: "new_question" | "answered", key, ... }
POST /answer                 — { key: string, response: string } → writes answer file
POST /cancel                 — { key: string } → deletes question file
```

**Port:** configurable via `--port` (default 7842).
**Auth:** `--token <secret>` header check (optional; off by default for local use).

---

## Agent-side integration (in the Clarity runtime)

The runtime also supports an **HTTP mode** for the broker connection. If
`CLARITY_HITL_BROKER_URL` is set, `hitl_ask` will:

1. `POST {broker_url}/questions` with the question JSON instead of writing a
   file.
2. Poll `GET {broker_url}/questions/{key}` every 500 ms until the broker sets
   the status to `answered`.
3. Return the response string.

This enables remote broker deployments (e.g., agent on a cloud VM, operator on
laptop).

---

## Environment variables summary

| Variable | Default | Description |
|---|---|---|
| `CLARITY_HITL_DIR` | `.clarity-hitl/` | File handshake directory |
| `CLARITY_HITL_TIMEOUT_SECS` | `600` | Max wait for human response |
| `CLARITY_HITL_BROKER_URL` | (unset) | HTTP broker URL (overrides file mode) |

---

## Repository structure (clarity-hitl-broker)

```
clarity-hitl-broker/
├── package.json
├── src/
│   ├── cli.ts          — CLI entrypoint (watch, list, answer, cancel)
│   ├── watcher.ts      — fs.watch loop for question files
│   ├── server.ts       — Express server for web UI + HTTP API
│   ├── ui/             — React or vanilla JS single-page app
│   └── audit.ts        — JSONL audit log writer
├── README.md
└── docs/
    └── protocol.md     — This spec (copy or symlink)
```

---

## Non-goals

- The broker does **not** run Clarity programs — it only handles the I/O side
  of the `HumanInLoop` handshake.
- The broker does **not** provide authentication / multi-tenant isolation beyond
  an optional static token. For production deployments, put it behind a reverse
  proxy with proper auth.
- Long-term storage of interaction history is out of scope for v1 (the audit log
  is append-only JSONL).
