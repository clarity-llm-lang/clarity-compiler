# MCP Tool Caller

**Complexity:** Intermediate
**Category:** AI Interop, MCP Effect

## Description

Connect to any MCP (Model Context Protocol) server over HTTP, list its available
tools, and invoke them by name with JSON arguments. Demonstrates how Clarity
programs can integrate with the growing ecosystem of MCP tool servers.

## What This Example Demonstrates

- **`std/mcp` import** — using the MCP standard library
- **`connect(url)`** — open an MCP session by HTTP endpoint
- **`list_tools(session)`** — discover available tools as JSON
- **`call_tool(session, tool, args_json)`** — invoke a tool and read output
- **`disconnect(session)`** — release the session
- **MCP effect** — declaring MCP access in function signatures
- **Combining effects** — `effect[MCP, FileSystem]` for both MCP and CLI args

## Usage

```bash
# List all tools on a local MCP server
clarityc run main.clarity -f list_all -a "http://localhost:3000/mcp"

# Call a specific tool
clarityc run main.clarity -f run \
  -a "http://localhost:3000/mcp" \
  -a "read_file" \
  -a '{"path":"/etc/hostname"}'
```

## Running a local MCP server for testing

Many open-source MCP servers are available. For a quick local test:

```bash
# Using the reference filesystem MCP server (Node.js)
npx @modelcontextprotocol/server-filesystem /tmp

# Or any OpenAI-compatible MCP HTTP server on port 3000
```

## Protocol Notes

- The HTTP transport sends JSON-RPC 2.0 POST requests to the endpoint
- Both plain JSON and Server-Sent Events (SSE) responses are handled
- Authentication: add a Bearer token via the `Secret` effect if needed
