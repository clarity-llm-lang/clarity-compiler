// Network builtins: http_request, SSE client, syncHttpRequest helper.

import * as nodeFs from "node:fs";
import { Worker } from "node:worker_threads";
import type { SharedHelpers } from "./types.js";

export const HTTP_MAX_BODY = 8 * 1024 * 1024; // 8 MB

export const _HTTP_WORKER_CODE = `
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

export const _SSE_WORKER_CODE = `
const { workerData } = require('worker_threads');
const https = require('https');
const http = require('http');
const {
  sab, url, reqHeaders,
  tokenOffset, errorOffset, maxToken, maxError,
} = workerData;

const ctrl = new Int32Array(sab, 0, 1);
const meta = new DataView(sab);
const STATUS_IDLE = 0, STATUS_TOKEN = 1, STATUS_DONE = 2, STATUS_ERROR = 3;

function putToken(token) {
  if (!token) return;
  Atomics.wait(ctrl, 0, STATUS_TOKEN);
  const encoded = Buffer.from(token, 'utf8');
  const len = Math.min(encoded.length, maxToken);
  meta.setInt32(4, len, true);
  new Uint8Array(sab, tokenOffset, len).set(encoded.subarray(0, len));
  Atomics.store(ctrl, 0, STATUS_TOKEN);
  Atomics.notify(ctrl, 0, 1);
}

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

function putDone() {
  let safety = 0;
  while (Atomics.load(ctrl, 0) === STATUS_TOKEN && safety++ < 200) {
    Atomics.wait(ctrl, 0, STATUS_TOKEN, 50);
  }
  Atomics.store(ctrl, 0, STATUS_DONE);
  Atomics.notify(ctrl, 0, 1);
}

