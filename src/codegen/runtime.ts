// Host runtime for Clarity WASM modules.
// Provides the JavaScript implementations of imported functions (print, string ops, logging).
//
// String memory layout: [length: u32 (4 bytes)][utf8 data: length bytes]
// Strings are stored in WASM linear memory. A string pointer (i32) points to the length prefix.
//
// This file is the orchestration layer. All domain-specific builtins live in ./runtime/ sub-modules.

import * as nodeFs from "node:fs";

// Re-export shared types for consumers of this module.
export type { RuntimeConfig, AssertionFailure, RuntimeExports, AgentEvent } from "./runtime/types.js";

// Domain factory functions.
import { createMathRuntime } from "./runtime/math.js";
import { createStringRuntime } from "./runtime/string.js";
import { createFsRuntime } from "./runtime/fs.js";
import { createNetworkRuntime } from "./runtime/network.js";
import { createHttpServerRuntime } from "./runtime/http-server.js";
import { createTtyRuntime } from "./runtime/tty.js";
import { createMuxRuntime } from "./runtime/mux.js";
import { createLlmRuntime } from "./runtime/llm.js";
import { createAgentRuntime } from "./runtime/agent.js";
import { createMiscRuntime } from "./runtime/misc.js";
import type { RuntimeConfig, AssertionFailure, SharedHelpers } from "./runtime/types.js";

