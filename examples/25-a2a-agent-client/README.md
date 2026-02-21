# A2A Agent Client

**Complexity:** Intermediate
**Category:** AI Interop, A2A Effect

## Description

Connect to any A2A-compatible (Agent-to-Agent) agent over HTTP. Discover its
capabilities, submit tasks as natural-language messages, poll for completion,
and cancel tasks in flight. Demonstrates the full A2A task lifecycle in Clarity.

## What This Example Demonstrates

- **`std/a2a` import** — using the A2A standard library
- **`discover(url)`** — fetch the agent card (capabilities JSON)
- **`submit(url, message)`** — create a task and get a task ID
- **`poll(url, task_id)`** — check task status with structured JSON
- **`cancel(url, task_id)`** — cancel a running task
- **`is_done(status)`** / **`is_failed(status)`** — check terminal states
- **`wait_for_result()`** — recursive polling via tail-call optimisation
- **A2A effect** — declaring agent-network access in function signatures

## Usage

```bash
# Discover what an agent can do
clarityc run main.clarity -f show_card -a "http://localhost:8080"

# Ask an agent a question and wait for the answer
clarityc run main.clarity -f ask \
  -a "http://localhost:8080" \
  -a "Summarise the A2A specification in two sentences"

# Cancel a task
clarityc run main.clarity -f cancel_task \
  -a "http://localhost:8080" \
  -a "clarity-1716000000000-ab3f"
```

## Protocol Notes

The A2A protocol (by Google) uses JSON-RPC 2.0 over HTTP POST:

| Operation | JSON-RPC method |
|-----------|----------------|
| discover  | `GET /.well-known/agent.json` |
| submit    | `tasks/send` |
| poll      | `tasks/get` |
| cancel    | `tasks/cancel` |

Task states: `submitted` → `working` → `completed` / `failed` / `canceled`

## Running a local A2A agent for testing

```bash
# Example: a simple Python A2A echo agent
# See https://github.com/google/A2A for reference implementations
```
