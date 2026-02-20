# Web Server (REQUIREMENTS)

**Status:** ⚠️ **BLOCKED** - Missing HTTP server built-ins
**Complexity:** Advanced
**Category:** Network, Web Development

## Overview

Simple HTTP server responding to GET/POST requests. Demonstrates routing, request handling, and response generation.

## Required Language Features

### 1. HTTP Server Built-ins

```clarity
effect[Network] function http_listen(port: Int64, handler: (Request) -> Response) -> Unit

type Request = {
  method: String,      // "GET", "POST", etc.
  path: String,        // "/users/123"
  headers: Map<String, String>,
  body: String
}

type Response = {
  status: Int64,       // 200, 404, 500, etc.
  headers: Map<String, String>,
  body: String
}
```

### 2. Map Type (for headers)

```clarity
type Map<K, V>
```

### 3. Higher-Order Functions (callback pattern)

```clarity
// Handler function type
type Handler = (Request) -> Response

// Route matching
function route(method: String, path: String, handler: Handler) -> Router
```

## Example Implementation

```clarity
effect[Network, Log] function main() -> Unit {
  print_string("Starting server on port 8080...");
  http_listen(8080, handle_request)
}

function handle_request(req: Request) -> Response {
  match req.method {
    "GET" -> handle_get(req),
    "POST" -> handle_post(req),
    _ -> response_404()
  }
}

function handle_get(req: Request) -> Response {
  match req.path {
    "/" -> response_ok("Hello, World!"),
    "/about" -> response_ok("About page"),
    "/api/health" -> response_json("{\"status\":\"ok\"}"),
    _ -> response_404()
  }
}

function handle_post(req: Request) -> Response {
  match req.path {
    "/api/echo" -> response_ok(req.body),
    _ -> response_404()
  }
}

function response_ok(body: String) -> Response {
  {
    status: 200,
    headers: map_from_list([("Content-Type", "text/plain")]),
    body: body
  }
}

function response_json(body: String) -> Response {
  {
    status: 200,
    headers: map_from_list([("Content-Type", "application/json")]),
    body: body
  }
}

function response_404() -> Response {
  {
    status: 404,
    headers: map_new(),
    body: "Not Found"
  }
}
```

## Learning Objectives

- HTTP server fundamentals
- Request routing
- Response generation
- Header management
- Callback patterns with higher-order functions

## Dependencies

- ❌ HTTP server built-ins (CRITICAL)
- ✅ Map type
- ⚠️ Higher-order functions with closures (or pass named functions)
- ⚠️ Async/event loop (currently blocking execution)

## Notes

This example assumes synchronous request handling. A production server would need:
- Async/await for non-blocking I/O
- Connection pooling
- Middleware pattern
- Error handling
