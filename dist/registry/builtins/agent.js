// Agent builtins: secret, MCP, A2A, trace, persist, hitl,
// and arena_restore_keeping_str (used by std/agent).
import { INT64, STRING, BOOL, UNIT, OPTION_STRING, } from "./types.js";
export const AGENT_BUILTINS = [
    // --- Secret operations (require Secret effect) ---
    {
        name: "get_secret", params: [STRING], paramNames: ["name"],
        returnType: {
            kind: "Union",
            name: "Option<String>",
            variants: [
                { name: "Some", fields: new Map([["value", STRING]]) },
                { name: "None", fields: new Map() },
            ],
        },
        effects: ["Secret"], doc: "Read a named secret from environment variables. Returns Some(value) if the variable is set, None if not. Use this for API keys and credentials instead of hard-coding them. Example: get_secret(\"OPENAI_API_KEY\").", category: "secret",
    },
    // --- MCP operations (require MCP effect) ---
    {
        name: "mcp_connect", params: [STRING], paramNames: ["url"],
        returnType: { kind: "Result", ok: INT64, err: STRING },
        effects: ["MCP"], doc: "Register an MCP server HTTP endpoint. Returns an opaque session handle (Int64) on success, or Err(message) if the URL is unreachable. Use the session handle with mcp_list_tools and mcp_call_tool. Example: mcp_connect(\"http://localhost:3000/mcp\").", category: "mcp",
    },
    {
        name: "mcp_list_tools", params: [INT64], paramNames: ["session"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["MCP"], doc: "List tools available in an MCP session. Returns a JSON string containing the array of tool descriptors on success. Parse with json_parse or inspect manually.", category: "mcp",
    },
    {
        name: "mcp_call_tool", params: [INT64, STRING, STRING], paramNames: ["session", "tool", "args_json"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["MCP"], doc: "Call an MCP tool by name with JSON-encoded arguments. `args_json` must be a JSON object string, e.g. \"{\\\"path\\\":\\\"/tmp/foo\\\"}\". Returns the tool output as a string. Example: mcp_call_tool(session, \"read_file\", \"{\\\"path\\\":\\\"/etc/hosts\\\"}\").", category: "mcp",
    },
    {
        name: "mcp_disconnect", params: [INT64], paramNames: ["session"],
        returnType: UNIT, effects: ["MCP"], doc: "Close an MCP session and release its resources. Safe to call even if the session was already closed.", category: "mcp",
    },
    // --- A2A operations (require A2A effect) ---
    {
        name: "a2a_discover", params: [STRING], paramNames: ["url"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["A2A"], doc: "Fetch the agent card from an A2A-compatible agent at the given base URL. Returns Ok(agent_card_json) on success. The agent card describes the agent's capabilities, name, and supported skills. Example: a2a_discover(\"http://localhost:8080\").", category: "a2a",
    },
    {
        name: "a2a_submit", params: [STRING, STRING], paramNames: ["url", "message"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["A2A"], doc: "Submit a text message as a task to an A2A agent. Returns Ok(task_id) on success. The task_id can be used with a2a_poll and a2a_cancel. Example: a2a_submit(\"http://localhost:8080\", \"Summarise this text: ...\").", category: "a2a",
    },
    {
        name: "a2a_poll", params: [STRING, STRING], paramNames: ["url", "task_id"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["A2A"], doc: "Poll for the status of an A2A task. Returns Ok(status_json) containing a 'status' field (\"submitted\", \"working\", \"completed\", \"failed\", \"canceled\") and, when completed, an 'output' field with the agent's response text.", category: "a2a",
    },
    {
        name: "a2a_cancel", params: [STRING, STRING], paramNames: ["url", "task_id"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["A2A"], doc: "Cancel a running A2A task. Returns Ok(status_json) with the final task state, or Err if the task could not be cancelled (e.g. already completed).", category: "a2a",
    },
    // --- Trace operations (require Trace effect) ---
    { name: "trace_start", params: [STRING], paramNames: ["op"], returnType: INT64, effects: ["Trace"], doc: "Start a new trace span with the given operation name. Returns an opaque span ID (Int64) that must be passed to trace_end and trace_log. Example: let id = trace_start(\"embed_query\").", category: "trace" },
    { name: "trace_end", params: [INT64], paramNames: ["span_id"], returnType: UNIT, effects: ["Trace"], doc: "End the span identified by span_id and flush it to the audit log (CLARITY_AUDIT_LOG) with its duration and any logged events. Calling trace_end on an unknown span is a no-op.", category: "trace" },
    { name: "trace_log", params: [INT64, STRING], paramNames: ["span_id", "message"], returnType: UNIT, effects: ["Trace"], doc: "Append a timestamped message to the span identified by span_id. Messages appear in the audit log entry when trace_end is called. Example: trace_log(id, \"retrieved 5 chunks\").", category: "trace" },
    // --- Persist operations (require Persist effect) ---
    {
        name: "checkpoint_save", params: [STRING, STRING], paramNames: ["key", "value"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Persist"], doc: "Save a string value under the given key. The value is written to CLARITY_CHECKPOINT_DIR (default .clarity-checkpoints/). Returns Ok(\"\") on success or Err(message) on failure. Example: checkpoint_save(\"agent/step\", state_json).", category: "persist",
    },
    {
        name: "checkpoint_load", params: [STRING], paramNames: ["key"],
        returnType: OPTION_STRING, effects: ["Persist"], doc: "Load a previously saved checkpoint by key. Returns Some(value) if the key exists, None if it has never been saved or was deleted. Example: let saved = checkpoint_load(\"agent/step\").", category: "persist",
    },
    {
        name: "checkpoint_delete", params: [STRING], paramNames: ["key"],
        returnType: UNIT, effects: ["Persist"], doc: "Delete the checkpoint stored under the given key. Safe to call if the key does not exist. Example: checkpoint_delete(\"agent/step\").", category: "persist",
    },
    {
        name: "checkpoint_save_raw", params: [STRING, STRING], paramNames: ["key", "value"],
        returnType: BOOL, effects: ["Persist"], doc: "Save a string value under the given key, returning True on success or False on failure. Unlike checkpoint_save, this returns a plain Bool (no heap allocation), making it safe to call before arena_restore(). Example: let ok = checkpoint_save_raw(\"agent/step\", state_json).", category: "persist",
    },
    // --- HumanInLoop operations (require HumanInLoop effect) ---
    {
        name: "hitl_ask", params: [STRING, STRING], paramNames: ["key", "question"],
        returnType: STRING, effects: ["HumanInLoop"], doc: "Pause execution and present a question to a human operator. Writes the question to CLARITY_HITL_DIR (default .clarity-hitl/) as {key}.question JSON, then blocks until a human (or the clarity-hitl-broker CLI/web UI) writes a response to {key}.answer. Returns the response string. Configurable timeout via CLARITY_HITL_TIMEOUT_SECS (default 600). Example: let feedback = hitl_ask(\"review-step\", \"Does this summary look correct? \" ++ summary).", category: "hitl",
    },
    // --- Arena helper used by std/agent (pure, no effect) ---
    {
        name: "arena_restore_keeping_str", params: [INT64, STRING], paramNames: ["mark", "str"],
        returnType: STRING, effects: [], doc: "Restore the heap arena to the given mark (freeing all allocations made after the mark), but first copy the given string to below the mark so it survives the restore. Returns the new pointer for the preserved string. Use this to free temporary allocations from a step function while keeping the step's result: let mark = arena_save(); let result = step(x); let kept = arena_restore_keeping_str(mark, result). After this call, 'kept' is valid but any other pointer obtained after arena_save() is invalid.", category: "memory",
    },
];
//# sourceMappingURL=agent.js.map