let urlObj;
try { urlObj = new URL(url); } catch(e) { putError('Invalid URL: ' + url); }
const mod = urlObj.protocol === 'https:' ? https : http;
const reqOpts = {
  hostname: urlObj.hostname,
  port: urlObj.port ? parseInt(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 80),
  path: (urlObj.pathname || '/') + (urlObj.search || ''),
  method: 'GET',
  headers: Object.assign({ 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' }, reqHeaders || {}),
  timeout: 300000,
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
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') { putDone(); return; }
        if (data) putToken(data);
      }
    }
  });
  res.on('end', function() {
    if (remainder.trim().startsWith('data:')) {
      const data = remainder.trim().slice(5).trim();
      if (data && data !== '[DONE]') putToken(data);
    }
    putDone();
  });
});
req.on('error', function(e) { putError(e.message); });
req.end();
`;

export interface SyncHttpResponse {
  ok: boolean;
  status: number;
  body: string;
}

export function syncHttpRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
}): SyncHttpResponse {
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

// SAB constants shared by streaming
export const STREAM_MAX_TOKEN = 4096;
export const STREAM_MAX_ERROR = 1024;
export const STREAM_TOKEN_OFFSET = 12;
export const STREAM_ERROR_OFFSET = 12 + STREAM_MAX_TOKEN;
export const STREAM_SAB_SIZE = 12 + STREAM_MAX_TOKEN + STREAM_MAX_ERROR;

export interface StreamSession {
  sab: SharedArrayBuffer;
  ctrl: Int32Array;
  worker: Worker;
  lastError?: string;
}

export function createNetworkRuntime(h: SharedHelpers) {
  // SSE session state
  const sseSessions = new Map<number, StreamSession>();
  let nextSseHandle = 1;

  return {
    http_request(methodPtr: number, urlPtr: number, headersJsonPtr: number, bodyPtr: number): number {
      const method = h.readString(methodPtr).toUpperCase();
      const url = h.readString(urlPtr);
      const headersJson = h.readString(headersJsonPtr);
      const body = h.readString(bodyPtr);
      try {
        let headers: Record<string, string> = {};
        if (headersJson.trim() !== "" && headersJson.trim() !== "{}") {
          const parsed = JSON.parse(headersJson);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              headers[k] = String(v);
            }
          }
        }
        const resp = syncHttpRequest({ url, method, headers, body: body.length > 0 ? body : undefined, timeoutMs: 10000, followRedirects: true });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
        return h.allocResultString(true, h.writeString(resp.body));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    http_request_full(methodPtr: number, urlPtr: number, headersJsonPtr: number, bodyPtr: number): number {
      const method = h.readString(methodPtr).toUpperCase();
      const url = h.readString(urlPtr);
      const headersJson = h.readString(headersJsonPtr);
      const body = h.readString(bodyPtr);
      try {
        let headers: Record<string, string> = {};
        if (headersJson.trim() !== "" && headersJson.trim() !== "{}") {
          const parsed = JSON.parse(headersJson);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              headers[k] = String(v);
            }
          }
        }
        const resp = syncHttpRequest({ url, method, headers, body: body.length > 0 ? body : undefined, timeoutMs: 10000, followRedirects: true });
        const resultJson = JSON.stringify({ status: resp.status, body: resp.body });
        return h.allocResultString(true, h.writeString(resultJson));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    http_get(urlPtr: number): number {
      const url = h.readString(urlPtr);
      try {
        const resp = syncHttpRequest({ url, timeoutMs: 10000, followRedirects: true });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
        return h.allocResultString(true, h.writeString(resp.body));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    http_post(urlPtr: number, bodyPtr: number): number {
      const url = h.readString(urlPtr);
      const body = h.readString(bodyPtr);
      try {
        const resp = syncHttpRequest({ url, method: "POST", headers: { "Content-Type": "text/plain" }, body, timeoutMs: 10000, followRedirects: true });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
        return h.allocResultString(true, h.writeString(resp.body));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    sse_connect(urlPtr: number, headersPtr: number): number {
      const url = h.readString(urlPtr);
      const headersJson = h.readString(headersPtr);
      const effectErr = h.policyCheckEffect("Network");
      if (effectErr) return h.allocResultI64(false, 0n, h.writeString(effectErr));
      const urlErr = h.policyCheckUrl(url);
      if (urlErr) return h.allocResultI64(false, 0n, h.writeString(urlErr));
      try {
        let reqHeaders: Record<string, string> = {};
        if (headersJson && headersJson !== "{}") {
          try { reqHeaders = JSON.parse(headersJson); } catch (_) { /* ignore */ }
        }
        const sab = new SharedArrayBuffer(STREAM_SAB_SIZE);
        const worker = new Worker(_SSE_WORKER_CODE, {
          eval: true,
          workerData: { sab, url, reqHeaders, tokenOffset: STREAM_TOKEN_OFFSET, errorOffset: STREAM_ERROR_OFFSET, maxToken: STREAM_MAX_TOKEN, maxError: STREAM_MAX_ERROR },
        });
        const handle = nextSseHandle++;
        sseSessions.set(handle, { sab, ctrl: new Int32Array(sab, 0, 1), worker });
        return h.allocResultI64(true, BigInt(handle));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultI64(false, 0n, h.writeString(msg));
      }
    },

    sse_next_event(handleN: bigint): number {
      const handle = Number(handleN);
      const session = sseSessions.get(handle);
      if (!session) return h.allocOptionI32(null);
      const { ctrl, sab } = session;
      Atomics.wait(ctrl, 0, 0, 300000);
      const status = Atomics.load(ctrl, 0);
      if (status === 2 || status === 3) {
        if (status === 3) {
          const meta = new DataView(sab);
          const errLen = meta.getInt32(8, true);
          const errBytes = new Uint8Array(sab, STREAM_ERROR_OFFSET, errLen);
          session.lastError = Buffer.from(errBytes).toString("utf-8");
        }
        return h.allocOptionI32(null);
      }
      const meta = new DataView(sab);
      const tokenLen = meta.getInt32(4, true);
      const tokenBytes = new Uint8Array(sab, STREAM_TOKEN_OFFSET, tokenLen);
      const event = Buffer.from(tokenBytes).toString("utf-8");
      Atomics.store(ctrl, 0, 0);
      Atomics.notify(ctrl, 0, 1);
      return h.allocOptionI32(h.writeString(event));
    },

    sse_close(handleN: bigint): void {
      const handle = Number(handleN);
      const session = sseSessions.get(handle);
      if (!session) return;
      session.worker.terminate();
      sseSessions.delete(handle);
    },

    sse_next_event_timeout(handleN: bigint, timeoutN: bigint): number {
      const handle = Number(handleN);
      const timeoutMs = Number(timeoutN);
      const session = sseSessions.get(handle);
      if (!session) return h.allocOptionI32(null);
      const { ctrl, sab } = session;
      const waitResult = Atomics.wait(ctrl, 0, 0, timeoutMs);
      if (waitResult === "timed-out") return h.allocOptionI32(null);
      const status = Atomics.load(ctrl, 0);
      if (status === 2 || status === 3) {
        if (status === 3) {
          const meta = new DataView(sab);
          const errLen = meta.getInt32(8, true);
          const errBytes = new Uint8Array(sab, STREAM_ERROR_OFFSET, errLen);
          session.lastError = Buffer.from(errBytes).toString("utf-8");
        }
        return h.allocOptionI32(null);
      }
      const meta = new DataView(sab);
      const tokenLen = meta.getInt32(4, true);
      const tokenBytes = new Uint8Array(sab, STREAM_TOKEN_OFFSET, tokenLen);
      const event = Buffer.from(tokenBytes).toString("utf-8");
      Atomics.store(ctrl, 0, 0);
      Atomics.notify(ctrl, 0, 1);
      return h.allocOptionI32(h.writeString(event));
    },

    // Stub DB operations
    db_execute(_sqlPtr: number, _paramsPtr: number): number {
      return h.allocResultI64(false, 0n, h.writeString("db_execute not implemented yet"));
    },

    db_query(_sqlPtr: number, _paramsPtr: number): number {
      return h.allocResultI32(false, h.writeString("db_query not implemented yet"));
    },
  };
}
