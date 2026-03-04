// Network builtins: HTTP client, HTTP server, SSE client, mux, URL helpers.
import { INT64, STRING, UNIT, OPTION_STRING, } from "./types.js";
export const NETWORK_BUILTINS = [
    // --- Network HTTP client (require Network effect) ---
    {
        name: "http_request_full", params: [STRING, STRING, STRING, STRING], paramNames: ["method", "url", "headers_json", "body"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Network"], doc: "Like http_request but always returns Ok with a JSON object {\"status\": <int>, \"body\": <string>} for any HTTP response (even non-2xx). Returns Err only on network-level failures (DNS, timeout, etc.). Use json_get to extract fields.", category: "network",
    },
    {
        name: "http_get", params: [STRING], paramNames: ["url"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Network"], doc: "Perform an HTTP GET request. Returns Ok(response_body) on success or Err(message) on failure.", category: "network",
    },
    {
        name: "http_post", params: [STRING, STRING], paramNames: ["url", "body"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Network"], doc: "Perform an HTTP POST request with a text body. Returns Ok(response_body) on success or Err(message) on failure.", category: "network",
    },
    {
        name: "http_request", params: [STRING, STRING, STRING, STRING], paramNames: ["method", "url", "headers_json", "body"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Network"], doc: "Perform a generic HTTP request with custom method, URL, headers (as a JSON object string), and body. Returns Ok(response_body) on 2xx or Err(message) on failure. Pass \"{}\" for no custom headers or \"\" for no body.", category: "network",
    },
    // --- HTTP server operations (require Network effect) ---
    {
        name: "http_listen", params: [INT64], paramNames: ["port"],
        returnType: { kind: "Result", ok: INT64, err: STRING },
        effects: ["Network"], doc: "Start an HTTP server on the given port. Returns Ok(handle) on success or Err(message) if the port is unavailable. Use the handle with http_next_request, http_respond, and http_close_server. Example: match http_listen(8080) { Ok(h) -> h, Err(e) -> ... }.", category: "network",
    },
    {
        name: "http_next_request", params: [INT64], paramNames: ["handle"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Network"], doc: "Block until the next HTTP request arrives on the server identified by handle. Returns Ok(request_json) where request_json is a JSON object with fields: id (request identifier Int64), method (String), path (String), query (String, includes leading ?), headers (JSON object), body (String). Use the id with http_respond or http_start_sse.", category: "network",
    },
    {
        name: "http_respond", params: [INT64, INT64, STRING, STRING], paramNames: ["request_id", "status", "headers_json", "body"],
        returnType: UNIT,
        effects: ["Network"], doc: "Send an HTTP response for a request. request_id is the id field from the http_next_request JSON. status is the HTTP status code (e.g. 200). headers_json is a JSON object of response headers — pass \"{}\" for defaults. body is the response body string.", category: "network",
    },
    {
        name: "http_close_server", params: [INT64], paramNames: ["handle"],
        returnType: UNIT,
        effects: ["Network"], doc: "Shut down an HTTP server started with http_listen and release the port.", category: "network",
    },
    {
        name: "http_start_sse", params: [INT64, STRING], paramNames: ["request_id", "headers_json"],
        returnType: UNIT,
        effects: ["Network"], doc: "Start a Server-Sent Events (SSE) stream for an HTTP request. Sends the SSE response headers and keeps the connection open. Use http_send_sse_event to push events and http_close_sse to close the stream. headers_json adds extra response headers (pass \"{}\" for defaults).", category: "network",
    },
    {
        name: "http_send_sse_event", params: [INT64, STRING], paramNames: ["request_id", "event_data"],
        returnType: UNIT,
        effects: ["Network"], doc: "Send a Server-Sent Events data event. event_data is the payload (the 'data:' line content). Requires a prior http_start_sse call for the same request_id.", category: "network",
    },
    {
        name: "http_close_sse", params: [INT64], paramNames: ["request_id"],
        returnType: UNIT,
        effects: ["Network"], doc: "Close an SSE stream and send the final response. Terminates the connection started by http_start_sse for the given request_id.", category: "network",
    },
    // --- SSE client (require Network effect) ---
    {
        name: "sse_connect", params: [STRING, STRING], paramNames: ["url", "headers_json"],
        returnType: { kind: "Result", ok: INT64, err: STRING },
        effects: ["Network"], doc: "Open a Server-Sent Events (SSE) stream. `headers_json` is a JSON object of extra request headers, e.g. {\"Authorization\":\"Bearer tok\"} or \"{}\" for none. Returns Ok(handle) on success or Err(message) on connection failure. Use sse_next_event(handle) to read events one at a time, and sse_close(handle) when done.", category: "network",
    },
    {
        name: "sse_next_event", params: [INT64], paramNames: ["handle"],
        returnType: OPTION_STRING,
        effects: ["Network"], doc: "Read the next event from an SSE stream. Blocks until an event arrives. Returns Some(data) with the raw data payload of the event, or None when the stream ends or connection is closed. The data value is the raw text after 'data:' in the SSE frame (typically JSON). Call sse_close(handle) after None is returned.", category: "network",
    },
    {
        name: "sse_close", params: [INT64], paramNames: ["handle"],
        returnType: UNIT,
        effects: ["Network"], doc: "Close an SSE stream handle and release its resources. Safe to call after the stream has ended.", category: "network",
    },
    {
        name: "sse_next_event_timeout", params: [INT64, INT64], paramNames: ["handle", "timeout_ms"],
        returnType: OPTION_STRING,
        effects: ["Network"], doc: "Read the next event from an SSE stream, blocking for at most timeout_ms milliseconds. Returns Some(data) when an event arrives within the timeout, None on timeout, and None when the stream ends or errors. Unlike sse_next_event (300 s hard timeout), this lets you poll with short timeouts and interleave other work such as stdin reads. Example: sse_next_event_timeout(h, 200).", category: "network",
    },
    // --- URL encoding helpers (pure, no effects) ---
    { name: "url_encode", params: [STRING], paramNames: ["s"], returnType: STRING, effects: [], doc: "Percent-encode a string for safe use as a URL path segment or query parameter value. Uses encodeURIComponent semantics — encodes all characters except A\u2013Z a\u2013z 0\u20139 - _ . ! ~ * ' ( ). Example: url_encode(\"hello world\") \u2192 \"hello%20world\", url_encode(\"a/b\") \u2192 \"a%2Fb\".", category: "network" },
    { name: "url_decode", params: [STRING], paramNames: ["s"], returnType: STRING, effects: [], doc: "Decode a percent-encoded URL component. Reverses url_encode. Returns the input unchanged if decoding fails (malformed sequences). Example: url_decode(\"hello%20world\") \u2192 \"hello world\".", category: "network" },
    // --- Mux builtins (multi-stream SSE fan-in) ---
    { name: "mux_open", params: [], paramNames: [], returnType: INT64, effects: [], doc: "Create a new stream multiplexer. Returns a handle for use with mux_add, mux_next, mux_remove, and mux_close. The mux is idle until streams are added with mux_add. No effect required — the mux is just a local handle.", category: "network" },
    {
        name: "mux_add", params: [INT64, STRING, STRING, STRING], paramNames: ["handle", "stream_id", "url", "headers_json"],
        returnType: UNIT, effects: ["Network"], doc: "Connect an SSE stream to the mux. stream_id is a caller-assigned label returned with each event from mux_next. url is the SSE endpoint. headers_json is a JSON object of request headers (pass \"{}\" for defaults). Events from this stream will be available via mux_next.", category: "network",
    },
    {
        name: "mux_next", params: [INT64, INT64], paramNames: ["handle", "timeout_ms"],
        returnType: OPTION_STRING, effects: ["Network"], doc: "Block until an event arrives from any stream in the mux, or until timeout_ms elapses. Returns Some(event_json) where event_json is a JSON object with fields: id (stream_id String), event (String event data, or null if the stream ended/errored), ended (Bool, true if stream closed normally), error (String, present if stream errored). Returns None on timeout.", category: "network",
    },
    {
        name: "mux_remove", params: [INT64, STRING], paramNames: ["handle", "stream_id"],
        returnType: UNIT, effects: ["Network"], doc: "Disconnect and remove a stream from the mux. The stream_id must match one passed to mux_add. In-flight events from this stream may still arrive via mux_next briefly after removal.", category: "network",
    },
    {
        name: "mux_close", params: [INT64], paramNames: ["handle"],
        returnType: UNIT, effects: ["Network"], doc: "Close all streams in the mux and release the handle. After this call the handle is invalid.", category: "network",
    },
];
//# sourceMappingURL=network.js.map