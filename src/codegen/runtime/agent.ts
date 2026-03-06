// Agent builtins: secrets, MCP, A2A, trace, persist, hitl.

import * as nodeFs from "node:fs";
import { syncHttpRequest } from "./network.js";
import type { SharedHelpers } from "./types.js";

function callMcp(url: string, body: string): string {
  const resp = syncHttpRequest({ url, method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" }, body, timeoutMs: 60000 });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
  const raw = resp.body;
  if (raw.trimStart().startsWith("data:")) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    const last = lines[lines.length - 1];
    return last ? last.slice("data:".length).trim() : "{}";
  }
  return raw;
}

function callA2A(baseUrl: string, body: string): string {
  const resp = syncHttpRequest({ url: baseUrl, method: "POST", headers: { "Content-Type": "application/json" }, body, timeoutMs: 60000 });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
  return resp.body;
}

export function createAgentRuntime(
  h: SharedHelpers,
  mcpSessions: Map<number, { url: string }>,
  getMcpNextId: () => number,
  spanTable: Map<number, { op: string; start: number; events: string[] }>,
  getNextSpanId: () => number,
) {
  return {
    // --- Secret operations ---
    get_secret(namePtr: number): number {
      const name = h.readString(namePtr);
      const effectErr = h.policyCheckEffect("Secret");
      if (effectErr) { h.policyAuditLog({ effect: "Secret", op: "get_secret", name, result: "denied", reason: effectErr }); return h.allocOptionI32(null); }
      const value = process.env[name];
      h.policyAuditLog({ effect: "Secret", op: "get_secret", name, result: value !== undefined ? "ok" : "not_found" });
      if (value === undefined) return h.allocOptionI32(null);
      return h.allocOptionI32(h.writeString(value));
    },

    // --- MCP operations ---
    mcp_connect(urlPtr: number): number {
      const url = h.readString(urlPtr);
      const effectErr = h.policyCheckEffect("MCP");
      if (effectErr) { h.policyAuditLog({ effect: "MCP", op: "mcp_connect", url, result: "denied", reason: effectErr }); return h.allocResultI64(false, 0n, h.writeString(effectErr)); }
      const urlErr = h.policyCheckUrl(url);
      if (urlErr) { h.policyAuditLog({ effect: "MCP", op: "mcp_connect", url, result: "denied", reason: urlErr }); return h.allocResultI64(false, 0n, h.writeString(urlErr)); }
      const id = getMcpNextId();
      mcpSessions.set(id, { url });
      h.policyAuditLog({ effect: "MCP", op: "mcp_connect", url, result: "ok", session_id: id });
      return h.allocResultI64(true, BigInt(id));
    },

    mcp_list_tools(sessionId: bigint): number {
      const session = mcpSessions.get(Number(sessionId));
      if (!session) return h.allocResultString(false, h.writeString(`Unknown MCP session: ${sessionId}`));
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      try {
        const t0 = Date.now();
        const raw = callMcp(session.url, body);
        const parsed = JSON.parse(raw) as { result?: { tools?: unknown[] }; error?: { message?: string } };
        if (parsed.error) { h.policyAuditLog({ effect: "MCP", op: "mcp_list_tools", url: session.url, result: "error" }); return h.allocResultString(false, h.writeString(`MCP error: ${parsed.error.message ?? "unknown"}`)); }
        h.policyAuditLog({ effect: "MCP", op: "mcp_list_tools", url: session.url, result: "ok", duration_ms: Date.now() - t0 });
        return h.allocResultString(true, h.writeString(JSON.stringify(parsed.result?.tools ?? [])));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        h.policyAuditLog({ effect: "MCP", op: "mcp_list_tools", url: session.url, result: "error" });
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    mcp_call_tool(sessionId: bigint, toolPtr: number, argsPtr: number): number {
      const session = mcpSessions.get(Number(sessionId));
      if (!session) return h.allocResultString(false, h.writeString(`Unknown MCP session: ${sessionId}`));
      const tool = h.readString(toolPtr);
      const argsJson = h.readString(argsPtr);
      let args: unknown;
      try { args = JSON.parse(argsJson); } catch { args = {}; }
      const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
      try {
        const t0 = Date.now();
        const raw = callMcp(session.url, body);
        const parsed = JSON.parse(raw) as { result?: { content?: Array<{ type: string; text?: string }> }; error?: { message?: string } };
        const duration_ms = Date.now() - t0;
        if (parsed.error) {
          h.policyAuditLog({ effect: "MCP", op: "mcp_call_tool", url: session.url, tool, result: "error" });
          h.emitAgentEvent({ kind: "agent.tool_called", data: { tool, url: session.url, result: "error", error: parsed.error.message ?? "unknown", duration_ms } });
          return h.allocResultString(false, h.writeString(`MCP error: ${parsed.error.message ?? "unknown"}`));
        }
        const content = parsed.result?.content ?? [];
        const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
        h.policyAuditLog({ effect: "MCP", op: "mcp_call_tool", url: session.url, tool, result: "ok", duration_ms });
        h.emitAgentEvent({ kind: "agent.tool_called", data: { tool, url: session.url, result: "ok", output_length: text.length, duration_ms } });
        return h.allocResultString(true, h.writeString(text || JSON.stringify(parsed.result)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        h.policyAuditLog({ effect: "MCP", op: "mcp_call_tool", url: session.url, tool, result: "error" });
        h.emitAgentEvent({ kind: "agent.tool_called", data: { tool, url: session.url, result: "error", error: msg } });
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    mcp_disconnect(sessionId: bigint): void {
      mcpSessions.delete(Number(sessionId));
    },

    // --- A2A operations ---
    a2a_discover(urlPtr: number): number {
      const baseUrl = h.readString(urlPtr).replace(/\/$/, "");
      const effectErr = h.policyCheckEffect("A2A");
      if (effectErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "denied", reason: effectErr }); return h.allocResultString(false, h.writeString(effectErr)); }
      const urlErr = h.policyCheckUrl(baseUrl);
      if (urlErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "denied", reason: urlErr }); return h.allocResultString(false, h.writeString(urlErr)); }
      try {
        const t0 = Date.now();
        const resp = syncHttpRequest({ url: `${baseUrl}/.well-known/agent.json`, timeoutMs: 10000 });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
        h.policyAuditLog({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "ok", duration_ms: Date.now() - t0 });
        return h.allocResultString(true, h.writeString(resp.body.trim()));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        h.policyAuditLog({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "error" });
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    a2a_submit(urlPtr: number, messagePtr: number): number {
      const baseUrl = h.readString(urlPtr).replace(/\/$/, "");
      const message = h.readString(messagePtr);
      const effectErr = h.policyCheckEffect("A2A");
      if (effectErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "denied", reason: effectErr }); return h.allocResultString(false, h.writeString(effectErr)); }
      const urlErr = h.policyCheckUrl(baseUrl);
      if (urlErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "denied", reason: urlErr }); return h.allocResultString(false, h.writeString(urlErr)); }
      const taskId = `clarity-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
      const body = JSON.stringify({ jsonrpc: "2.0", id: taskId, method: "tasks/send", params: { id: taskId, message: { role: "user", parts: [{ type: "text", text: message }] } } });
      try {
        const t0 = Date.now();
        const raw = callA2A(baseUrl, body);
        const parsed = JSON.parse(raw) as { result?: { id?: string; status?: { state?: string } }; error?: { message?: string } };
        const duration_ms = Date.now() - t0;
        if (parsed.error) {
          h.policyAuditLog({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "error" });
          h.emitAgentEvent({ kind: "agent.a2a_task_submitted", data: { url: baseUrl, result: "error", error: parsed.error.message ?? "unknown", duration_ms } });
          return h.allocResultString(false, h.writeString(`A2A error: ${parsed.error.message ?? "unknown"}`));
        }
        const returnedId = parsed.result?.id ?? taskId;
        h.policyAuditLog({ effect: "A2A", op: "a2a_submit", url: baseUrl, task_id: returnedId, result: "ok", duration_ms });
        h.emitAgentEvent({ kind: "agent.a2a_task_submitted", data: { url: baseUrl, task_id: returnedId, result: "ok", duration_ms } });
        return h.allocResultString(true, h.writeString(returnedId));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        h.policyAuditLog({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "error" });
        h.emitAgentEvent({ kind: "agent.a2a_task_submitted", data: { url: baseUrl, result: "error", error: msg } });
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    a2a_poll(urlPtr: number, taskIdPtr: number): number {
      const baseUrl = h.readString(urlPtr).replace(/\/$/, "");
      const taskId = h.readString(taskIdPtr);
      const effectErr = h.policyCheckEffect("A2A");
      if (effectErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "denied", reason: effectErr }); return h.allocResultString(false, h.writeString(effectErr)); }
      const urlErr = h.policyCheckUrl(baseUrl);
      if (urlErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "denied", reason: urlErr }); return h.allocResultString(false, h.writeString(urlErr)); }
      const body = JSON.stringify({ jsonrpc: "2.0", id: `poll-${Date.now()}`, method: "tasks/get", params: { id: taskId } });
      try {
        const t0 = Date.now();
        const raw = callA2A(baseUrl, body);
        const parsed = JSON.parse(raw) as { result?: { id?: string; status?: { state?: string }; artifacts?: Array<{ parts?: Array<{ type: string; text?: string }> }> }; error?: { message?: string } };
        const duration_ms = Date.now() - t0;
        if (parsed.error) {
          h.policyAuditLog({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "error" });
          h.emitAgentEvent({ kind: "agent.a2a_task_updated", data: { url: baseUrl, task_id: taskId, result: "error", error: parsed.error.message ?? "unknown", duration_ms } });
          return h.allocResultString(false, h.writeString(`A2A error: ${parsed.error.message ?? "unknown"}`));
        }
        const result = parsed.result ?? {};
        const artParts = (result.artifacts ?? []).flatMap((a) => a.parts ?? []);
        const outputText = artParts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
        const summary = { id: result.id ?? taskId, status: result.status?.state ?? "unknown", output: outputText };
        h.policyAuditLog({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, status: summary.status, result: "ok", duration_ms });
        h.emitAgentEvent({ kind: "agent.a2a_task_updated", data: { url: baseUrl, task_id: taskId, status: summary.status, result: "ok", duration_ms } });
        return h.allocResultString(true, h.writeString(JSON.stringify(summary)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        h.policyAuditLog({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "error" });
        h.emitAgentEvent({ kind: "agent.a2a_task_updated", data: { url: baseUrl, task_id: taskId, result: "error", error: msg } });
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    a2a_cancel(urlPtr: number, taskIdPtr: number): number {
      const baseUrl = h.readString(urlPtr).replace(/\/$/, "");
      const taskId = h.readString(taskIdPtr);
      const effectErr = h.policyCheckEffect("A2A");
      if (effectErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "denied", reason: effectErr }); return h.allocResultString(false, h.writeString(effectErr)); }
      const urlErr = h.policyCheckUrl(baseUrl);
      if (urlErr) { h.policyAuditLog({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "denied", reason: urlErr }); return h.allocResultString(false, h.writeString(urlErr)); }
      const body = JSON.stringify({ jsonrpc: "2.0", id: `cancel-${Date.now()}`, method: "tasks/cancel", params: { id: taskId } });
      try {
        const t0 = Date.now();
        const raw = callA2A(baseUrl, body);
        const parsed = JSON.parse(raw) as { result?: { id?: string; status?: { state?: string } }; error?: { message?: string } };
        const duration_ms = Date.now() - t0;
        if (parsed.error) {
          h.policyAuditLog({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "error" });
          h.emitAgentEvent({ kind: "agent.a2a_task_cancelled", data: { url: baseUrl, task_id: taskId, result: "error", error: parsed.error.message ?? "unknown", duration_ms } });
          return h.allocResultString(false, h.writeString(`A2A error: ${parsed.error.message ?? "unknown"}`));
        }
        const result = parsed.result ?? {};
        const summary = { id: result.id ?? taskId, status: result.status?.state ?? "canceled" };
        h.policyAuditLog({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "ok", duration_ms });
        h.emitAgentEvent({ kind: "agent.a2a_task_cancelled", data: { url: baseUrl, task_id: taskId, result: "ok", duration_ms } });
        return h.allocResultString(true, h.writeString(JSON.stringify(summary)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        h.policyAuditLog({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "error" });
        h.emitAgentEvent({ kind: "agent.a2a_task_cancelled", data: { url: baseUrl, task_id: taskId, result: "error", error: msg } });
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    // --- Trace operations ---
    trace_start(opPtr: number): bigint {
      const op = h.readString(opPtr);
      const effectErr = h.policyCheckEffect("Trace");
      if (effectErr) return 0n;
      const spanId = getNextSpanId();
      spanTable.set(spanId, { op, start: Date.now(), events: [] });
      return BigInt(spanId);
    },

    trace_end(spanIdBig: bigint): void {
      const spanId = Number(spanIdBig);
      const span = spanTable.get(spanId);
      if (!span) return;
      const duration_ms = Date.now() - span.start;
      h.policyAuditLog({ effect: "Trace", op: span.op, span_id: spanId, duration_ms, events: span.events });
      spanTable.delete(spanId);
    },

    trace_log(spanIdBig: bigint, messagePtr: number): void {
      const spanId = Number(spanIdBig);
      const message = h.readString(messagePtr);
      const span = spanTable.get(spanId);
      if (span) span.events.push(`${Date.now() - span.start}ms: ${message}`);
    },

    // --- Persist operations ---
    checkpoint_save(keyPtr: number, valuePtr: number): number {
      const key = h.readString(keyPtr);
      const value = h.readString(valuePtr);
      const effectErr = h.policyCheckEffect("Persist");
      if (effectErr) return h.allocResultString(false, h.writeString(effectErr));
      try {
        const dir = process.env.CLARITY_CHECKPOINT_DIR ?? ".clarity-checkpoints";
        nodeFs.mkdirSync(dir, { recursive: true });
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
        nodeFs.writeFileSync(`${dir}/${safeKey}.ckpt`, value, "utf-8");
        return h.allocResultString(true, h.writeString(""));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    checkpoint_load(keyPtr: number): number {
      const key = h.readString(keyPtr);
      const effectErr = h.policyCheckEffect("Persist");
      if (effectErr) return h.allocOptionI32(null);
      try {
        const dir = process.env.CLARITY_CHECKPOINT_DIR ?? ".clarity-checkpoints";
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
        const path = `${dir}/${safeKey}.ckpt`;
        if (!nodeFs.existsSync(path)) return h.allocOptionI32(null);
        const v = nodeFs.readFileSync(path, "utf-8");
        return h.allocOptionI32(h.writeString(v));
      } catch {
        return h.allocOptionI32(null);
      }
    },

    checkpoint_delete(keyPtr: number): void {
      const key = h.readString(keyPtr);
      try {
        const dir = process.env.CLARITY_CHECKPOINT_DIR ?? ".clarity-checkpoints";
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
        const path = `${dir}/${safeKey}.ckpt`;
        if (nodeFs.existsSync(path)) nodeFs.unlinkSync(path);
      } catch { /* ignore */ }
    },

    checkpoint_save_raw(keyPtr: number, valuePtr: number): number {
      const key = h.readString(keyPtr);
      const value = h.readString(valuePtr);
      const effectErr = h.policyCheckEffect("Persist");
      if (effectErr) return 0;
      try {
        const dir = process.env.CLARITY_CHECKPOINT_DIR ?? ".clarity-checkpoints";
        nodeFs.mkdirSync(dir, { recursive: true });
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
        nodeFs.writeFileSync(`${dir}/${safeKey}.ckpt`, value, "utf-8");
        return 1;
      } catch {
        return 0;
      }
    },

    // --- HumanInLoop operations ---
    hitl_ask(keyPtr: number, questionPtr: number): number {
      const key = h.readString(keyPtr);
      const question = h.readString(questionPtr);
      const effectErr = h.policyCheckEffect("HumanInLoop");
      if (effectErr) return h.writeString(`[HumanInLoop denied: ${effectErr}]`);

      const dir = process.env.CLARITY_HITL_DIR ?? ".clarity-hitl";
      const timeoutSecs = parseInt(process.env.CLARITY_HITL_TIMEOUT_SECS ?? "600", 10);
      nodeFs.mkdirSync(dir, { recursive: true });

      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
      const questionFile = `${dir}/${safeKey}.question`;
      const answerFile = `${dir}/${safeKey}.answer`;

      nodeFs.writeFileSync(questionFile, JSON.stringify({ key, question, timestamp: Date.now(), pid: process.pid }), "utf-8");

      const sab = new SharedArrayBuffer(4);
      const ctrl = new Int32Array(sab);
      const deadline = Date.now() + timeoutSecs * 1000;
      const pollIntervalMs = 500;

      while (Date.now() < deadline) {
        Atomics.wait(ctrl, 0, 0, pollIntervalMs);
        if (nodeFs.existsSync(answerFile)) {
          try {
            const answer = nodeFs.readFileSync(answerFile, "utf-8").trim();
            nodeFs.unlinkSync(answerFile);
            try { nodeFs.unlinkSync(questionFile); } catch { /* ignore */ }
            return h.writeString(answer);
          } catch {
            // race — broker still writing; retry next poll
          }
        }
      }

      try { nodeFs.unlinkSync(questionFile); } catch { /* ignore */ }
      return h.writeString("[hitl_ask timeout]");
    },
  };
}
