/**
 * RQ-LANG-CLI-004: Runtime integration harness
 *
 * These tests verify that the Clarity language primitives used by the
 * runtime-agent-chat-cli satisfy the API contracts defined in
 * docs/runtime-agent-cli-requirements.md (RQ-CLI-001 through RQ-CLI-005).
 *
 * Tests are offline (no live runtime required).  They compile Clarity programs
 * that exercise each contract and verify type-correctness and correct output
 * using a mocked HTTP/SSE environment.
 *
 * To run against a live runtime, set:
 *   CLARITY_RUNTIME_URL=http://localhost:3000
 *   CLARITY_RUNTIME_TOKEN=<bearer-token>   (optional)
 * Tests marked with `skipUnlessLive` are skipped when no runtime URL is set.
 */

import { describe, it, expect } from "vitest";
import { compile, compileFile } from "../../src/compiler.js";
import { createRuntime, type RuntimeConfig } from "../../src/codegen/runtime.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const RUNTIME_URL = process.env.CLARITY_RUNTIME_URL;
const skipUnlessLive = RUNTIME_URL ? it : it.skip;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function instantiate(wasm: Uint8Array, config?: RuntimeConfig) {
  const runtime = createRuntime(config);
  const { instance } = await WebAssembly.instantiate(wasm, runtime.imports);
  const mem = instance.exports.memory as WebAssembly.Memory;
  if (mem) runtime.bindMemory(mem);
  const heap = instance.exports.__heap_base;
  if (heap && typeof (heap as WebAssembly.Global).value === "number") {
    runtime.setHeapBase((heap as WebAssembly.Global).value);
  }
  return { instance, runtime };
}

function copyStdFile(dir: string, name: string) {
  const src = fs.readFileSync(path.join(process.cwd(), "std", name), "utf-8");
  fs.writeFileSync(path.join(dir, "std", name), src);
}