export function createRuntime(config: RuntimeConfig = {}) {
  // Memory is set after instantiation via bindMemory()
  let memory: WebAssembly.Memory = null!;
  let heapPtr = 1024; // start heap after data segment area

  // String intern table: maps JS string content → WASM heap pointer.
  const internedStrings = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // Free-list allocator
  // ---------------------------------------------------------------------------
  const allocSizeMap = new Map<number, number>(); // ptr → size_class
  const freeLists    = new Map<number, number[]>(); // size_class → ptrs

  // ---------------------------------------------------------------------------
  // Policy: URL allowlist, effect-family deny list, and audit log
  // ---------------------------------------------------------------------------
  const policyAllowHosts: string[] = (process.env.CLARITY_ALLOW_HOSTS ?? "")
    .split(",").map((h) => h.trim()).filter(Boolean);
  const policyDenyEffects = new Set<string>(
    (process.env.CLARITY_DENY_EFFECTS ?? "").split(",").map((e) => e.trim()).filter(Boolean),
  );
  const policyAuditLog: string | null = process.env.CLARITY_AUDIT_LOG ?? null;

  function policyCheckUrl(url: string): string | null {
    if (policyAllowHosts.length === 0) return null;
    let hostname = url;
    try { hostname = new URL(url).hostname; } catch { /* not a valid URL, use as-is */ }
    const ok = policyAllowHosts.some((pattern) => {
      if (pattern.startsWith("*.")) {
        const domain = pattern.slice(2);
        return hostname === domain || hostname.endsWith("." + domain);
      }
      return hostname === pattern;
    });
    return ok ? null : `Policy: host '${hostname}' is not in CLARITY_ALLOW_HOSTS`;
  }

  function policyCheckEffect(effectName: string): string | null {
    return policyDenyEffects.has(effectName)
      ? `Policy: effect '${effectName}' is blocked by CLARITY_DENY_EFFECTS`
      : null;
  }

  function audit(entry: Record<string, unknown>): void {
    if (!policyAuditLog) return;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    try { nodeFs.appendFileSync(policyAuditLog, line); } catch { /* non-fatal */ }
  }

  // ---------------------------------------------------------------------------
  // MCP session registry
  // ---------------------------------------------------------------------------
  let mcpNextId = 1;
  const mcpSessions = new Map<number, { url: string }>();

  // Trace span table
  const spanTable = new Map<number, { op: string; start: number; events: string[] }>();
  let nextSpanId = 1;

  // Map table
  const mapTable = new Map<number, Map<string | bigint, number | bigint>>();
  let nextMapHandle = 1;

  function sizeClass(size: number): number {
    let cls = 8;
    while (cls < size) cls <<= 1;
    return cls;
  }

  function alloc(size: number): number {
    const cls = sizeClass(size <= 0 ? 1 : size);
    const list = freeLists.get(cls);
    if (list && list.length > 0) return list.pop()!;
    heapPtr = (heapPtr + 7) & ~7;
    const ptr = heapPtr;
    const needed = ptr + cls;
    if (needed > memory.buffer.byteLength) {
      const pages = Math.ceil((needed - memory.buffer.byteLength) / 65536);
      memory.grow(pages);
    }
    heapPtr = ptr + cls;
    allocSizeMap.set(ptr, cls);
    return ptr;
  }

  function free(ptr: number): void {
    const cls = allocSizeMap.get(ptr);
    if (cls === undefined) return;
    let list = freeLists.get(cls);
    if (!list) { list = []; freeLists.set(cls, list); }
    list.push(ptr);
  }

  function readString(ptr: number): string {
    const view = new DataView(memory.buffer);
    const len = view.getUint32(ptr, true);
    const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
    return new TextDecoder().decode(bytes);
  }

  function writeString(str: string): number {
    const existing = internedStrings.get(str);
    if (existing !== undefined) return existing;
    const encoded = new TextEncoder().encode(str);
    const ptr = alloc(4 + encoded.length);
    const view = new DataView(memory.buffer);
    view.setUint32(ptr, encoded.length, true);
    new Uint8Array(memory.buffer, ptr + 4, encoded.length).set(encoded);
    internedStrings.set(str, ptr);
    return ptr;
  }

  function setHeapBase(base: number) {
    heapPtr = base;
    internedStrings.clear();
    allocSizeMap.clear();
    freeLists.clear();
    mcpSessions.clear();
    mcpNextId = 1;
  }

  function bindMemory(mem: WebAssembly.Memory) {
    memory = mem;
  }

  // --- Test state ---
  let currentTestFunction = "";
  let assertionFailures: AssertionFailure[] = [];
  let assertionCount = 0;

  // ---------------------------------------------------------------------------
  // Shared union / list allocators
  // ---------------------------------------------------------------------------
  function allocOptionI32(value: number | null): number {
    const ptr = alloc(12);
    const view = new DataView(memory.buffer);
    if (value === null) {
      view.setInt32(ptr, 1, true);
    } else {
      view.setInt32(ptr, 0, true);
      view.setInt32(ptr + 8, value, true);
    }
    return ptr;
  }

  function allocOptionI64(value: bigint | null): number {
    const ptr = alloc(16);
    const view = new DataView(memory.buffer);
    if (value === null) {
      view.setInt32(ptr, 1, true);
    } else {
      view.setInt32(ptr, 0, true);
      view.setBigInt64(ptr + 8, value, true);
    }
    return ptr;
  }

  function allocResultI32(ok: boolean, valuePtr: number): number {
    const ptr = alloc(12);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, ok ? 0 : 1, true);
    view.setInt32(ptr + 8, valuePtr, true);
    return ptr;
  }

  function allocResultString(ok: boolean, valuePtr: number): number {
    return allocResultI32(ok, valuePtr);
  }

  function allocResultI64(ok: boolean, value: bigint, errPtr = 0): number {
    const ptr = alloc(16);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, ok ? 0 : 1, true);
    if (ok) {
      view.setBigInt64(ptr + 8, value, true);
    } else {
      view.setInt32(ptr + 8, errPtr, true);
    }
    return ptr;
  }

  function allocListI32(items: number[]): number {
    const len = items.length;
    const ptr = alloc(4 + len * 4);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, len, true);
    for (let i = 0; i < len; i++) view.setInt32(ptr + 4 + i * 4, items[i], true);
    return ptr;
  }

  function allocListI64(items: bigint[]): number {
    const len = items.length;
    const ptr = alloc(4 + len * 8);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, len, true);
    for (let i = 0; i < len; i++) view.setBigInt64(ptr + 4 + i * 8, items[i], true);
    return ptr;
  }

  // ---------------------------------------------------------------------------
  // Build SharedHelpers passed to all domain factories
  // ---------------------------------------------------------------------------
  // Agent event emitter — no-op when not configured; LLM-runtime injects a real one.
  function emitAgentEvent(event: import("./runtime/types.js").AgentEvent): void {
    try { config.agentEventEmitter?.(event); } catch { /* non-fatal */ }
  }

  const h: SharedHelpers = {
    readString,
    writeString,
    alloc,
    memory: () => memory,
    allocOptionI32,
    allocOptionI64,
    allocResultI64,
    allocResultString,
    allocResultI32,
    allocListI32,
    allocListI64,
    policyCheckUrl,
    policyCheckEffect,
    policyAuditLog: audit,
    emitAgentEvent,
  };

  // ---------------------------------------------------------------------------
  // Instantiate all domain runtimes
  // ---------------------------------------------------------------------------

  // Ref objects passed by reference so domain modules can access/mutate shared state
  const memoryState = {
    heapPtr: () => heapPtr,
    setHeapPtr: (v: number) => { heapPtr = v; },
    internedStrings,
    allocSizeMap,
    freeLists,
  };

  const testState = {
    currentTestFunction: () => currentTestFunction,
    assertionFailures,
    assertionCount: { value: assertionCount },
  };

  // Stdin state — held as refs so fs domain can update them
  const stdinBufferRef = { value: "" };
  const stdinReaderRef = {
    sab: null as SharedArrayBuffer | null,
    ctrl: null as Int32Array | null,
    worker: null as import("node:worker_threads").Worker | null,
  };

  const mathRuntime    = createMathRuntime(h);
  const stringRuntime  = createStringRuntime(h, mapTable, () => nextMapHandle++);
  const fsRuntime      = createFsRuntime(h, config, stdinBufferRef, stdinReaderRef);
  const networkRuntime = createNetworkRuntime(h);
  const httpSrvRuntime = createHttpServerRuntime(h);
  const ttyRuntime     = createTtyRuntime(h);
  const muxRuntime     = createMuxRuntime(h);
  const llmRuntime     = createLlmRuntime(h);
  const agentRuntime   = createAgentRuntime(
    h,
    mcpSessions,
    () => mcpNextId++,
    spanTable,
    () => nextSpanId++,
  );
  const miscRuntime    = createMiscRuntime(
    h,
    memoryState,
    testState,
    mapTable,
    () => nextMapHandle++,
  );

  const imports = {
    env: {
      ...mathRuntime,
      ...stringRuntime,
      ...fsRuntime,
      ...networkRuntime,
      ...httpSrvRuntime,
      ...ttyRuntime,
      ...muxRuntime,
      ...llmRuntime,
      ...agentRuntime,
      ...miscRuntime,
    },
  };

  return {
    get memory() { return memory; },
    imports,
    readString,
    writeString,
    setHeapBase,
    bindMemory,
    // Test runner API
    setCurrentTest(name: string) {
      currentTestFunction = name;
      testState.currentTestFunction = () => currentTestFunction;
    },
    getTestResults() {
      return {
        total: testState.assertionCount.value,
        failures: [...testState.assertionFailures],
      };
    },
    resetTestState() {
      testState.assertionFailures.length = 0;
      testState.assertionCount.value = 0;
    },
    // Memory management API (for tests and host tooling)
    getHeapPtr() { return heapPtr; },
    getLiveAllocCount() { return allocSizeMap.size; },
  };
}
