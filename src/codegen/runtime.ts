// Host runtime for Clarity WASM modules.
// Provides the JavaScript implementations of imported functions (print, string ops, logging).
//
// String memory layout: [length: u32 (4 bytes)][utf8 data: length bytes]
// Strings are stored in WASM linear memory. A string pointer (i32) points to the length prefix.

import * as nodeFs from "node:fs";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
// The WASM module owns the memory and exports it; the runtime binds to it after instantiation.

// ─────────────────────────────────────────────────────────────────────────────
// syncHttpRequest: synchronous HTTP client using a worker thread + Atomics.
//
// WASM imports must be synchronous. We cannot use async fetch() directly.
// Instead, we spawn a Worker that performs the async request and signals
// completion via a SharedArrayBuffer; the main thread blocks with Atomics.wait.
//
// SharedArrayBuffer layout (bytes):
//   [0..3]  Int32 – done flag: 0=pending 1=ok 2=http-error 3=net-error 4=timeout
//   [4..7]  Int32 – HTTP status code
//   [8..11] Int32 – body length (bytes)
//   [12..]  body  – UTF-8 encoded response body (up to HTTP_MAX_BODY bytes)
// ─────────────────────────────────────────────────────────────────────────────
const HTTP_MAX_BODY = 8 * 1024 * 1024; // 8 MB

// ─────────────────────────────────────────────────────────────────────────────
// LLM Streaming: pull-based token streaming via worker thread + Atomics.
//
// Each stream gets a SharedArrayBuffer used as a one-token-at-a-time handshake:
//   [0..3]   Int32  status  0=IDLE 1=TOKEN_READY 2=DONE 3=ERROR
//   [4..7]   Int32  token length (bytes)
//   [8..11]  Int32  error length (bytes, only when status=ERROR)
//   [12..12+STREAM_MAX_TOKEN-1]         token data (UTF-8)
//   [12+STREAM_MAX_TOKEN..SAB_END]      error data (UTF-8)
//
// stream_start() spawns a worker that POSTs with streaming=true and pushes each
// SSE token into the SAB. stream_next() blocks (Atomics.wait) until a token or
// end-of-stream is available. stream_close() terminates the worker and returns
// any error message.
// ─────────────────────────────────────────────────────────────────────────────
const STREAM_MAX_TOKEN = 4096;
const STREAM_MAX_ERROR = 1024;
const STREAM_TOKEN_OFFSET = 12;
const STREAM_ERROR_OFFSET = 12 + STREAM_MAX_TOKEN;
const STREAM_SAB_SIZE = 12 + STREAM_MAX_TOKEN + STREAM_MAX_ERROR;

interface SyncHttpResponse {
  ok: boolean;
  status: number;
  body: string;
}

// Worker source evaluated as CJS (eval:true workers are CJS regardless of package type).
const _HTTP_WORKER_CODE = `
const { workerData } = require('worker_threads');
const https = require('https');
const http = require('http');
const { sab, url: initialUrl, method, headers, body, timeoutMs, followRedirects } = workerData;
const ctrl = new Int32Array(sab, 0, 1);
const view = new DataView(sab);
const MAX_BODY = sab.byteLength - 12;

function finish(done, status, bodyStr) {
  const encoded = Buffer.from(bodyStr || '', 'utf8');
  const len = Math.min(encoded.length, MAX_BODY);
  view.setInt32(4, status, true);
  view.setInt32(8, len, true);
  new Uint8Array(sab, 12, len).set(encoded.subarray(0, len));
  Atomics.store(ctrl, 0, done);
  Atomics.notify(ctrl, 0);
}

function doRequest(url, redirectCount) {
  if (redirectCount > 5) { finish(3, 0, 'Too many redirects'); return; }
  let urlObj;
  try { urlObj = new URL(url); } catch(e) { finish(3, 0, 'Invalid URL: ' + String(e)); return; }
  const mod = urlObj.protocol === 'https:' ? https : http;
  const port = urlObj.port ? parseInt(urlObj.port, 10) : (urlObj.protocol === 'https:' ? 443 : 80);
  const reqOpts = {
    hostname: urlObj.hostname,
    port,
    path: (urlObj.pathname || '/') + (urlObj.search || ''),
    method: method || 'GET',
    headers: headers || {},
    timeout: timeoutMs || 10000,
  };
  const req = mod.request(reqOpts, function(res) {
    if (followRedirects && [301, 302, 303, 307, 308].indexOf(res.statusCode) !== -1 && res.headers.location) {
      res.resume();
      let redirectUrl;
      try { redirectUrl = new URL(res.headers.location, url).href; }
      catch(e) { finish(3, 0, 'Invalid redirect URL'); return; }
      doRequest(redirectUrl, redirectCount + 1);
      return;
    }
    let chunks = [];
    res.on('data', function(chunk) { chunks.push(Buffer.from(chunk)); });
    res.on('end', function() {
      const data = Buffer.concat(chunks);
      const done = (res.statusCode >= 200 && res.statusCode < 300) ? 1 : 2;
      finish(done, res.statusCode, data.toString('utf8'));
    });
  });
  req.on('error', function(e) { finish(3, 0, e.message); });
  req.on('timeout', function() { req.destroy(); finish(4, 0, 'Request timed out'); });
  if (body !== undefined && body !== null) { req.write(body); }
  req.end();
}
doRequest(initialUrl, 0);
`;

// Worker that performs a streaming LLM HTTP request and pushes tokens into a SAB
// via the one-token-at-a-time handshake described above.
const _STREAM_WORKER_CODE = `
const { workerData } = require('worker_threads');
const https = require('https');
const http = require('http');
const {
  sab, url, method, reqHeaders, body, isAnthropic,
  tokenOffset, errorOffset, maxToken, maxError,
} = workerData;

const ctrl = new Int32Array(sab, 0, 1);
const meta = new DataView(sab);
const STATUS_IDLE = 0, STATUS_TOKEN = 1, STATUS_DONE = 2, STATUS_ERROR = 3;

// Write a token and signal WASM. Blocks until WASM has consumed the previous token.
function putToken(token) {
  if (!token) return;
  // Wait until WASM has reset status to IDLE after consuming previous token.
  Atomics.wait(ctrl, 0, STATUS_TOKEN);
  const encoded = Buffer.from(token, 'utf8');
  const len = Math.min(encoded.length, maxToken);
  meta.setInt32(4, len, true);
  new Uint8Array(sab, tokenOffset, len).set(encoded.subarray(0, len));
  Atomics.store(ctrl, 0, STATUS_TOKEN);
  Atomics.notify(ctrl, 0, 1);
}

// Write an error and signal WASM, waiting for any in-flight token to be consumed first.
function putError(msg) {
  let safety = 0;
  while (Atomics.load(ctrl, 0) === STATUS_TOKEN && safety++ < 200) {
    Atomics.wait(ctrl, 0, STATUS_TOKEN, 50);
  }
  const encoded = Buffer.from(String(msg).slice(0, maxError), 'utf8');
  meta.setInt32(8, encoded.length, true);
  new Uint8Array(sab, errorOffset, encoded.length).set(encoded);
  Atomics.store(ctrl, 0, STATUS_ERROR);
  Atomics.notify(ctrl, 0, 1);
}

// Signal end-of-stream.
function putDone() {
  let safety = 0;
  while (Atomics.load(ctrl, 0) === STATUS_TOKEN && safety++ < 200) {
    Atomics.wait(ctrl, 0, STATUS_TOKEN, 50);
  }
  Atomics.store(ctrl, 0, STATUS_DONE);
  Atomics.notify(ctrl, 0, 1);
}

// Extract text delta from one SSE line.
function parseSSELine(line) {
  if (!line.startsWith('data:')) return '';
  const data = line.slice(5).trim();
  if (data === '[DONE]') return '';
  try {
    const obj = JSON.parse(data);
    if (isAnthropic) {
      // Anthropic: content_block_delta event carries delta.text
      return (obj.delta && obj.delta.text) ? obj.delta.text : '';
    } else {
      // OpenAI-compatible: choices[0].delta.content
      const c = obj.choices && obj.choices[0] && obj.choices[0].delta;
      return (c && c.content) ? c.content : '';
    }
  } catch(e) {
    return '';
  }
}

let urlObj;
try { urlObj = new URL(url); } catch(e) { putError('Invalid URL: ' + url); }
const mod = urlObj.protocol === 'https:' ? https : http;
const reqOpts = {
  hostname: urlObj.hostname,
  port: urlObj.port ? parseInt(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 80),
  path: (urlObj.pathname || '/') + (urlObj.search || ''),
  method: method || 'POST',
  headers: reqHeaders || {},
  timeout: 120000,
};
const req = mod.request(reqOpts, function(res) {
  if (res.statusCode < 200 || res.statusCode >= 300) {
    let errBody = '';
    res.on('data', function(c) { errBody += c.toString('utf8'); });
    res.on('end', function() { putError('HTTP ' + res.statusCode + ': ' + errBody.slice(0, 200)); });
    return;
  }
  let remainder = '';
  res.on('data', function(chunk) {
    const text = remainder + chunk.toString('utf8');
    const lines = text.split('\\n');
    remainder = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const token = parseSSELine(trimmed);
      if (token) putToken(token);
    }
  });
  res.on('end', function() {
    // Process any remaining buffered line.
    if (remainder.trim()) {
      const token = parseSSELine(remainder.trim());
      if (token) putToken(token);
    }
    putDone();
  });
});
req.on('error', function(e) { putError(e.message); });
if (body) req.write(body);
req.end();
`;

function syncHttpRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
}): SyncHttpResponse {
  // file:// URLs are read directly from disk (curl supports these; http/https don't).
  if (opts.url.startsWith("file://")) {
    try {
      const filePath = new URL(opts.url).pathname;
      const content = nodeFs.readFileSync(filePath, "utf-8");
      return { ok: true, status: 200, body: content };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 0, body: msg };
    }
  }
  const sab = new SharedArrayBuffer(12 + HTTP_MAX_BODY);
  const ctrl = new Int32Array(sab, 0, 1);
  const worker = new Worker(_HTTP_WORKER_CODE, {
    eval: true,
    workerData: {
      sab,
      url: opts.url,
      method: opts.method ?? "GET",
      headers: opts.headers ?? {},
      body: opts.body ?? null,
      timeoutMs: opts.timeoutMs ?? 10000,
      followRedirects: opts.followRedirects ?? false,
    },
  });
  // Block until worker signals done (or an extra 2s grace period elapses).
  const waitResult = Atomics.wait(ctrl, 0, 0, (opts.timeoutMs ?? 10000) + 2000);
  worker.terminate();

  const done = ctrl[0];
  const view = new DataView(sab);
  const status = view.getInt32(4, true);
  const bodyLen = view.getInt32(8, true);
  const body = Buffer.from(new Uint8Array(sab, 12, bodyLen)).toString("utf-8");

  if (waitResult === "timed-out" || done === 0 || done === 4) {
    return { ok: false, status: 0, body: "Request timed out" };
  }
  if (done === 3) {
    return { ok: false, status: 0, body };
  }
  return { ok: done === 1, status, body };
}