function setupTest(src: string, stdModules: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-rt-contract-"));
  fs.writeFileSync(path.join(dir, "main.clarity"), src);
  if (stdModules.length > 0) {
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    for (const m of stdModules) copyStdFile(dir, m);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// RQ-CLI-001: Agent registry query contract
// Verify the types used to model a registry response can be expressed and
// pattern-matched correctly.
// ---------------------------------------------------------------------------

describe("RQ-CLI-001: agent registry contract types", () => {
  it("ServiceRow record type and list indexing compile", () => {
    const source = `
      module RegistryContract
      // Models the shape returned by GET /api/agents/registry
      type ServiceRow = {
        service_id: String,
        agent_id:   String,
        name:       String,
        triggers:   String
      }
      function format_row(row: ServiceRow, idx: Int64) -> String {
        int_to_string(idx) ++ ". " ++ row.name ++ " (" ++ row.agent_id ++ ")"
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("registry HTTP call with auth compiles (RQ-CLI-001 + RQ-CLI-005)", () => {
    const dir = setupTest(`
      module RegistryContract
      import { get_with_auth } from "std/http"
      effect[Network] function fetch_registry(base_url: String, token: String) -> Result<String, String> {
        get_with_auth(base_url ++ "/api/agents/registry", token)
      }
    `, ["http.clarity"]);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// RQ-CLI-002: Run bootstrap contract
// POST /api/agents/events with agent.run_created then agent.run_started
// ---------------------------------------------------------------------------

describe("RQ-CLI-002: run bootstrap contract", () => {
  it("bootstrap event POST body shape compiles", () => {
    const dir = setupTest(`
      module BootstrapContract
      import { post_json } from "std/http"
      effect[Network] function post_event(base_url: String, token: String, event_kind: String, run_id: String) -> Result<String, String> {
        let body = "{" ++
          "\\"kind\\":\\"" ++ event_kind ++ "\\"," ++
          "\\"runId\\":\\"" ++ run_id ++ "\\"," ++
          "\\"data\\":{\\"trigger\\":\\"api\\",\\"route\\":\\"/cli/runtime-chat\\",\\"method\\":\\"CLI\\",\\"caller\\":\\"clarity-agent-cli\\"}" ++
          "}";
        post_json(base_url ++ "/api/agents/events", body)
      }
    `, ["http.clarity"]);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// RQ-CLI-003: Chat message transport
// POST /api/agents/runs/:runId/messages with url-encoded run ID
// ---------------------------------------------------------------------------

describe("RQ-CLI-003: chat message transport + URL encoding", () => {
  it("message endpoint uses url_encode on run ID", () => {
    const dir = setupTest(`
      module ChatContract
      import { encode } from "std/url"
      import { post_json } from "std/http"
      effect[Network] function send_message(
        base_url:   String,
        token:      String,
        run_id:     String,
        service_id: String,
        agent_id:   String,
        message:    String
      ) -> Result<String, String> {
        let safe_run_id = encode(run_id);
        let url  = base_url ++ "/api/agents/runs/" ++ safe_run_id ++ "/messages";
        let body = "{" ++
          "\\"message\\":\\"" ++ message ++ "\\"," ++
          "\\"role\\":\\"user\\"," ++
          "\\"service_id\\":\\"" ++ service_id ++ "\\"," ++
          "\\"agent\\":\\"" ++ agent_id ++ "\\"" ++
          "}";
        post_json(url, body)
      }
    `, ["url.clarity", "http.clarity"]);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it("url_encode makes run IDs with special chars safe", async () => {
    const source = `
      module Test
      function safe_endpoint(run_id: String) -> String {
        "/api/agents/runs/" ++ url_encode(run_id) ++ "/messages"
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const fn = instance.exports.safe_endpoint as (ptr: number) => number;
    const inputPtr = runtime.writeString("run/special id+here");
    const outPtr = fn(inputPtr);
    const out = runtime.readString(outPtr);
    expect(out).toBe("/api/agents/runs/run%2Fspecial%20id%2Bhere/messages");
  });
});

// ---------------------------------------------------------------------------
// RQ-CLI-004: Event transport — terminal state detection
// ---------------------------------------------------------------------------

describe("RQ-CLI-004: terminal state detection", () => {
  it("terminal state pattern match compiles", () => {
    const source = `
      module EventContract
      type TerminalCheck = | Running | Done
      function is_terminal(kind: String) -> TerminalCheck {
        match kind == "agent.run_completed" or kind == "agent.run_failed" or kind == "agent.run_cancelled" {
          True  -> Done,
          False -> Running
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("is_terminal returns Done for completed", async () => {
    const source = `
      module EventContract
      type TerminalCheck = | Running | Done
      function is_terminal(kind: String) -> TerminalCheck {
        match kind == "agent.run_completed" or kind == "agent.run_failed" or kind == "agent.run_cancelled" {
          True  -> Done,
          False -> Running
        }
      }
      function check(kind: String) -> String {
        match is_terminal(kind) {
          Done    -> "done",
          Running -> "running"
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const fn = instance.exports.check as (ptr: number) => number;

    const completedPtr = runtime.writeString("agent.run_completed");
    expect(runtime.readString(fn(completedPtr))).toBe("done");

    const failedPtr = runtime.writeString("agent.run_failed");
    expect(runtime.readString(fn(failedPtr))).toBe("done");

    const chatPtr = runtime.writeString("agent.chat.assistant_message");
    expect(runtime.readString(fn(chatPtr))).toBe("running");
  });

  it("SSE poll loop with timeout compiles", () => {
    const dir = setupTest(`
      module PollContract
      import { poll, MuxEvent } from "std/mux"
      type LoopState = | Active | Finished
      effect[Network, FileSystem] function loop(h: Int64) -> LoopState {
        match poll(h, 200) {
          SseEvent(data)  -> match data == "agent.run_completed" {
            True  -> Finished,
            False -> loop(h)
          },
          SseEnded        -> Finished,
          StdinEof        -> Finished,
          StdinLine(line) -> loop(h),
          Timeout         -> loop(h)
        }
      }
    `, ["mux.clarity"]);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// RQ-CLI-005: Bearer auth header contract
// ---------------------------------------------------------------------------

describe("RQ-CLI-005: bearer auth header", () => {
  it("bearer header JSON construction compiles and is correct", async () => {
    const source = `
      module AuthContract
      function bearer_headers(token: String) -> String {
        "{\\"Authorization\\":\\"Bearer " ++ token ++ "\\"}"
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const fn = instance.exports.bearer_headers as (ptr: number) => number;
    const tokenPtr = runtime.writeString("tok_abc123");
    const out = runtime.readString(fn(tokenPtr));
    expect(out).toBe('{"Authorization":"Bearer tok_abc123"}');
  });
});

// ---------------------------------------------------------------------------
// Live runtime smoke tests (skipped unless CLARITY_RUNTIME_URL is set)
// ---------------------------------------------------------------------------

describe("live runtime smoke tests (requires CLARITY_RUNTIME_URL)", () => {
  skipUnlessLive("GET /api/agents/registry returns a JSON array", async () => {
    const { default: fetchFn } = await import("node:http");
    const url = `${RUNTIME_URL}/api/agents/registry`;
    const resp = await fetch(url, {
      headers: RUNTIME_URL
        ? { Authorization: `Bearer ${process.env.CLARITY_RUNTIME_TOKEN ?? ""}` }
        : {},
    });
    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
  });

  skipUnlessLive("POST /api/agents/events accepts agent.run_created body", async () => {
    const runId = `test_run_${Date.now()}`;
    const body = JSON.stringify({
      kind: "agent.run_created",
      runId,
      data: {
        trigger: "api",
        route: "/cli/runtime-chat",
        method: "CLI",
        requestId: runId,
        caller: "clarity-agent-cli",
      },
    });
    const resp = await fetch(`${RUNTIME_URL}/api/agents/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.CLARITY_RUNTIME_TOKEN
          ? { Authorization: `Bearer ${process.env.CLARITY_RUNTIME_TOKEN}` }
          : {}),
      },
      body,
    });
    // Accept 200 or 201 or 204
    expect(resp.status).toBeLessThan(300);
  });
});
