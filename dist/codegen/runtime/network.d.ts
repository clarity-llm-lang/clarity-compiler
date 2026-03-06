import { Worker } from "node:worker_threads";
import type { SharedHelpers } from "./types.js";
export declare const HTTP_MAX_BODY: number;
export declare const _HTTP_WORKER_CODE = "\nconst { workerData } = require('worker_threads');\nconst https = require('https');\nconst http = require('http');\nconst { sab, url: initialUrl, method, headers, body, timeoutMs, followRedirects } = workerData;\nconst ctrl = new Int32Array(sab, 0, 1);\nconst view = new DataView(sab);\nconst MAX_BODY = sab.byteLength - 12;\n\nfunction finish(done, status, bodyStr) {\n  const encoded = Buffer.from(bodyStr || '', 'utf8');\n  const len = Math.min(encoded.length, MAX_BODY);\n  view.setInt32(4, status, true);\n  view.setInt32(8, len, true);\n  new Uint8Array(sab, 12, len).set(encoded.subarray(0, len));\n  Atomics.store(ctrl, 0, done);\n  Atomics.notify(ctrl, 0);\n}\n\nfunction doRequest(url, redirectCount) {\n  if (redirectCount > 5) { finish(3, 0, 'Too many redirects'); return; }\n  let urlObj;\n  try { urlObj = new URL(url); } catch(e) { finish(3, 0, 'Invalid URL: ' + String(e)); return; }\n  const mod = urlObj.protocol === 'https:' ? https : http;\n  const port = urlObj.port ? parseInt(urlObj.port, 10) : (urlObj.protocol === 'https:' ? 443 : 80);\n  const reqOpts = {\n    hostname: urlObj.hostname,\n    port,\n    path: (urlObj.pathname || '/') + (urlObj.search || ''),\n    method: method || 'GET',\n    headers: headers || {},\n    timeout: timeoutMs || 10000,\n  };\n  const req = mod.request(reqOpts, function(res) {\n    if (followRedirects && [301, 302, 303, 307, 308].indexOf(res.statusCode) !== -1 && res.headers.location) {\n      res.resume();\n      let redirectUrl;\n      try { redirectUrl = new URL(res.headers.location, url).href; }\n      catch(e) { finish(3, 0, 'Invalid redirect URL'); return; }\n      doRequest(redirectUrl, redirectCount + 1);\n      return;\n    }\n    let chunks = [];\n    res.on('data', function(chunk) { chunks.push(Buffer.from(chunk)); });\n    res.on('end', function() {\n      const data = Buffer.concat(chunks);\n      const done = (res.statusCode >= 200 && res.statusCode < 300) ? 1 : 2;\n      finish(done, res.statusCode, data.toString('utf8'));\n    });\n  });\n  req.on('error', function(e) { finish(3, 0, e.message); });\n  req.on('timeout', function() { req.destroy(); finish(4, 0, 'Request timed out'); });\n  if (body !== undefined && body !== null) { req.write(body); }\n  req.end();\n}\ndoRequest(initialUrl, 0);\n";
export declare const _SSE_WORKER_CODE = "\nconst { workerData } = require('worker_threads');\nconst https = require('https');\nconst http = require('http');\nconst {\n  sab, url, reqHeaders,\n  tokenOffset, errorOffset, maxToken, maxError,\n} = workerData;\n\nconst ctrl = new Int32Array(sab, 0, 1);\nconst meta = new DataView(sab);\nconst STATUS_IDLE = 0, STATUS_TOKEN = 1, STATUS_DONE = 2, STATUS_ERROR = 3;\n\nfunction putToken(token) {\n  if (!token) return;\n  Atomics.wait(ctrl, 0, STATUS_TOKEN);\n  const encoded = Buffer.from(token, 'utf8');\n  const len = Math.min(encoded.length, maxToken);\n  meta.setInt32(4, len, true);\n  new Uint8Array(sab, tokenOffset, len).set(encoded.subarray(0, len));\n  Atomics.store(ctrl, 0, STATUS_TOKEN);\n  Atomics.notify(ctrl, 0, 1);\n}\n\nfunction putError(msg) {\n  let safety = 0;\n  while (Atomics.load(ctrl, 0) === STATUS_TOKEN && safety++ < 200) {\n    Atomics.wait(ctrl, 0, STATUS_TOKEN, 50);\n  }\n  const encoded = Buffer.from(String(msg).slice(0, maxError), 'utf8');\n  meta.setInt32(8, encoded.length, true);\n  new Uint8Array(sab, errorOffset, encoded.length).set(encoded);\n  Atomics.store(ctrl, 0, STATUS_ERROR);\n  Atomics.notify(ctrl, 0, 1);\n}\n\nfunction putDone() {\n  let safety = 0;\n  while (Atomics.load(ctrl, 0) === STATUS_TOKEN && safety++ < 200) {\n    Atomics.wait(ctrl, 0, STATUS_TOKEN, 50);\n  }\n  Atomics.store(ctrl, 0, STATUS_DONE);\n  Atomics.notify(ctrl, 0, 1);\n}\n\nlet urlObj;\ntry { urlObj = new URL(url); } catch(e) { putError('Invalid URL: ' + url); }\nconst mod = urlObj.protocol === 'https:' ? https : http;\nconst reqOpts = {\n  hostname: urlObj.hostname,\n  port: urlObj.port ? parseInt(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 80),\n  path: (urlObj.pathname || '/') + (urlObj.search || ''),\n  method: 'GET',\n  headers: Object.assign({ 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' }, reqHeaders || {}),\n  timeout: 300000,\n};\nconst req = mod.request(reqOpts, function(res) {\n  if (res.statusCode < 200 || res.statusCode >= 300) {\n    let errBody = '';\n    res.on('data', function(c) { errBody += c.toString('utf8'); });\n    res.on('end', function() { putError('HTTP ' + res.statusCode + ': ' + errBody.slice(0, 200)); });\n    return;\n  }\n  let remainder = '';\n  res.on('data', function(chunk) {\n    const text = remainder + chunk.toString('utf8');\n    const lines = text.split('\\n');\n    remainder = lines.pop() || '';\n    for (const line of lines) {\n      const trimmed = line.trim();\n      if (!trimmed || trimmed.startsWith(':')) continue;\n      if (trimmed.startsWith('data:')) {\n        const data = trimmed.slice(5).trim();\n        if (data === '[DONE]') { putDone(); return; }\n        if (data) putToken(data);\n      }\n    }\n  });\n  res.on('end', function() {\n    if (remainder.trim().startsWith('data:')) {\n      const data = remainder.trim().slice(5).trim();\n      if (data && data !== '[DONE]') putToken(data);\n    }\n    putDone();\n  });\n});\nreq.on('error', function(e) { putError(e.message); });\nreq.end();\n";
export interface SyncHttpResponse {
    ok: boolean;
    status: number;
    body: string;
}
export declare function syncHttpRequest(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    followRedirects?: boolean;
}): SyncHttpResponse;
export declare const STREAM_MAX_TOKEN = 4096;
export declare const STREAM_MAX_ERROR = 1024;
export declare const STREAM_TOKEN_OFFSET = 12;
export declare const STREAM_ERROR_OFFSET: number;
export declare const STREAM_SAB_SIZE: number;
export interface StreamSession {
    sab: SharedArrayBuffer;
    ctrl: Int32Array;
    worker: Worker;
    lastError?: string;
}
export declare function createNetworkRuntime(h: SharedHelpers): {
    http_request(methodPtr: number, urlPtr: number, headersJsonPtr: number, bodyPtr: number): number;
    http_request_full(methodPtr: number, urlPtr: number, headersJsonPtr: number, bodyPtr: number): number;
    http_get(urlPtr: number): number;
    http_post(urlPtr: number, bodyPtr: number): number;
    sse_connect(urlPtr: number, headersPtr: number): number;
    sse_next_event(handleN: bigint): number;
    sse_close(handleN: bigint): void;
    sse_next_event_timeout(handleN: bigint, timeoutN: bigint): number;
};