export interface RuntimeExports {
  memory: WebAssembly.Memory;
  __heap_base?: WebAssembly.Global;
}

export interface RuntimeConfig {
  /** Command-line arguments to expose via get_args() */
  argv?: string[];
  /** Stdin content (pre-read). If not provided, reads synchronously from process.stdin */
  stdin?: string;
  /** File system access. If not provided, uses Node.js fs */
  fs?: {
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, content: string) => void;
  };
}

export interface AssertionFailure {
  kind: string;
  actual: string;
  expected: string;
  testFunction: string;
}

export function createRuntime(config: RuntimeConfig = {}) {
  // Memory is set after instantiation via bindMemory()
  let memory: WebAssembly.Memory = null!;
  let heapPtr = 1024; // start heap after data segment area

  // String intern table: maps JS string content → WASM heap pointer.
  // Avoids duplicate allocations when the same string value is created
  // multiple times at runtime (e.g., repeated string_concat, int_to_string).
  const internedStrings = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // Free-list allocator
  // ---------------------------------------------------------------------------
  // Each heap allocation is rounded up to the next power-of-two size class
  // (minimum 8 bytes). When __free() is called the block is placed on the
  // appropriate free-list and returned to future alloc() calls of the same
  // size class. This eliminates the monotone growth of the old pure-bump
  // allocator for programs that repeatedly allocate and release temporaries.
  //
  // allocSizeMap: ptr → size_class (the power-of-two size this block occupies)
  // freeLists:    size_class → stack of free block pointers
  //
  // Arena marks (arena_save / arena_restore) allow bulk-freeing everything
  // allocated since a saved heap watermark in O(allocs-since-mark) time.

  const allocSizeMap = new Map<number, number>(); // ptr → size_class
  const freeLists    = new Map<number, number[]>(); // size_class → ptrs

  // ---------------------------------------------------------------------------
  // Policy: URL allowlist, effect-family deny list, and audit log
  // ---------------------------------------------------------------------------
  // Configured via environment variables at runtime startup:
  //   CLARITY_ALLOW_HOSTS — comma-separated hostname globs allowed for network ops
  //                         e.g. "api.openai.com,*.internal.corp"
  //                         Omit or leave empty to allow all hosts.
  //   CLARITY_DENY_EFFECTS — comma-separated effect names to block entirely
  //                          e.g. "MCP,A2A"
  //   CLARITY_AUDIT_LOG — file path for JSONL audit log; each network call appends one line
  const policyAllowHosts: string[] = (process.env.CLARITY_ALLOW_HOSTS ?? "")
    .split(",").map((h) => h.trim()).filter(Boolean);
  const policyDenyEffects = new Set<string>(
    (process.env.CLARITY_DENY_EFFECTS ?? "").split(",").map((e) => e.trim()).filter(Boolean),
  );
  const policyAuditLog: string | null = process.env.CLARITY_AUDIT_LOG ?? null;

  /** Returns an error message if the URL's host is not in the allowlist, else null. */
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

  /** Returns an error message if the effect is in the deny list, else null. */
  function policyCheckEffect(effectName: string): string | null {
    return policyDenyEffects.has(effectName)
      ? `Policy: effect '${effectName}' is blocked by CLARITY_DENY_EFFECTS`
      : null;
  }

  /** Append one structured entry to the audit log (if configured). Non-fatal on I/O error. */
  function audit(entry: Record<string, unknown>): void {
    if (!policyAuditLog) return;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    try { nodeFs.appendFileSync(policyAuditLog, line); } catch { /* non-fatal */ }
  }

  // ---------------------------------------------------------------------------
  // MCP session registry
  // ---------------------------------------------------------------------------
  // Each call to mcp_connect() registers an HTTP endpoint and returns an
  // opaque integer session handle. mcp_disconnect() removes the entry.
  let mcpNextId = 1;
  const mcpSessions = new Map<number, { url: string }>();

  /** Round `size` up to the next power of two, minimum 8. */
  function sizeClass(size: number): number {
    let cls = 8;
    while (cls < size) cls <<= 1;
    return cls;
  }

  /**
   * Core allocator used by all runtime allocation helpers.
   * Returns a pointer to `size` bytes of zeroed WASM memory.
   * Checks the free list for a same-class block before bump-allocating.
   */
  function alloc(size: number): number {
    const cls = sizeClass(size <= 0 ? 1 : size);

    // Reuse a freed block of the same size class when available.
    const list = freeLists.get(cls);
    if (list && list.length > 0) {
      return list.pop()!;
    }

    // Bump-allocate a fresh block.
    heapPtr = (heapPtr + 3) & ~3; // 4-byte alignment
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

  /** Return a block to its free-list so it can be reused. */
  function free(ptr: number): void {
    const cls = allocSizeMap.get(ptr);
    if (cls === undefined) return; // not a tracked allocation; ignore
    let list = freeLists.get(cls);
    if (!list) { list = []; freeLists.set(cls, list); }
    list.push(ptr);
  }

  // ---------------------------------------------------------------------------

  function readString(ptr: number): string {
    const view = new DataView(memory.buffer);
    const len = view.getUint32(ptr, true); // little-endian
    const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
    return new TextDecoder().decode(bytes);
  }

  function writeString(str: string): number {
    // Check intern table first — reuse existing allocation if available
    const existing = internedStrings.get(str);
    if (existing !== undefined) return existing;

    const encoded = new TextEncoder().encode(str);
    const ptr = alloc(4 + encoded.length);

    const view = new DataView(memory.buffer);
    view.setUint32(ptr, encoded.length, true);
    new Uint8Array(memory.buffer, ptr + 4, encoded.length).set(encoded);

    // Intern this string for future reuse
    internedStrings.set(str, ptr);
    return ptr;
  }

  function setHeapBase(base: number) {
    heapPtr = base;
    // Clear all allocator state: data-segment strings are in the region
    // below `base` and are never freed; runtime allocations start fresh.
    internedStrings.clear();
    allocSizeMap.clear();
    freeLists.clear();
    mcpSessions.clear();
    mcpNextId = 1;
  }

  function bindMemory(mem: WebAssembly.Memory) {
    memory = mem;
  }

  // --- Test state (used by assertion functions and test runner) ---
  let currentTestFunction = "";
  let assertionFailures: AssertionFailure[] = [];
  let assertionCount = 0;

  // --- Map table ---
  // Maps are represented as opaque i32 handles backed by JS Map objects.
  // Keys: string (for String-keyed maps) or bigint (for Int64-keyed maps).
  // Values: number (i32 pointer types) or bigint (i64 types).
  // All mutations (map_set, map_remove) return a NEW handle — functional style.
  const mapTable = new Map<number, Map<string | bigint, number | bigint>>();
  let nextMapHandle = 1;

  // Trace span table: spanId → { op, startMs, events[] }
  const spanTable = new Map<number, { op: string; start: number; events: string[] }>();
  let nextSpanId = 1;

  // Leftover buffer for real-stdin read_line() calls.
  // readSync may return multiple lines at once; we buffer the remainder.
  let stdinBuffer = "";

  // Stream session table: handle → { sab, ctrl, worker, lastError? }
  interface StreamSession { sab: SharedArrayBuffer; ctrl: Int32Array; worker: import("node:worker_threads").Worker; lastError?: string; }
  const streamSessions = new Map<number, StreamSession>();
  let nextStreamHandle = 1;

  // Allocate an Option<i32> union: [tag:i32][value:i32] = 8 bytes
  function allocOptionI32(value: number | null): number {
    const ptr = alloc(8);
    const view = new DataView(memory.buffer);
    if (value === null) {
      view.setInt32(ptr, 1, true); // None
    } else {
      view.setInt32(ptr, 0, true); // Some
      view.setInt32(ptr + 4, value, true);
    }
    return ptr;
  }

  // Allocate an Option<i64> union: [tag:i32][value:i64] = 12 bytes
  function allocOptionI64(value: bigint | null): number {
    const ptr = alloc(12);
    const view = new DataView(memory.buffer);
    if (value === null) {
      view.setInt32(ptr, 1, true); // None
    } else {
      view.setInt32(ptr, 0, true); // Some
      view.setBigInt64(ptr + 4, value, true);
    }
    return ptr;
  }

  // Allocate a Result<*, i32> union: [tag:i32][value_ptr:i32] = 8 bytes.
  // tag 0 = Ok(value), tag 1 = Err(error_message)
  function allocResultI32(ok: boolean, valuePtr: number): number {
    const ptr = alloc(8);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, ok ? 0 : 1, true);
    view.setInt32(ptr + 4, valuePtr, true);
    return ptr;
  }

  // Allocate a Result<String, String> union (both payloads are i32 string pointers).
  function allocResultString(ok: boolean, valuePtr: number): number {
    return allocResultI32(ok, valuePtr);
  }

  // Allocate a Result<Int64, String> union: [tag:i32][payload:i64/i32] = 12 bytes.
  function allocResultI64(ok: boolean, value: bigint, errPtr = 0): number {
    const ptr = alloc(12);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, ok ? 0 : 1, true);
    if (ok) {
      view.setBigInt64(ptr + 4, value, true);
    } else {
      view.setInt32(ptr + 4, errPtr, true);
    }
    return ptr;
  }

  // Allocate a List<i32> on the heap: [count:i32][elements:i32...]
  function allocListI32(items: number[]): number {
    const len = items.length;
    const ptr = alloc(4 + len * 4);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, len, true);
    for (let i = 0; i < len; i++) {
      view.setInt32(ptr + 4 + i * 4, items[i], true);
    }
    return ptr;
  }

  // Allocate a List<i64> on the heap: [count:i32][elements:i64...]
  function allocListI64(items: bigint[]): number {
    const len = items.length;
    const ptr = alloc(4 + len * 8);
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, len, true);
    for (let i = 0; i < len; i++) {
      view.setBigInt64(ptr + 4 + i * 8, items[i], true);
    }
    return ptr;
  }

  const imports = {
    env: {
      // --- I/O & Logging ---
      print_string(ptr: number): void {
        console.log(readString(ptr));
      },

      print_int(value: bigint): void {
        console.log(value.toString());
      },

      print_float(value: number): void {
        console.log(value.toString());
      },

      log_info(ptr: number): void {
        console.log(`[INFO] ${readString(ptr)}`);
      },

      log_warn(ptr: number): void {
        console.warn(`[WARN] ${readString(ptr)}`);
      },

      // --- String operations ---
      string_concat(aPtr: number, bPtr: number): number {
        const a = readString(aPtr);
        const b = readString(bPtr);
        return writeString(a + b);
      },

      string_eq(aPtr: number, bPtr: number): number {
        return readString(aPtr) === readString(bPtr) ? 1 : 0;
      },

      string_length(ptr: number): bigint {
        return BigInt(readString(ptr).length);
      },

      substring(ptr: number, start: bigint, length: bigint): number {
        const s = readString(ptr);
        return writeString(s.substring(Number(start), Number(start) + Number(length)));
      },

      char_at(ptr: number, index: bigint): number {
        const s = readString(ptr);
        const i = Number(index);
        return writeString(i >= 0 && i < s.length ? s[i] : "");
      },

      contains(haystackPtr: number, needlePtr: number): number {
        return readString(haystackPtr).includes(readString(needlePtr)) ? 1 : 0;
      },

      string_starts_with(sPtr: number, prefixPtr: number): number {
        return readString(sPtr).startsWith(readString(prefixPtr)) ? 1 : 0;
      },

      string_ends_with(sPtr: number, suffixPtr: number): number {
        return readString(sPtr).endsWith(readString(suffixPtr)) ? 1 : 0;
      },

      index_of(haystackPtr: number, needlePtr: number): bigint {
        return BigInt(readString(haystackPtr).indexOf(readString(needlePtr)));
      },

      trim(ptr: number): number {
        return writeString(readString(ptr).trim());
      },

      split(sPtr: number, delimPtr: number): number {
        const parts = readString(sPtr).split(readString(delimPtr));
        // Build a List<String> in memory: [length: i32][ptr0: i32][ptr1: i32]...
        const ptrs = parts.map(p => writeString(p));
        const listPtr = alloc(4 + ptrs.length * 4);
        const view = new DataView(memory.buffer);
        view.setInt32(listPtr, ptrs.length, true);
        for (let i = 0; i < ptrs.length; i++) {
          view.setInt32(listPtr + 4 + i * 4, ptrs[i], true);
        }
        return listPtr;
      },

      string_replace(sPtr: number, searchPtr: number, replacementPtr: number): number {
        const s = readString(sPtr);
        const search = readString(searchPtr);
        const replacement = readString(replacementPtr);
        if (search.length === 0) return writeString(s);
        return writeString(s.split(search).join(replacement));
      },

      string_repeat(sPtr: number, count: bigint): number {
        const n = Number(count);
        if (n <= 0) return writeString("");
        return writeString(readString(sPtr).repeat(n));
      },

      char_code(ptr: number): bigint {
        const s = readString(ptr);
        if (s.length === 0) return 0n;
        return BigInt(s.codePointAt(0)!);
      },

      char_from_code(code: bigint): number {
        return writeString(String.fromCodePoint(Number(code)));
      },

      // --- Type conversions ---
      int_to_float(value: bigint): number {
        return Number(value);
      },

      float_to_int(value: number): bigint {
        return BigInt(Math.trunc(value));
      },

      int_to_string(value: bigint): number {
        return writeString(value.toString());
      },

      float_to_string(value: number): number {
        return writeString(value.toString());
      },

      // string_to_int returns Option<Int64> as heap-allocated union pointer.
      // Layout: [tag:i32][value:i64] = 12 bytes. Tag 0 = Some, Tag 1 = None.
      string_to_int(ptr: number): number {
        const s = readString(ptr).trim();
        const unionPtr = alloc(12);
        const view = new DataView(memory.buffer);
        // Reject partial parses (parseInt("3.14") = 3): require the entire string
        // to be a valid integer representation before converting.
        if (/^-?\d+$/.test(s)) {
          try {
            view.setInt32(unionPtr, 0, true); // Some
            view.setBigInt64(unionPtr + 4, BigInt(s), true);
          } catch {
            view.setInt32(unionPtr, 1, true); // None (overflow, etc.)
          }
        } else {
          view.setInt32(unionPtr, 1, true); // None
        }
        return unionPtr;
      },

      // string_to_float returns Option<Float64> as heap-allocated union pointer.
      // Layout: [tag:i32][value:f64] = 12 bytes. Tag 0 = Some, Tag 1 = None.
      string_to_float(ptr: number): number {
        const s = readString(ptr).trim();
        const unionPtr = alloc(12);
        const view = new DataView(memory.buffer);
        // Use Number() instead of parseFloat(): Number("3.14abc") = NaN (correct),
        // parseFloat("3.14abc") = 3.14 (incorrect partial parse). Guard empty string
        // since Number("") = 0 which would be a false positive.
        const n = s === "" ? NaN : Number(s);
        if (Number.isNaN(n)) {
          view.setInt32(unionPtr, 1, true); // None
        } else {
          view.setInt32(unionPtr, 0, true); // Some
          view.setFloat64(unionPtr + 4, n, true);
        }
        return unionPtr;
      },

      // --- Math builtins ---
      abs_int(value: bigint): bigint {
        return value < 0n ? -value : value;
      },

      min_int(a: bigint, b: bigint): bigint {
        return a < b ? a : b;
      },

      max_int(a: bigint, b: bigint): bigint {
        return a > b ? a : b;
      },

      int_clamp(value: bigint, min: bigint, max: bigint): bigint {
        if (value < min) return min;
        if (value > max) return max;
        return value;
      },

      float_clamp(value: number, min: number, max: number): number {
        if (value < min) return min;
        if (value > max) return max;
        return value;
      },

      sqrt(value: number): number {
        return Math.sqrt(value);
      },

      pow(base: number, exp: number): number {
        return Math.pow(base, exp);
      },

      floor(value: number): number {
        return Math.floor(value);
      },

      ceil(value: number): number {
        return Math.ceil(value);
      },

      f64_rem(a: number, b: number): number {
        return a % b;
      },

      // --- Bytes operations ---
      // Layout: [length: i32][byte_0, byte_1, ...] — same as String but raw bytes
      bytes_new(size: bigint): number {
        const len = Number(size);
        const ptr = alloc(4 + len);
        const view = new DataView(memory.buffer);
        view.setUint32(ptr, len, true);
        // Zero-fill the bytes
        new Uint8Array(memory.buffer, ptr + 4, len).fill(0);
        return ptr;
      },

      bytes_length(ptr: number): bigint {
        const view = new DataView(memory.buffer);
        return BigInt(view.getUint32(ptr, true));
      },

      bytes_get(ptr: number, index: bigint): bigint {
        const view = new DataView(memory.buffer);
        const len = view.getUint32(ptr, true);
        const i = Number(index);
        if (i < 0 || i >= len) return 0n;
        return BigInt(new Uint8Array(memory.buffer, ptr + 4, len)[i]);
      },

      bytes_set(ptr: number, index: bigint, value: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getUint32(ptr, true);
        const i = Number(index);
        // Create a copy with the modification
        const newPtr = alloc(4 + len);
        const newView = new DataView(memory.buffer);
        newView.setUint32(newPtr, len, true);
        new Uint8Array(memory.buffer, newPtr + 4, len).set(
          new Uint8Array(memory.buffer, ptr + 4, len),
        );
        if (i >= 0 && i < len) {
          new Uint8Array(memory.buffer)[newPtr + 4 + i] = Number(value) & 0xff;
        }
        return newPtr;
      },

      bytes_slice(ptr: number, start: bigint, length: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getUint32(ptr, true);
        const s = Math.max(0, Math.min(Number(start), len));
        const l = Math.max(0, Math.min(Number(length), len - s));
        const newPtr = alloc(4 + l);
        const newView = new DataView(memory.buffer);
        newView.setUint32(newPtr, l, true);
        new Uint8Array(memory.buffer, newPtr + 4, l).set(
          new Uint8Array(memory.buffer, ptr + 4 + s, l),
        );
        return newPtr;
      },

      bytes_concat(aPtr: number, bPtr: number): number {
        const view = new DataView(memory.buffer);
        const aLen = view.getUint32(aPtr, true);
        const bLen = view.getUint32(bPtr, true);
        const newLen = aLen + bLen;
        const newPtr = alloc(4 + newLen);
        const newView = new DataView(memory.buffer);
        newView.setUint32(newPtr, newLen, true);
        new Uint8Array(memory.buffer, newPtr + 4, aLen).set(
          new Uint8Array(memory.buffer, aPtr + 4, aLen),
        );
        new Uint8Array(memory.buffer, newPtr + 4 + aLen, bLen).set(
          new Uint8Array(memory.buffer, bPtr + 4, bLen),
        );
        return newPtr;
      },

      bytes_from_string(strPtr: number): number {
        // String and Bytes have the same layout: [length: u32][data]
        // Just copy the memory block
        const view = new DataView(memory.buffer);
        const len = view.getUint32(strPtr, true);
        const totalSize = 4 + len;
        const newPtr = alloc(totalSize);
        new Uint8Array(memory.buffer, newPtr, totalSize).set(
          new Uint8Array(memory.buffer, strPtr, totalSize),
        );
        return newPtr;
      },

      bytes_to_string(bytesPtr: number): number {
        // Decode bytes as UTF-8 string
        const view = new DataView(memory.buffer);
        const len = view.getUint32(bytesPtr, true);
        const bytes = new Uint8Array(memory.buffer, bytesPtr + 4, len);
        const str = new TextDecoder().decode(bytes);
        return writeString(str);
      },

      // --- Crypto operations ---
      sha256(strPtr: number): number {
        const str = readString(strPtr);
        const hex = createHash("sha256").update(str).digest("hex");
        return writeString(hex);
      },

      // --- JSON operations ---
      // json_parse parses a flat JSON object into Option<Map<String, String>>.
      // Some(mapHandle) on success, None on invalid input / non-object / nested values.
      json_parse(strPtr: number): number {
        const src = readString(strPtr);
        let parsed: unknown;
        try {
          parsed = JSON.parse(src);
        } catch {
          return allocOptionI32(null);
        }

        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return allocOptionI32(null);
        }

        const out = new Map<string | bigint, number | bigint>();
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v === null) {
            out.set(k, writeString("null"));
          } else if (typeof v === "string") {
            out.set(k, writeString(v));
          } else if (typeof v === "number" || typeof v === "boolean") {
            out.set(k, writeString(String(v)));
          } else {
            // Only flat scalar values are currently supported.
            return allocOptionI32(null);
          }
        }

        const handle = nextMapHandle++;
        mapTable.set(handle, out);
        return allocOptionI32(handle);
      },

      // json_stringify serializes Map<String, String> to a JSON object.
      // Values that look like JSON literals (null/true/false/number) are emitted raw.
      // Everything else is emitted as a JSON string.
      json_stringify(mapHandle: number): number {
        const m = mapTable.get(mapHandle);
        if (!m) return writeString("{}");

        const numPattern = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
        const parts: string[] = [];
        for (const [k, v] of m.entries()) {
          const key = String(k);
          const raw = typeof v === "number" ? readString(v) : String(v);
          const trimmed = raw.trim();
          const asJsonValue =
            trimmed === "null" ||
            trimmed === "true" ||
            trimmed === "false" ||
            numPattern.test(trimmed)
              ? trimmed
              : JSON.stringify(raw);
          parts.push(`${JSON.stringify(key)}:${asJsonValue}`);
        }

        return writeString(`{${parts.join(",")}}`);
      },

      // json_get extracts a top-level value from a JSON object by key.
      // Returns Some(value) for scalars, Some(json_string) for objects/arrays, None if missing.
      json_get(jsonPtr: number, keyPtr: number): number {
        try {
          const parsed = JSON.parse(readString(jsonPtr));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return allocOptionI32(null);
          const key = readString(keyPtr);
          if (!Object.prototype.hasOwnProperty.call(parsed, key)) return allocOptionI32(null);
          const val = (parsed as Record<string, unknown>)[key];
          if (val === null || val === undefined) return allocOptionI32(null);
          const s = typeof val === "string" ? val : (typeof val === "object" ? JSON.stringify(val) : String(val));
          return allocOptionI32(writeString(s));
        } catch {
          return allocOptionI32(null);
        }
      },

      // json_get_path extracts a nested value using a dot-separated path.
      // e.g. json_get_path(json, "agent.agentId") navigates into nested objects.
      json_get_path(jsonPtr: number, pathPtr: number): number {
        try {
          let current: unknown = JSON.parse(readString(jsonPtr));
          const segments = readString(pathPtr).split(".");
          for (const seg of segments) {
            if (current === null || typeof current !== "object" || Array.isArray(current)) return allocOptionI32(null);
            const obj = current as Record<string, unknown>;
            if (!Object.prototype.hasOwnProperty.call(obj, seg)) return allocOptionI32(null);
            current = obj[seg];
          }
          if (current === null || current === undefined) return allocOptionI32(null);
          const s = typeof current === "string" ? current : (typeof current === "object" ? JSON.stringify(current) : String(current));
          return allocOptionI32(writeString(s));
        } catch {
          return allocOptionI32(null);
        }
      },

      // json_array_length returns the number of elements in a JSON array, or -1 if not an array.
      json_array_length(jsonPtr: number): bigint {
        try {
          const parsed = JSON.parse(readString(jsonPtr));
          if (!Array.isArray(parsed)) return BigInt(-1);
          return BigInt(parsed.length);
        } catch {
          return BigInt(-1);
        }
      },

      // json_array_get returns the element at the given index as a string (Some) or None if out of bounds.
      json_array_get(jsonPtr: number, index: bigint): number {
        try {
          const parsed = JSON.parse(readString(jsonPtr));
          if (!Array.isArray(parsed)) return allocOptionI32(null);
          const i = Number(index);
          if (i < 0 || i >= parsed.length) return allocOptionI32(null);
          const val = parsed[i] as unknown;
          if (val === null || val === undefined) return allocOptionI32(null);
          const s = typeof val === "string" ? val : (typeof val === "object" ? JSON.stringify(val) : String(val));
          return allocOptionI32(writeString(s));
        } catch {
          return allocOptionI32(null);
        }
      },

      // --- Regex operations ---
      regex_match(patternPtr: number, textPtr: number): number {
        try {
          const re = new RegExp(readString(patternPtr));
          return re.test(readString(textPtr)) ? 1 : 0;
        } catch {
          return 0;
        }
      },

      regex_captures(patternPtr: number, textPtr: number): number {
        try {
          const re = new RegExp(readString(patternPtr));
          const match = readString(textPtr).match(re);
          if (!match) return allocOptionI32(null);
          const ptrs = match.map((m) => writeString(m));
          const listPtr = allocListI32(ptrs);
          return allocOptionI32(listPtr);
        } catch {
          return allocOptionI32(null);
        }
      },

      // --- Timestamp operations ---
      // Timestamp is i64 (milliseconds since Unix epoch)
      now(): bigint {
        return BigInt(Date.now());
      },

      timestamp_to_string(ms: bigint): number {
        return writeString(new Date(Number(ms)).toISOString());
      },

      timestamp_to_int(ms: bigint): bigint {
        return ms;
      },

      timestamp_from_int(ms: bigint): bigint {
        return ms;
      },

      timestamp_parse_iso(ptr: number): number {
        const ms = Date.parse(readString(ptr));
        if (Number.isNaN(ms)) return allocOptionI64(null);
        return allocOptionI64(BigInt(ms));
      },

      timestamp_add(t: bigint, ms: bigint): bigint {
        return t + ms;
      },

      timestamp_diff(a: bigint, b: bigint): bigint {
        return a - b;
      },

      // --- Memory allocator ---
      // WASM-generated code calls __alloc for every union/record/list construction.
      // We route through the same free-list allocator used by all JS helpers.
      __alloc(size: number): number {
        return alloc(size);
      },

      // Free a heap block back to the free list.
      // Called by generated code when a value is known to be dead.
      // Currently not emitted by codegen (future work); safe to expose now.
      __free(ptr: number): void {
        free(ptr);
      },

      // --- Arena marks ---
      // arena_save() returns the current heap watermark as Int64.
      // arena_restore(mark) reclaims all memory allocated since the mark,
      // including flushing interned strings and free-list entries in that range.
      // The caller must not use any pointer obtained after the saved mark once
      // arena_restore has been called.
      arena_save(): bigint {
        return BigInt(heapPtr);
      },

      arena_restore(mark: bigint): void {
        const markPtr = Number(mark);
        if (markPtr >= heapPtr) return; // nothing allocated since mark

        // Remove interned strings allocated after the mark.
        for (const [str, ptr] of internedStrings) {
          if (ptr >= markPtr) internedStrings.delete(str);
        }

        // Remove allocSizeMap entries for blocks at or above the mark.
        // Also purge any free-list entries pointing into the freed region.
        for (const [ptr] of allocSizeMap) {
          if (ptr >= markPtr) allocSizeMap.delete(ptr);
        }
        for (const [cls, list] of freeLists) {
          const trimmed = list.filter(p => p < markPtr);
          if (trimmed.length !== list.length) freeLists.set(cls, trimmed);
        }

        // Reset bump pointer to the saved mark — space is available again.
        heapPtr = markPtr;
      },

      // arena_restore_keeping_str: copy the string at strPtr to below the mark, then
      // restore the arena. Returns the new pointer for the preserved string.
      // Use to keep a step-function result alive while freeing all its intermediates.
      arena_restore_keeping_str(mark: bigint, strPtr: number): number {
        const str = readString(strPtr); // read before restore invalidates strPtr
        const markPtr = Number(mark);

        if (markPtr < heapPtr) {
          // Same logic as arena_restore
          for (const [s, p] of internedStrings) {
            if (p >= markPtr) internedStrings.delete(s);
          }
          for (const [p] of allocSizeMap) {
            if (p >= markPtr) allocSizeMap.delete(p);
          }
          for (const [cls, list] of freeLists) {
            const trimmed = list.filter(p => p < markPtr);
            if (trimmed.length !== list.length) freeLists.set(cls, trimmed);
          }
          heapPtr = markPtr;
        }

        // Allocate the preserved string at the restored heap position.
        return writeString(str);
      },

      // Return current heap usage statistics as a JSON string.
      // Useful for debugging memory consumption from Clarity programs.
      memory_stats(): number {
        const live = allocSizeMap.size;
        let freeCount = 0;
        for (const list of freeLists.values()) freeCount += list.length;
        return writeString(JSON.stringify({
          heap_ptr: heapPtr,
          live_allocs: live,
          free_blocks: freeCount,
          interned_strings: internedStrings.size,
        }));
      },

      // --- List operations ---
      // Layout: [length: i32(4 bytes)][elem_0][elem_1]...
      // elem_size is passed to allow generic element access.
      list_length(ptr: number): bigint {
        const view = new DataView(memory.buffer);
        return BigInt(view.getInt32(ptr, true));
      },

      list_get_i64(ptr: number, index: bigint): bigint {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        if (i < 0 || i >= len) return 0n;
        return view.getBigInt64(ptr + 4 + i * 8, true);
      },

      list_get_i32(ptr: number, index: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        if (i < 0 || i >= len) return 0;
        return view.getInt32(ptr + 4 + i * 4, true);
      },

      list_head_i64(ptr: number): bigint {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        if (len === 0) return 0n;
        return view.getBigInt64(ptr + 4, true);
      },

      list_tail(ptr: number, elemSize: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        if (len <= 0) {
          // Return empty list
          const newPtr = alloc(4);
          new DataView(memory.buffer).setInt32(newPtr, 0, true);
          return newPtr;
        }
        const newLen = len - 1;
        const newPtr = alloc(4 + newLen * elemSize);
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        // Copy elements starting from index 1
        new Uint8Array(memory.buffer, newPtr + 4, newLen * elemSize).set(
          new Uint8Array(memory.buffer, ptr + 4 + elemSize, newLen * elemSize),
        );
        return newPtr;
      },

      list_append_i64(ptr: number, value: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const newLen = len + 1;
        const newPtr = alloc(4 + newLen * 8);
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        // Copy existing elements
        new Uint8Array(memory.buffer, newPtr + 4, len * 8).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 8),
        );
        // Append new element
        newView.setBigInt64(newPtr + 4 + len * 8, value, true);
        return newPtr;
      },

      list_append_i32(ptr: number, value: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const newLen = len + 1;
        const newPtr = alloc(4 + newLen * 4);
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        new Uint8Array(memory.buffer, newPtr + 4, len * 4).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 4),
        );
        newView.setInt32(newPtr + 4 + len * 4, value, true);
        return newPtr;
      },

      list_set_i64(ptr: number, index: bigint, value: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        const newPtr = alloc(4 + len * 8);
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, len, true);
        // Copy all elements
        new Uint8Array(memory.buffer, newPtr + 4, len * 8).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 8),
        );
        // Replace element at index
        if (i >= 0 && i < len) {
          new DataView(memory.buffer).setBigInt64(newPtr + 4 + i * 8, value, true);
        }
        return newPtr;
      },

      list_set_i32(ptr: number, index: bigint, value: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        const newPtr = alloc(4 + len * 4);
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, len, true);
        // Copy all elements
        new Uint8Array(memory.buffer, newPtr + 4, len * 4).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 4),
        );
        // Replace element at index
        if (i >= 0 && i < len) {
          new DataView(memory.buffer).setInt32(newPtr + 4 + i * 4, value, true);
        }
        return newPtr;
      },

      list_concat(aPtr: number, bPtr: number, elemSize: number): number {
        const view = new DataView(memory.buffer);
        const aLen = view.getInt32(aPtr, true);
        const bLen = view.getInt32(bPtr, true);
        const newLen = aLen + bLen;
        const newPtr = alloc(4 + newLen * elemSize);
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        // Copy a elements
        new Uint8Array(memory.buffer, newPtr + 4, aLen * elemSize).set(
          new Uint8Array(memory.buffer, aPtr + 4, aLen * elemSize),
        );
        // Copy b elements
        new Uint8Array(memory.buffer, newPtr + 4 + aLen * elemSize, bLen * elemSize).set(
          new Uint8Array(memory.buffer, bPtr + 4, bLen * elemSize),
        );
        return newPtr;
      },

      // --- Map operations ---
      // Maps are backed by JS Map objects stored in mapTable.
      // String-keyed: key passed as i32 pointer to WASM string.
      // Int64-keyed: key passed as i64.
      // All mutations return a new handle (functional style).
      map_new(): number {
        const handle = nextMapHandle++;
        mapTable.set(handle, new Map());
        return handle;
      },

      map_size(handle: number): bigint {
        return BigInt(mapTable.get(handle)?.size ?? 0);
      },

      // String-keyed operations
      map_has_str(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        return mapTable.get(handle)?.has(key) ? 1 : 0;
      },

      map_get_str_i32(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI32(null);
        return allocOptionI32(m.get(key) as number);
      },

      map_get_str_i64(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI64(null);
        return allocOptionI64(m.get(key) as bigint);
      },

      map_set_str_i32(handle: number, keyPtr: number, val: number): number {
        const key = readString(keyPtr);
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_set_str_i64(handle: number, keyPtr: number, val: bigint): number {
        const key = readString(keyPtr);
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_remove_str(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.delete(key);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_keys_str(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI32([]);
        return allocListI32([...m.keys()].map((k) => writeString(k as string)));
      },

      map_values_i32(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI32([]);
        return allocListI32([...m.values()] as number[]);
      },

      // Int64-keyed operations
      map_has_i64(handle: number, key: bigint): number {
        return mapTable.get(handle)?.has(key) ? 1 : 0;
      },

      map_get_i64_i32(handle: number, key: bigint): number {
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI32(null);
        return allocOptionI32(m.get(key) as number);
      },

      map_get_i64_i64(handle: number, key: bigint): number {
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI64(null);
        return allocOptionI64(m.get(key) as bigint);
      },

      map_set_i64_i32(handle: number, key: bigint, val: number): number {
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_set_i64_i64(handle: number, key: bigint, val: bigint): number {
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_remove_i64(handle: number, key: bigint): number {
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.delete(key);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_keys_i64(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI64([]);
        return allocListI64([...m.keys()] as bigint[]);
      },

      map_values_i64(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI64([]);
        return allocListI64([...m.values()] as bigint[]);
      },

      // --- Test assertions ---
      // Assertions accumulate failures rather than throwing, so an LLM
      // can see ALL failures in a single test run for better self-healing.
      assert_eq(actual: bigint, expected: bigint): void {
        assertionCount++;
        if (actual !== expected) {
          assertionFailures.push({
            kind: "assert_eq",
            actual: actual.toString(),
            expected: expected.toString(),
            testFunction: currentTestFunction,
          });
        }
      },

      assert_eq_float(actual: number, expected: number): void {
        assertionCount++;
        const EPSILON = 1e-9;
        if (Math.abs(actual - expected) > EPSILON) {
          assertionFailures.push({
            kind: "assert_eq_float",
            actual: actual.toString(),
            expected: expected.toString(),
            testFunction: currentTestFunction,
          });
        }
      },

      assert_eq_string(actualPtr: number, expectedPtr: number): void {
        assertionCount++;
        const actualStr = readString(actualPtr);
        const expectedStr = readString(expectedPtr);
        if (actualStr !== expectedStr) {
          assertionFailures.push({
            kind: "assert_eq_string",
            actual: JSON.stringify(actualStr),
            expected: JSON.stringify(expectedStr),
            testFunction: currentTestFunction,
          });
        }
      },

      assert_true(value: number): void {
        assertionCount++;
        if (value !== 1) {
          assertionFailures.push({
            kind: "assert_true",
            actual: "False",
            expected: "True",
            testFunction: currentTestFunction,
          });
        }
      },

      assert_false(value: number): void {
        assertionCount++;
        if (value !== 0) {
          assertionFailures.push({
            kind: "assert_false",
            actual: "True",
            expected: "False",
            testFunction: currentTestFunction,
          });
        }
      },


      // --- Random operations ---
      random_int(min: bigint, max: bigint): bigint {
        if (max < min) return min;
        const minN = Number(min);
        const maxN = Number(max);
        const value = Math.floor(Math.random() * (maxN - minN + 1)) + minN;
        return BigInt(value);
      },

      random_float(): number {
        return Math.random();
      },

      // --- Network operations ---
      http_get(urlPtr: number): number {
        const url = readString(urlPtr);
        try {
          const resp = syncHttpRequest({ url, timeoutMs: 10000, followRedirects: true });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
          return allocResultString(true, writeString(resp.body));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultString(false, writeString(msg));
        }
      },

      http_post(urlPtr: number, bodyPtr: number): number {
        const url = readString(urlPtr);
        const body = readString(bodyPtr);
        try {
          const resp = syncHttpRequest({
            url,
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body,
            timeoutMs: 10000,
            followRedirects: true,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
          return allocResultString(true, writeString(resp.body));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultString(false, writeString(msg));
        }
      },

      http_listen(_port: bigint): number {
        return allocResultString(false, writeString("http_listen not implemented yet"));
      },

      http_request(methodPtr: number, urlPtr: number, headersPtr: number, bodyPtr: number): number {
        const method = readString(methodPtr).toUpperCase();
        const url = readString(urlPtr);
        const headersJson = readString(headersPtr);
        const body = readString(bodyPtr);
        const headers: Record<string, string> = {};
        if (headersJson && headersJson !== "{}") {
          try {
            const parsed = JSON.parse(headersJson) as Record<string, unknown>;
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === "string") headers[k] = v;
            }
          } catch {
            return allocResultString(false, writeString("Invalid headers JSON"));
          }
        }
        try {
          const resp = syncHttpRequest({
            url,
            method,
            headers,
            body: body || undefined,
            timeoutMs: 10000,
            followRedirects: true,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
          return allocResultString(true, writeString(resp.body));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultString(false, writeString(msg));
        }
      },

      json_parse_object(ptr: number): number {
        try {
          const parsed = JSON.parse(readString(ptr));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return allocResultString(false, writeString("Expected JSON object"));
          }
          const m = new Map<string | bigint, number | bigint>();
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string") {
              m.set(k, writeString(v));
            } else if (v === null || typeof v === "number" || typeof v === "boolean") {
              m.set(k, writeString(String(v)));
            } else {
              m.set(k, writeString(JSON.stringify(v)));
            }
          }
          const handle = nextMapHandle++;
          mapTable.set(handle, m);
          return allocResultI32(true, handle);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultI32(false, writeString(msg));
        }
      },

      json_stringify_object(handle: number): number {
        const m = mapTable.get(handle) ?? new Map();
        const obj: Record<string, string> = {};
        for (const [k, v] of m.entries()) {
          obj[String(k)] = typeof v === "number" ? readString(v) : String(v);
        }
        return writeString(JSON.stringify(obj));
      },

      db_execute(_sqlPtr: number, _paramsPtr: number): number {
        return allocResultI64(false, 0n, writeString("db_execute not implemented yet"));
      },

      db_query(_sqlPtr: number, _paramsPtr: number): number {
        return allocResultI32(false, writeString("db_query not implemented yet"));
      },

      // --- I/O primitives ---
      read_line(): number {
        if (config.stdin !== undefined) {
          // Return the first line from pre-provided stdin
          const newline = config.stdin.indexOf("\n");
          if (newline === -1) {
            const line = config.stdin;
            config.stdin = "";
            return writeString(line);
          }
          const line = config.stdin.substring(0, newline);
          config.stdin = config.stdin.substring(newline + 1);
          return writeString(line);
        }
        // Synchronous stdin read via Node.js, using a per-runtime leftover buffer.
        // readSync may return multiple lines in one call; buffer the remainder so
        // subsequent read_line() calls can return each line correctly.
        try {
          // If leftover from a previous readSync already contains a newline, drain it.
          const existingNl = stdinBuffer.indexOf("\n");
          if (existingNl !== -1) {
            const line = stdinBuffer.substring(0, existingNl);
            stdinBuffer = stdinBuffer.substring(existingNl + 1);
            return writeString(line);
          }
          // Read more data from stdin.
          const buf = Buffer.alloc(4096);
          const bytesRead = nodeFs.readSync(0, buf, 0, buf.length, null);
          if (bytesRead === 0) {
            // EOF — return whatever is left in the buffer (may be empty).
            const line = stdinBuffer;
            stdinBuffer = "";
            return writeString(line);
          }
          stdinBuffer += buf.toString("utf-8", 0, bytesRead);
          const newline = stdinBuffer.indexOf("\n");
          if (newline === -1) {
            // No newline yet — return everything (last line without a trailing newline).
            const line = stdinBuffer;
            stdinBuffer = "";
            return writeString(line);
          }
          const line = stdinBuffer.substring(0, newline);
          stdinBuffer = stdinBuffer.substring(newline + 1);
          return writeString(line);
        } catch {
          return writeString("");
        }
      },

      read_all_stdin(): number {
        if (config.stdin !== undefined) {
          const content = config.stdin;
          config.stdin = "";
          return writeString(content);
        }
        try {
          const fs = nodeFs;
          const chunks: Buffer[] = [];
          const buf = Buffer.alloc(4096);
          let bytesRead: number;
          while ((bytesRead = fs.readSync(0, buf, 0, buf.length, null)) > 0) {
            chunks.push(buf.subarray(0, bytesRead));
          }
          return writeString(Buffer.concat(chunks).toString("utf-8"));
        } catch {
          return writeString("");
        }
      },

      read_file(pathPtr: number): number {
        const path = readString(pathPtr);
        try {
          if (config.fs) {
            return writeString(config.fs.readFileSync(path, "utf-8"));
          }
          const fs = nodeFs;
          return writeString(fs.readFileSync(path, "utf-8"));
        } catch (e: unknown) {
          return writeString("");
        }
      },

      write_file(pathPtr: number, contentPtr: number): void {
        const path = readString(pathPtr);
        const content = readString(contentPtr);
        if (config.fs) {
          config.fs.writeFileSync(path, content);
          return;
        }
        nodeFs.writeFileSync(path, content);
      },

      get_args(): number {
        const args = config.argv ?? [];
        // Build a List<String> in WASM memory: [length: i32][ptr0: i32][ptr1: i32]...
        // Each element is an i32 string pointer
        const strPtrs = args.map(a => writeString(a));
        const listPtr = alloc(4 + strPtrs.length * 4);
        const view = new DataView(memory.buffer);
        view.setInt32(listPtr, strPtrs.length, true);
        for (let i = 0; i < strPtrs.length; i++) {
          view.setInt32(listPtr + 4 + i * 4, strPtrs[i], true);
        }
        return listPtr;
      },

      exit(code: bigint): void {
        process.exit(Number(code));
      },

      list_reverse(ptr: number, elemSize: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const newPtr = alloc(4 + len * elemSize);
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, len, true);
        const src = new Uint8Array(memory.buffer, ptr + 4, len * elemSize);
        for (let i = 0; i < len; i++) {
          new Uint8Array(memory.buffer, newPtr + 4 + (len - 1 - i) * elemSize, elemSize).set(
            src.subarray(i * elemSize, (i + 1) * elemSize),
          );
        }
        return newPtr;
      },

      // --- Secret operations ---
      // Reads a named secret from environment variables.
      // Returns Option<String>: Some(value) if set, None if absent.
      get_secret(namePtr: number): number {
        const name = readString(namePtr);
        const effectErr = policyCheckEffect("Secret");
        if (effectErr) { audit({ effect: "Secret", op: "get_secret", name, result: "denied", reason: effectErr }); return allocOptionI32(null); }
        const value = process.env[name];
        audit({ effect: "Secret", op: "get_secret", name, result: value !== undefined ? "ok" : "not_found" });
        if (value === undefined) return allocOptionI32(null);
        return allocOptionI32(writeString(value));
      },

      // --- Model operations ---
      // Calls the appropriate LLM provider based on the model name prefix.
      // claude-* → Anthropic Messages API (ANTHROPIC_API_KEY)
      // everything else → OpenAI-compatible (OPENAI_API_KEY / OPENAI_BASE_URL)
      // Returns Result<String, String>: Ok(response_text) or Err(message).
      call_model(modelPtr: number, promptPtr: number): number {
        const model = readString(modelPtr);
        const prompt = readString(promptPtr);
        const effectErr = policyCheckEffect("Model");
        if (effectErr) { audit({ effect: "Model", op: "call_model", model, result: "denied", reason: effectErr }); return allocResultString(false, writeString(effectErr)); }
        const t0 = Date.now();
        const result = callLLM(model, [{ role: "user", content: prompt }]);
        audit({ effect: "Model", op: "call_model", model, result: "ok", duration_ms: Date.now() - t0 });
        return result;
      },

      call_model_system(modelPtr: number, systemPtr: number, promptPtr: number): number {
        const model = readString(modelPtr);
        const system = readString(systemPtr);
        const prompt = readString(promptPtr);
        const effectErr = policyCheckEffect("Model");
        if (effectErr) { audit({ effect: "Model", op: "call_model_system", model, result: "denied", reason: effectErr }); return allocResultString(false, writeString(effectErr)); }
        const t0 = Date.now();
        const result = callLLM(model, [{ role: "system", content: system }, { role: "user", content: prompt }]);
        audit({ effect: "Model", op: "call_model_system", model, result: "ok", duration_ms: Date.now() - t0 });
        return result;
      },

      // --- MCP operations ---
      // Connects to an HTTP MCP server. Stores the URL in the session registry
      // and returns an opaque Int64 session handle.
      // Returns Result<Int64, String>: Ok(session_id) or Err(message).
      mcp_connect(urlPtr: number): number {
        const url = readString(urlPtr);
        const effectErr = policyCheckEffect("MCP");
        if (effectErr) { audit({ effect: "MCP", op: "mcp_connect", url, result: "denied", reason: effectErr }); return allocResultI64(false, 0n, writeString(effectErr)); }
        const urlErr = policyCheckUrl(url);
        if (urlErr) { audit({ effect: "MCP", op: "mcp_connect", url, result: "denied", reason: urlErr }); return allocResultI64(false, 0n, writeString(urlErr)); }
        const id = mcpNextId++;
        mcpSessions.set(id, { url });
        audit({ effect: "MCP", op: "mcp_connect", url, result: "ok", session_id: id });
        return allocResultI64(true, BigInt(id));
      },

      // Lists the tools available from an MCP session.
      // Returns Result<String, String>: Ok(json_array) or Err(message).
      mcp_list_tools(sessionId: bigint): number {
        const session = mcpSessions.get(Number(sessionId));
        if (!session) {
          return allocResultString(false, writeString(`Unknown MCP session: ${sessionId}`));
        }
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
        try {
          const t0 = Date.now();
          const raw = callMcp(session.url, body);
          const parsed = JSON.parse(raw) as { result?: { tools?: unknown[] }; error?: { message?: string } };
          if (parsed.error) {
            audit({ effect: "MCP", op: "mcp_list_tools", url: session.url, result: "error" });
            return allocResultString(false, writeString(`MCP error: ${parsed.error.message ?? "unknown"}`));
          }
          audit({ effect: "MCP", op: "mcp_list_tools", url: session.url, result: "ok", duration_ms: Date.now() - t0 });
          return allocResultString(true, writeString(JSON.stringify(parsed.result?.tools ?? [])));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          audit({ effect: "MCP", op: "mcp_list_tools", url: session.url, result: "error" });
          return allocResultString(false, writeString(msg));
        }
      },

      // Calls a named tool in the MCP session with JSON-encoded arguments.
      // args_json must be a JSON object string, e.g. '{"path":"/tmp/foo"}'.
      // Returns Result<String, String>: Ok(output_text) or Err(message).
      mcp_call_tool(sessionId: bigint, toolPtr: number, argsPtr: number): number {
        const session = mcpSessions.get(Number(sessionId));
        if (!session) {
          return allocResultString(false, writeString(`Unknown MCP session: ${sessionId}`));
        }
        const tool = readString(toolPtr);
        const argsJson = readString(argsPtr);
        let args: unknown;
        try { args = JSON.parse(argsJson); } catch { args = {}; }
        const body = JSON.stringify({
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name: tool, arguments: args },
        });
        try {
          const t0 = Date.now();
          const raw = callMcp(session.url, body);
          const parsed = JSON.parse(raw) as {
            result?: { content?: Array<{ type: string; text?: string }> };
            error?: { message?: string };
          };
          if (parsed.error) {
            audit({ effect: "MCP", op: "mcp_call_tool", url: session.url, tool, result: "error" });
            return allocResultString(false, writeString(`MCP error: ${parsed.error.message ?? "unknown"}`));
          }
          const content = parsed.result?.content ?? [];
          const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
          audit({ effect: "MCP", op: "mcp_call_tool", url: session.url, tool, result: "ok", duration_ms: Date.now() - t0 });
          return allocResultString(true, writeString(text || JSON.stringify(parsed.result)));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          audit({ effect: "MCP", op: "mcp_call_tool", url: session.url, tool, result: "error" });
          return allocResultString(false, writeString(msg));
        }
      },

      // Removes the MCP session from the registry.
      mcp_disconnect(sessionId: bigint): void {
        mcpSessions.delete(Number(sessionId));
      },

      // --- A2A operations ---
      // Fetches the agent card from {url}/.well-known/agent.json.
      // Returns Result<String, String>: Ok(agent_card_json) or Err(message).
      a2a_discover(urlPtr: number): number {
        const baseUrl = readString(urlPtr).replace(/\/$/, "");
        const effectErr = policyCheckEffect("A2A");
        if (effectErr) { audit({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "denied", reason: effectErr }); return allocResultString(false, writeString(effectErr)); }
        const urlErr = policyCheckUrl(baseUrl);
        if (urlErr) { audit({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "denied", reason: urlErr }); return allocResultString(false, writeString(urlErr)); }
        try {
          const t0 = Date.now();
          const resp = syncHttpRequest({
            url: `${baseUrl}/.well-known/agent.json`,
            timeoutMs: 10000,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
          audit({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "ok", duration_ms: Date.now() - t0 });
          return allocResultString(true, writeString(resp.body.trim()));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          audit({ effect: "A2A", op: "a2a_discover", url: baseUrl, result: "error" });
          return allocResultString(false, writeString(msg));
        }
      },

      // Submits a text message as a task to an A2A agent.
      // Uses the JSON-RPC 2.0 tasks/send method.
      // Returns Result<String, String>: Ok(task_id) or Err(message).
      a2a_submit(urlPtr: number, messagePtr: number): number {
        const baseUrl = readString(urlPtr).replace(/\/$/, "");
        const message = readString(messagePtr);
        const effectErr = policyCheckEffect("A2A");
        if (effectErr) { audit({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "denied", reason: effectErr }); return allocResultString(false, writeString(effectErr)); }
        const urlErr = policyCheckUrl(baseUrl);
        if (urlErr) { audit({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "denied", reason: urlErr }); return allocResultString(false, writeString(urlErr)); }
        const taskId = `clarity-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: taskId,
          method: "tasks/send",
          params: {
            id: taskId,
            message: {
              role: "user",
              parts: [{ type: "text", text: message }],
            },
          },
        });
        try {
          const t0 = Date.now();
          const raw = callA2A(baseUrl, body);
          const parsed = JSON.parse(raw) as {
            result?: { id?: string; status?: { state?: string } };
            error?: { message?: string };
          };
          if (parsed.error) {
            audit({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "error" });
            return allocResultString(false, writeString(`A2A error: ${parsed.error.message ?? "unknown"}`));
          }
          const returnedId = parsed.result?.id ?? taskId;
          audit({ effect: "A2A", op: "a2a_submit", url: baseUrl, task_id: returnedId, result: "ok", duration_ms: Date.now() - t0 });
          return allocResultString(true, writeString(returnedId));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          audit({ effect: "A2A", op: "a2a_submit", url: baseUrl, result: "error" });
          return allocResultString(false, writeString(msg));
        }
      },

      // Polls for the current status of an A2A task.
      // Returns Result<String, String>: Ok(status_json) or Err(message).
      a2a_poll(urlPtr: number, taskIdPtr: number): number {
        const baseUrl = readString(urlPtr).replace(/\/$/, "");
        const taskId = readString(taskIdPtr);
        const effectErr = policyCheckEffect("A2A");
        if (effectErr) { audit({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "denied", reason: effectErr }); return allocResultString(false, writeString(effectErr)); }
        const urlErr = policyCheckUrl(baseUrl);
        if (urlErr) { audit({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "denied", reason: urlErr }); return allocResultString(false, writeString(urlErr)); }
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: `poll-${Date.now()}`,
          method: "tasks/get",
          params: { id: taskId },
        });
        try {
          const t0 = Date.now();
          const raw = callA2A(baseUrl, body);
          const parsed = JSON.parse(raw) as {
            result?: { id?: string; status?: { state?: string }; artifacts?: Array<{ parts?: Array<{ type: string; text?: string }> }> };
            error?: { message?: string };
          };
          if (parsed.error) {
            audit({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "error" });
            return allocResultString(false, writeString(`A2A error: ${parsed.error.message ?? "unknown"}`));
          }
          const result = parsed.result ?? {};
          const artParts = (result.artifacts ?? []).flatMap((a) => a.parts ?? []);
          const outputText = artParts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
          const summary = { id: result.id ?? taskId, status: result.status?.state ?? "unknown", output: outputText };
          audit({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, status: summary.status, result: "ok", duration_ms: Date.now() - t0 });
          return allocResultString(true, writeString(JSON.stringify(summary)));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          audit({ effect: "A2A", op: "a2a_poll", url: baseUrl, task_id: taskId, result: "error" });
          return allocResultString(false, writeString(msg));
        }
      },

      // Cancels a running A2A task.
      // Returns Result<String, String>: Ok(final_status_json) or Err(message).
      a2a_cancel(urlPtr: number, taskIdPtr: number): number {
        const baseUrl = readString(urlPtr).replace(/\/$/, "");
        const taskId = readString(taskIdPtr);
        const effectErr = policyCheckEffect("A2A");
        if (effectErr) { audit({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "denied", reason: effectErr }); return allocResultString(false, writeString(effectErr)); }
        const urlErr = policyCheckUrl(baseUrl);
        if (urlErr) { audit({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "denied", reason: urlErr }); return allocResultString(false, writeString(urlErr)); }
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: `cancel-${Date.now()}`,
          method: "tasks/cancel",
          params: { id: taskId },
        });
        try {
          const t0 = Date.now();
          const raw = callA2A(baseUrl, body);
          const parsed = JSON.parse(raw) as {
            result?: { id?: string; status?: { state?: string } };
            error?: { message?: string };
          };
          if (parsed.error) {
            audit({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "error" });
            return allocResultString(false, writeString(`A2A error: ${parsed.error.message ?? "unknown"}`));
          }
          const result = parsed.result ?? {};
          const summary = { id: result.id ?? taskId, status: result.status?.state ?? "canceled" };
          audit({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "ok", duration_ms: Date.now() - t0 });
          return allocResultString(true, writeString(JSON.stringify(summary)));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          audit({ effect: "A2A", op: "a2a_cancel", url: baseUrl, task_id: taskId, result: "error" });
          return allocResultString(false, writeString(msg));
        }
      },

      // --- Policy introspection ---
      // Check if a URL is permitted by the runtime policy.
      policy_is_url_allowed(urlPtr: number): number {
        return policyCheckUrl(readString(urlPtr)) === null ? 1 : 0;
      },

      // Check if an effect family is permitted by the runtime policy.
      policy_is_effect_allowed(effectPtr: number): number {
        return policyCheckEffect(readString(effectPtr)) === null ? 1 : 0;
      },

      list_models(): number {
        const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
        const apiKey = process.env.OPENAI_API_KEY ?? "";
        try {
          const resp = syncHttpRequest({
            url: `${baseUrl}/v1/models`,
            headers: { "Authorization": `Bearer ${apiKey}` },
            timeoutMs: 10000,
          });
          const parsed = JSON.parse(resp.body) as { data?: Array<{ id: string }> };
          const ids = (parsed.data ?? []).map((m) => m.id);
          const ptrs = ids.map((id) => writeString(id));
          return allocListI32(ptrs);
        } catch {
          return allocListI32([]);
        }
      },

      // --- Trace operations ---
      trace_start(opPtr: number): bigint {
        const op = readString(opPtr);
        const effectErr = policyCheckEffect("Trace");
        if (effectErr) return 0n;
        const spanId = nextSpanId++;
        spanTable.set(spanId, { op, start: Date.now(), events: [] });
        return BigInt(spanId);
      },

      trace_end(spanIdBig: bigint): void {
        const spanId = Number(spanIdBig);
        const span = spanTable.get(spanId);
        if (!span) return;
        const duration_ms = Date.now() - span.start;
        audit({ effect: "Trace", op: span.op, span_id: spanId, duration_ms, events: span.events });
        spanTable.delete(spanId);
      },

      trace_log(spanIdBig: bigint, messagePtr: number): void {
        const spanId = Number(spanIdBig);
        const message = readString(messagePtr);
        const span = spanTable.get(spanId);
        if (span) {
          span.events.push(`${Date.now() - span.start}ms: ${message}`);
        }
      },

      // --- Persist operations ---
      checkpoint_save(keyPtr: number, valuePtr: number): number {
        const key = readString(keyPtr);
        const value = readString(valuePtr);
        const effectErr = policyCheckEffect("Persist");
        if (effectErr) return allocResultString(false, writeString(effectErr));
        try {
          const dir = process.env.CLARITY_CHECKPOINT_DIR ?? ".clarity-checkpoints";
          nodeFs.mkdirSync(dir, { recursive: true });
          const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
          nodeFs.writeFileSync(`${dir}/${safeKey}.ckpt`, value, "utf-8");
          return allocResultString(true, writeString(""));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultString(false, writeString(msg));
        }
      },

      checkpoint_load(keyPtr: number): number {
        const key = readString(keyPtr);
        const effectErr = policyCheckEffect("Persist");
        if (effectErr) return allocOptionI32(null);
        try {
          const dir = process.env.CLARITY_CHECKPOINT_DIR ?? ".clarity-checkpoints";
          const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
          const path = `${dir}/${safeKey}.ckpt`;
          if (!nodeFs.existsSync(path)) return allocOptionI32(null);
          const v = nodeFs.readFileSync(path, "utf-8");
          return allocOptionI32(writeString(v));
        } catch {
          return allocOptionI32(null);
        }
      },

      checkpoint_delete(keyPtr: number): void {
        const key = readString(keyPtr);
        try {
          const dir = process.env.CLARITY_CHECKPOINT_DIR ?? ".clarity-checkpoints";
          const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
          const path = `${dir}/${safeKey}.ckpt`;
          if (nodeFs.existsSync(path)) nodeFs.unlinkSync(path);
        } catch { /* ignore */ }
      },

      // checkpoint_save_raw: same as checkpoint_save but returns Bool (1/0) with no heap allocation.
      // Safe to call before arena_restore() since the result is a plain i32.
      checkpoint_save_raw(keyPtr: number, valuePtr: number): number {
        const key = readString(keyPtr);
        const value = readString(valuePtr);
        const effectErr = policyCheckEffect("Persist");
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

      // hitl_ask: pause execution and wait for a human response via file-based handshake.
      // Writes {CLARITY_HITL_DIR}/{safeKey}.question as JSON, polls for {safeKey}.answer.
      // Blocks synchronously using Atomics.wait (500 ms intervals) to avoid busy-waiting.
      // Timeout controlled by CLARITY_HITL_TIMEOUT_SECS (default 600 = 10 minutes).
      hitl_ask(keyPtr: number, questionPtr: number): number {
        const key = readString(keyPtr);
        const question = readString(questionPtr);
        const effectErr = policyCheckEffect("HumanInLoop");
        if (effectErr) return writeString(`[HumanInLoop denied: ${effectErr}]`);

        const dir = process.env.CLARITY_HITL_DIR ?? ".clarity-hitl";
        const timeoutSecs = parseInt(process.env.CLARITY_HITL_TIMEOUT_SECS ?? "600", 10);
        nodeFs.mkdirSync(dir, { recursive: true });

        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
        const questionFile = `${dir}/${safeKey}.question`;
        const answerFile = `${dir}/${safeKey}.answer`;

        // Write the question so the broker/operator can see it.
        nodeFs.writeFileSync(questionFile, JSON.stringify({
          key,
          question,
          timestamp: Date.now(),
          pid: process.pid,
        }), "utf-8");

        // Poll for the answer file using Atomics.wait for non-busy sleep.
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
              return writeString(answer);
            } catch {
              // race — broker still writing; retry next poll
            }
          }
        }

        // Timeout: clean up question file and return a timeout marker.
        try { nodeFs.unlinkSync(questionFile); } catch { /* ignore */ }
        return writeString("[hitl_ask timeout]");
      },

      // --- Embed operations ---
      embed_text(textPtr: number): number {
        const text = readString(textPtr);
        const effectErr = policyCheckEffect("Embed");
        if (effectErr) return allocResultString(false, writeString(effectErr));
        const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
        const apiKey = process.env.OPENAI_API_KEY ?? "";
        const model = process.env.CLARITY_EMBED_MODEL ?? "text-embedding-ada-002";
        try {
          const resp = syncHttpRequest({
            url: `${baseUrl}/v1/embeddings`,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ input: text, model }),
            timeoutMs: 30000,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
          const parsed = JSON.parse(resp.body) as { data?: Array<{ embedding: number[] }> };
          const embedding = parsed.data?.[0]?.embedding ?? [];
          return allocResultString(true, writeString(JSON.stringify(embedding)));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultString(false, writeString(msg));
        }
      },

      cosine_similarity(aPtr: number, bPtr: number): number {
        try {
          const a = JSON.parse(readString(aPtr)) as number[];
          const b = JSON.parse(readString(bPtr)) as number[];
          if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
          let dot = 0, nA = 0, nB = 0;
          for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
          const denom = Math.sqrt(nA) * Math.sqrt(nB);
          return denom === 0 ? 0 : dot / denom;
        } catch { return 0; }
      },

      chunk_text(textPtr: number, sizeN: bigint): number {
        const text = readString(textPtr);
        const size = Math.max(1, Number(sizeN));
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
        return writeString(JSON.stringify(chunks));
      },

      embed_and_retrieve(queryPtr: number, chunksJsonPtr: number, topKN: bigint): number {
        const query = readString(queryPtr);
        const chunksJson = readString(chunksJsonPtr);
        const topK = Math.max(1, Number(topKN));
        const effectErr = policyCheckEffect("Embed");
        if (effectErr) return allocResultString(false, writeString(effectErr));
        try {
          const chunks = JSON.parse(chunksJson) as string[];
          if (!Array.isArray(chunks) || chunks.length === 0) {
            return allocResultString(true, writeString("[]"));
          }
          const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
          const apiKey = process.env.OPENAI_API_KEY ?? "";
          const model = process.env.CLARITY_EMBED_MODEL ?? "text-embedding-ada-002";
          const inputs = [query, ...chunks];
          const resp = syncHttpRequest({
            url: `${baseUrl}/v1/embeddings`,
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ input: inputs, model }),
            timeoutMs: 60000,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
          const parsed = JSON.parse(resp.body) as { data?: Array<{ embedding: number[]; index: number }> };
          const data = (parsed.data ?? []).sort((a, b) => a.index - b.index);
          if (data.length !== inputs.length) throw new Error("Embedding count mismatch");
          const qVec = data[0].embedding;
          const scores = data.slice(1).map((d, i) => {
            let dot = 0, nA = 0, nB = 0;
            for (let j = 0; j < qVec.length; j++) { dot += qVec[j] * d.embedding[j]; nA += qVec[j] * qVec[j]; nB += d.embedding[j] * d.embedding[j]; }
            const sim = Math.sqrt(nA) * Math.sqrt(nB) === 0 ? 0 : dot / (Math.sqrt(nA) * Math.sqrt(nB));
            return { idx: i, sim };
          });
          scores.sort((a, b) => b.sim - a.sim);
          const topChunks = scores.slice(0, topK).map((s) => chunks[s.idx]);
          return allocResultString(true, writeString(JSON.stringify(topChunks)));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultString(false, writeString(msg));
        }
      },

      // -----------------------------------------------------------------------
      // Eval builtins
      // -----------------------------------------------------------------------

      eval_exact(gotPtr: number, expectedPtr: number): number {
        const got = readString(gotPtr);
        const expected = readString(expectedPtr);
        return got === expected ? 1 : 0;
      },

      eval_contains(gotPtr: number, expectedPtr: number): number {
        const got = readString(gotPtr);
        const expected = readString(expectedPtr);
        return got.includes(expected) ? 1 : 0;
      },

      eval_llm_judge(modelPtr: number, promptPtr: number, responsePtr: number, rubricPtr: number): number {
        const model = readString(modelPtr);
        const prompt = readString(promptPtr);
        const response = readString(responsePtr);
        const rubric = readString(rubricPtr);
        const effectErr = policyCheckEffect("Eval");
        if (effectErr) return allocResultString(false, writeString(effectErr));
        const sysContent = "You are an impartial evaluator. Given the original prompt, a response, and a rubric, output ONLY a JSON object with keys: \"score\" (float 0.0-1.0), \"pass\" (boolean, true when score >= 0.7), \"reason\" (one sentence). Do not include any other text.";
        const userMsg = `Prompt: ${prompt}\n\nResponse: ${response}\n\nRubric: ${rubric}`;
        const resultPtr = callLLM(model, [{ role: "system", content: sysContent }, { role: "user", content: userMsg }]);
        // resultPtr is a Result<String,String>. On Ok, verify it looks like JSON.
        const view = new DataView(memory.buffer);
        const tag = view.getInt32(resultPtr, true);
        if (tag !== 0) return resultPtr; // propagate Err
        const textPtr = view.getInt32(resultPtr + 4, true);
        const text = readString(textPtr).trim();
        // Attempt to extract JSON from the response (models sometimes wrap in ```json```)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const json = jsonMatch ? jsonMatch[0] : text;
        return allocResultString(true, writeString(json));
      },

      eval_semantic(gotPtr: number, expectedPtr: number): number {
        const got = readString(gotPtr);
        const expected = readString(expectedPtr);
        const effectErr = policyCheckEffect("Eval");
        if (effectErr) return allocResultString(false, writeString(effectErr));
        try {
          const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
          const apiKey = process.env.OPENAI_API_KEY ?? "";
          const model = process.env.CLARITY_EMBED_MODEL ?? "text-embedding-ada-002";
          if (!apiKey) return allocResultString(false, writeString("OPENAI_API_KEY not set"));
          const resp = syncHttpRequest({
            url: `${baseUrl}/v1/embeddings`,
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ input: [got, expected], model }),
            timeoutMs: 30000,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
          const parsed = JSON.parse(resp.body) as { data?: Array<{ embedding: number[]; index: number }> };
          const data = (parsed.data ?? []).sort((a, b) => a.index - b.index);
          if (data.length < 2) throw new Error("Expected 2 embeddings");
          const a = data[0].embedding, b = data[1].embedding;
          let dot = 0, nA = 0, nB = 0;
          for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
          const sim = Math.sqrt(nA) * Math.sqrt(nB) === 0 ? 0 : dot / (Math.sqrt(nA) * Math.sqrt(nB));
          // Result<Float64, String>: [tag:i32][f64] = 12 bytes
          const ptr = alloc(12);
          const v2 = new DataView(memory.buffer);
          v2.setInt32(ptr, 0, true); // Ok
          v2.setFloat64(ptr + 4, sim, true);
          return ptr;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultString(false, writeString(msg));
        }
      },

      // -----------------------------------------------------------------------
      // Streaming builtins
      // -----------------------------------------------------------------------

      stream_start(modelPtr: number, promptPtr: number, systemPtr: number): number {
        const model = readString(modelPtr);
        const prompt = readString(promptPtr);
        const system = readString(systemPtr);
        const effectErr = policyCheckEffect("Model");
        if (effectErr) return allocResultI64(false, 0n, writeString(effectErr));
        try {
          const sab = new SharedArrayBuffer(STREAM_SAB_SIZE);
          const isAnthropic = model.startsWith("claude-");
          let url: string, reqHeaders: Record<string, string>, body: string;
          if (isAnthropic) {
            const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
            const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
            const urlErr = policyCheckUrl(`${baseUrl}/v1/messages`);
            if (urlErr) return allocResultI64(false, 0n, writeString(urlErr));
            url = `${baseUrl}/v1/messages`;
            reqHeaders = {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            };
            body = JSON.stringify({
              model,
              max_tokens: 4096,
              stream: true,
              ...(system ? { system } : {}),
              messages: [{ role: "user", content: prompt }],
            });
          } else {
            const apiKey = process.env.OPENAI_API_KEY ?? "";
            const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
            const urlErr = policyCheckUrl(`${baseUrl}/v1/chat/completions`);
            if (urlErr) return allocResultI64(false, 0n, writeString(urlErr));
            url = `${baseUrl}/v1/chat/completions`;
            reqHeaders = {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            };
            const messages = system
              ? [{ role: "system", content: system }, { role: "user", content: prompt }]
              : [{ role: "user", content: prompt }];
            body = JSON.stringify({ model, max_tokens: 4096, stream: true, messages });
          }
          const worker = new Worker(_STREAM_WORKER_CODE, {
            eval: true,
            workerData: {
              sab,
              url,
              method: "POST",
              reqHeaders,
              body,
              isAnthropic,
              tokenOffset: STREAM_TOKEN_OFFSET,
              errorOffset: STREAM_ERROR_OFFSET,
              maxToken: STREAM_MAX_TOKEN,
              maxError: STREAM_MAX_ERROR,
            },
          });
          const handle = nextStreamHandle++;
          streamSessions.set(handle, { sab, ctrl: new Int32Array(sab, 0, 1), worker });
          return allocResultI64(true, BigInt(handle));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return allocResultI64(false, 0n, writeString(msg));
        }
      },

      stream_next(handleN: bigint): number {
        const handle = Number(handleN);
        const session = streamSessions.get(handle);
        if (!session) return allocOptionI32(null); // unknown handle → None
        const { ctrl, sab } = session;
        // Block until status is no longer IDLE (token ready, done, or error).
        Atomics.wait(ctrl, 0, 0 /* STATUS_IDLE */, 120000);
        const status = Atomics.load(ctrl, 0);
        if (status === 2 /* DONE */ || status === 3 /* ERROR */) {
          // Store any error in the session so stream_close can return it.
          if (status === 3) {
            const meta = new DataView(sab);
            const errLen = meta.getInt32(8, true);
            const errBytes = new Uint8Array(sab, STREAM_ERROR_OFFSET, errLen);
            session.lastError = Buffer.from(errBytes).toString("utf-8");
          }
          return allocOptionI32(null); // None → stream ended
        }
        // STATUS_TOKEN: read token, reset to IDLE, wake worker.
        const meta = new DataView(sab);
        const tokenLen = meta.getInt32(4, true);
        const tokenBytes = new Uint8Array(sab, STREAM_TOKEN_OFFSET, tokenLen);
        const token = Buffer.from(tokenBytes).toString("utf-8");
        Atomics.store(ctrl, 0, 0 /* STATUS_IDLE */);
        Atomics.notify(ctrl, 0, 1);
        return allocOptionI32(writeString(token)); // Some(token)
      },

      stream_close(handleN: bigint): number {
        const handle = Number(handleN);
        const session = streamSessions.get(handle);
        if (!session) return writeString("");
        session.worker.terminate();
        streamSessions.delete(handle);
        return writeString(session.lastError ?? "");
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Multi-provider LLM routing.
  // Detects provider from model name prefix and dispatches to the correct API.
  //   claude-*  → Anthropic Messages API (/v1/messages)
  //   *         → OpenAI-compatible (/v1/chat/completions)
  // ---------------------------------------------------------------------------
  function callLLM(
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): number {
    if (model.startsWith("claude-")) return callAnthropic(model, messages);
    // OpenAI-compatible path — build body and delegate to callOpenAI.
    const body = JSON.stringify({ model, messages, max_tokens: 4096 });
    return callOpenAI(body);
  }

  // Anthropic Messages API adapter.
  function callAnthropic(
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): number {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
    const urlErr = policyCheckUrl(`${baseUrl}/v1/messages`);
    if (urlErr) return allocResultString(false, writeString(urlErr));
    // Anthropic sends system prompt as a top-level field, not as a message.
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsgs = messages.filter((m) => m.role !== "system");
    const body = JSON.stringify({
      model,
      max_tokens: 4096,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: userMsgs,
    });
    try {
      const resp = syncHttpRequest({
        url: `${baseUrl}/v1/messages`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body,
        timeoutMs: 120000,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
      const parsed = JSON.parse(resp.body) as { content?: Array<{ type: string; text?: string }> };
      const content = parsed.content?.find((c) => c.type === "text")?.text ?? "";
      return allocResultString(true, writeString(content));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return allocResultString(false, writeString(msg));
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helper: POST a pre-built JSON body to the OpenAI chat completions
  // endpoint and return a Result<String, String> heap pointer.
  // ---------------------------------------------------------------------------
  function callOpenAI(body: string): number {
    const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    try {
      const resp = syncHttpRequest({
        url: `${baseUrl}/v1/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body,
        timeoutMs: 120000,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
      const parsed = JSON.parse(resp.body) as { choices?: Array<{ message?: { content?: string } }> };
      const content = parsed.choices?.[0]?.message?.content ?? "";
      return allocResultString(true, writeString(content));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return allocResultString(false, writeString(msg));
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helper: POST a JSON-RPC body to an MCP HTTP endpoint.
  // Handles both plain JSON and Server-Sent Events (SSE) responses.
  // Throws on HTTP errors so callers can wrap in try/catch.
  // ---------------------------------------------------------------------------
  function callMcp(url: string, body: string): string {
    const resp = syncHttpRequest({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body,
      timeoutMs: 60000,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
    const raw = resp.body;
    // Handle SSE responses: lines starting with "data: "
    if (raw.trimStart().startsWith("data:")) {
      const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
      const last = lines[lines.length - 1];
      return last ? last.slice("data:".length).trim() : "{}";
    }
    return raw;
  }

  // ---------------------------------------------------------------------------
  // Internal helper: POST a JSON-RPC body to an A2A HTTP endpoint.
  // The A2A endpoint is the agent's base URL (not a /.well-known path).
  // Throws on HTTP errors so callers can wrap in try/catch.
  // ---------------------------------------------------------------------------
  function callA2A(baseUrl: string, body: string): string {
    const resp = syncHttpRequest({
      url: baseUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      timeoutMs: 60000,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
    return resp.body;
  }

  return {
    get memory() { return memory; },
    imports,
    readString,
    writeString,
    setHeapBase,
    bindMemory,
    // Test runner API
    setCurrentTest(name: string) { currentTestFunction = name; },
    getTestResults() { return { total: assertionCount, failures: [...assertionFailures] }; },
    resetTestState() { assertionFailures = []; assertionCount = 0; },
    // Memory management API (for tests and host tooling)
    getHeapPtr() { return heapPtr; },
    getLiveAllocCount() { return allocSizeMap.size; },
  };
}
