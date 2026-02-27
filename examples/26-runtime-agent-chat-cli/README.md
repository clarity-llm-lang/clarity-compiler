# 26-runtime-agent-chat-cli

Native Clarity CLI prototype for runtime agent chat.

Flow:
1. Prompt for runtime URL
2. Fetch `GET /api/agents/registry`
3. Show numbered agents and select one
4. Bootstrap run with `agent.run_created` + `agent.run_started`
5. Chat via `POST /api/agents/runs/:runId/messages`
6. Poll and render `GET /api/agents/runs/:runId/events`

Run:

```bash
clarityc run examples/26-runtime-agent-chat-cli/main.clarity -f main
```

Notes:
- Uses `std/json` helpers for registry/event parsing.
- Uses `http_request_full` for status-aware API calls.
- Event rendering is polling-based in this prototype. SSE support is available in `std/sse` and can be layered in for live streaming.
