// LLM builtins: call_model, stream_*, embed_*, list_models, eval_*.

import { Worker } from "node:worker_threads";
import { syncHttpRequest, STREAM_MAX_TOKEN, STREAM_MAX_ERROR, STREAM_TOKEN_OFFSET, STREAM_ERROR_OFFSET, STREAM_SAB_SIZE } from "./network.js";
import type { SharedHelpers } from "./types.js";

export const _STREAM_WORKER_CODE = `
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

function parseSSELine(line) {
  if (!line.startsWith('data:')) return '';
  const data = line.slice(5).trim();
  if (data === '[DONE]') return '';
  try {
    const obj = JSON.parse(data);
    if (isAnthropic) {
      return (obj.delta && obj.delta.text) ? obj.delta.text : '';
    } else {
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

interface StreamSession {
  sab: SharedArrayBuffer;
  ctrl: Int32Array;
  worker: Worker;
  lastError?: string;
}

function callAnthropic(
  model: string,
  messages: Array<{ role: string; content: string }>,
  h: SharedHelpers,
): number {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  const urlErr = h.policyCheckUrl(`${baseUrl}/v1/messages`);
  if (urlErr) return h.allocResultString(false, h.writeString(urlErr));
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
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body,
      timeoutMs: 120000,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
    const parsed = JSON.parse(resp.body) as { content?: Array<{ type: string; text?: string }> };
    const content = parsed.content?.find((c) => c.type === "text")?.text ?? "";
    return h.allocResultString(true, h.writeString(content));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return h.allocResultString(false, h.writeString(msg));
  }
}

function callOpenAI(body: string, h: SharedHelpers): number {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  try {
    const resp = syncHttpRequest({
      url: `${baseUrl}/v1/chat/completions`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body,
      timeoutMs: 120000,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
    const parsed = JSON.parse(resp.body) as { choices?: Array<{ message?: { content?: string } }> };
    const content = parsed.choices?.[0]?.message?.content ?? "";
    return h.allocResultString(true, h.writeString(content));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return h.allocResultString(false, h.writeString(msg));
  }
}

function callLLM(
  model: string,
  messages: Array<{ role: string; content: string }>,
  h: SharedHelpers,
): number {
  if (model.startsWith("claude-")) return callAnthropic(model, messages, h);
  const body = JSON.stringify({ model, messages, max_tokens: 4096 });
  return callOpenAI(body, h);
}

export function createLlmRuntime(h: SharedHelpers) {
  const streamSessions = new Map<number, StreamSession>();
  let nextStreamHandle = 1;

  return {
    call_model(modelPtr: number, promptPtr: number): number {
      const model = h.readString(modelPtr);
      const prompt = h.readString(promptPtr);
      const effectErr = h.policyCheckEffect("Model");
      if (effectErr) { h.policyAuditLog({ effect: "Model", op: "call_model", model, result: "denied", reason: effectErr }); return h.allocResultString(false, h.writeString(effectErr)); }
      const t0 = Date.now();
      const result = callLLM(model, [{ role: "user", content: prompt }], h);
      h.policyAuditLog({ effect: "Model", op: "call_model", model, result: "ok", duration_ms: Date.now() - t0 });
      return result;
    },

    call_model_system(modelPtr: number, systemPtr: number, promptPtr: number): number {
      const model = h.readString(modelPtr);
      const system = h.readString(systemPtr);
      const prompt = h.readString(promptPtr);
      const effectErr = h.policyCheckEffect("Model");
      if (effectErr) { h.policyAuditLog({ effect: "Model", op: "call_model_system", model, result: "denied", reason: effectErr }); return h.allocResultString(false, h.writeString(effectErr)); }
      const t0 = Date.now();
      const result = callLLM(model, [{ role: "system", content: system }, { role: "user", content: prompt }], h);
      h.policyAuditLog({ effect: "Model", op: "call_model_system", model, result: "ok", duration_ms: Date.now() - t0 });
      return result;
    },

    list_models(): number {
      const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
      const apiKey = process.env.OPENAI_API_KEY ?? "";
      try {
        const resp = syncHttpRequest({ url: `${baseUrl}/v1/models`, headers: { "Authorization": `Bearer ${apiKey}` }, timeoutMs: 10000 });
        const parsed = JSON.parse(resp.body) as { data?: Array<{ id: string }> };
        const ids = (parsed.data ?? []).map((m) => m.id);
        return h.allocListI32(ids.map((id) => h.writeString(id)));
      } catch {
        return h.allocListI32([]);
      }
    },

    stream_start(modelPtr: number, promptPtr: number, systemPtr: number): number {
      const model = h.readString(modelPtr);
      const prompt = h.readString(promptPtr);
      const system = h.readString(systemPtr);
      const effectErr = h.policyCheckEffect("Model");
      if (effectErr) return h.allocResultI64(false, 0n, h.writeString(effectErr));
      try {
        const sab = new SharedArrayBuffer(STREAM_SAB_SIZE);
        const isAnthropic = model.startsWith("claude-");
        let url: string, reqHeaders: Record<string, string>, body: string;
        if (isAnthropic) {
          const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
          const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
          const urlErr = h.policyCheckUrl(`${baseUrl}/v1/messages`);
          if (urlErr) return h.allocResultI64(false, 0n, h.writeString(urlErr));
          url = `${baseUrl}/v1/messages`;
          reqHeaders = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
          body = JSON.stringify({ model, max_tokens: 4096, stream: true, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] });
        } else {
          const apiKey = process.env.OPENAI_API_KEY ?? "";
          const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
          const urlErr = h.policyCheckUrl(`${baseUrl}/v1/chat/completions`);
          if (urlErr) return h.allocResultI64(false, 0n, h.writeString(urlErr));
          url = `${baseUrl}/v1/chat/completions`;
          reqHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
          const messages = system ? [{ role: "system", content: system }, { role: "user", content: prompt }] : [{ role: "user", content: prompt }];
          body = JSON.stringify({ model, max_tokens: 4096, stream: true, messages });
        }
        const worker = new Worker(_STREAM_WORKER_CODE, {
          eval: true,
          workerData: { sab, url, method: "POST", reqHeaders, body, isAnthropic, tokenOffset: STREAM_TOKEN_OFFSET, errorOffset: STREAM_ERROR_OFFSET, maxToken: STREAM_MAX_TOKEN, maxError: STREAM_MAX_ERROR },
        });
        const handle = nextStreamHandle++;
        streamSessions.set(handle, { sab, ctrl: new Int32Array(sab, 0, 1), worker });
        return h.allocResultI64(true, BigInt(handle));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultI64(false, 0n, h.writeString(msg));
      }
    },

    stream_next(handleN: bigint): number {
      const handle = Number(handleN);
      const session = streamSessions.get(handle);
      if (!session) return h.allocOptionI32(null);
      const { ctrl, sab } = session;
      Atomics.wait(ctrl, 0, 0, 120000);
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
      const token = Buffer.from(tokenBytes).toString("utf-8");
      Atomics.store(ctrl, 0, 0);
      Atomics.notify(ctrl, 0, 1);
      return h.allocOptionI32(h.writeString(token));
    },

    stream_close(handleN: bigint): number {
      const handle = Number(handleN);
      const session = streamSessions.get(handle);
      if (!session) return h.writeString("");
      session.worker.terminate();
      streamSessions.delete(handle);
      return h.writeString(session.lastError ?? "");
    },

    embed_text(textPtr: number): number {
      const text = h.readString(textPtr);
      const effectErr = h.policyCheckEffect("Embed");
      if (effectErr) return h.allocResultString(false, h.writeString(effectErr));
      const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
      const apiKey = process.env.OPENAI_API_KEY ?? "";
      const model = process.env.CLARITY_EMBED_MODEL ?? "text-embedding-ada-002";
      try {
        const resp = syncHttpRequest({ url: `${baseUrl}/v1/embeddings`, method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ input: text, model }), timeoutMs: 30000 });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
        const parsed = JSON.parse(resp.body) as { data?: Array<{ embedding: number[] }> };
        const embedding = parsed.data?.[0]?.embedding ?? [];
        return h.allocResultString(true, h.writeString(JSON.stringify(embedding)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    cosine_similarity(aPtr: number, bPtr: number): number {
      try {
        const a = JSON.parse(h.readString(aPtr)) as number[];
        const b = JSON.parse(h.readString(bPtr)) as number[];
        if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
        let dot = 0, nA = 0, nB = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
        const denom = Math.sqrt(nA) * Math.sqrt(nB);
        return denom === 0 ? 0 : dot / denom;
      } catch { return 0; }
    },

    chunk_text(textPtr: number, sizeN: bigint): number {
      const text = h.readString(textPtr);
      const size = Math.max(1, Number(sizeN));
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      return h.writeString(JSON.stringify(chunks));
    },

    embed_and_retrieve(queryPtr: number, chunksJsonPtr: number, topKN: bigint): number {
      const query = h.readString(queryPtr);
      const chunksJson = h.readString(chunksJsonPtr);
      const topK = Math.max(1, Number(topKN));
      const effectErr = h.policyCheckEffect("Embed");
      if (effectErr) return h.allocResultString(false, h.writeString(effectErr));
      try {
        const chunks = JSON.parse(chunksJson) as string[];
        if (!Array.isArray(chunks) || chunks.length === 0) return h.allocResultString(true, h.writeString("[]"));
        const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
        const apiKey = process.env.OPENAI_API_KEY ?? "";
        const model = process.env.CLARITY_EMBED_MODEL ?? "text-embedding-ada-002";
        const inputs = [query, ...chunks];
        const resp = syncHttpRequest({ url: `${baseUrl}/v1/embeddings`, method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ input: inputs, model }), timeoutMs: 60000 });
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
        return h.allocResultString(true, h.writeString(JSON.stringify(topChunks)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },

    // Eval builtins
    eval_exact(gotPtr: number, expectedPtr: number): number {
      return h.readString(gotPtr) === h.readString(expectedPtr) ? 1 : 0;
    },

    eval_contains(gotPtr: number, expectedPtr: number): number {
      return h.readString(gotPtr).includes(h.readString(expectedPtr)) ? 1 : 0;
    },

    eval_llm_judge(modelPtr: number, promptPtr: number, responsePtr: number, rubricPtr: number): number {
      const model = h.readString(modelPtr);
      const prompt = h.readString(promptPtr);
      const response = h.readString(responsePtr);
      const rubric = h.readString(rubricPtr);
      const effectErr = h.policyCheckEffect("Eval");
      if (effectErr) return h.allocResultString(false, h.writeString(effectErr));
      const sysContent = "You are an impartial evaluator. Given the original prompt, a response, and a rubric, output ONLY a JSON object with keys: \"score\" (float 0.0-1.0), \"pass\" (boolean, true when score >= 0.7), \"reason\" (one sentence). Do not include any other text.";
      const userMsg = `Prompt: ${prompt}\n\nResponse: ${response}\n\nRubric: ${rubric}`;
      const resultPtr = callLLM(model, [{ role: "system", content: sysContent }, { role: "user", content: userMsg }], h);
      const view = new DataView(h.memory().buffer);
      const tag = view.getInt32(resultPtr, true);
      if (tag !== 0) return resultPtr;
      const textPtr = view.getInt32(resultPtr + 4, true);
      const text = h.readString(textPtr).trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const json = jsonMatch ? jsonMatch[0] : text;
      return h.allocResultString(true, h.writeString(json));
    },

    eval_semantic(gotPtr: number, expectedPtr: number): number {
      const got = h.readString(gotPtr);
      const expected = h.readString(expectedPtr);
      const effectErr = h.policyCheckEffect("Eval");
      if (effectErr) return h.allocResultString(false, h.writeString(effectErr));
      try {
        const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
        const apiKey = process.env.OPENAI_API_KEY ?? "";
        const model = process.env.CLARITY_EMBED_MODEL ?? "text-embedding-ada-002";
        if (!apiKey) return h.allocResultString(false, h.writeString("OPENAI_API_KEY not set"));
        const resp = syncHttpRequest({ url: `${baseUrl}/v1/embeddings`, method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ input: [got, expected], model }), timeoutMs: 30000 });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.body}`);
        const parsed = JSON.parse(resp.body) as { data?: Array<{ embedding: number[]; index: number }> };
        const data = (parsed.data ?? []).sort((a, b) => a.index - b.index);
        if (data.length < 2) throw new Error("Expected 2 embeddings");
        const a = data[0].embedding, b = data[1].embedding;
        let dot = 0, nA = 0, nB = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
        const sim = Math.sqrt(nA) * Math.sqrt(nB) === 0 ? 0 : dot / (Math.sqrt(nA) * Math.sqrt(nB));
        const ptr = h.alloc(16);
        const v2 = new DataView(h.memory().buffer);
        v2.setInt32(ptr, 0, true);
        v2.setFloat64(ptr + 8, sim, true);
        return ptr;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultString(false, h.writeString(msg));
      }
    },
  };
}
