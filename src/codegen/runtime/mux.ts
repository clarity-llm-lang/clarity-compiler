// Mux builtins: multi-stream SSE fan-in.

import { Worker } from "node:worker_threads";
import type { SharedHelpers } from "./types.js";

const MUX_MAX_EVENT = 65536;
const MUX_SAB_SIZE = 8 + MUX_MAX_EVENT;

export const _MUX_WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const https = require('https');
const http = require('http');
const { muxSab } = workerData;
const muxCtrl = new Int32Array(muxSab, 0, 1);
const muxMeta = new DataView(muxSab);
const MUX_MAX = muxSab.byteLength - 8;

var streams = new Map();
var eventQueue = [];
var muxSabBusy = false;

function tryFlushMuxQueue() {
  if (muxSabBusy || eventQueue.length === 0) return;
  var evtJson = eventQueue.shift();
  var encoded = Buffer.from(evtJson, 'utf8');
  var len = Math.min(encoded.length, MUX_MAX);
  muxMeta.setInt32(4, len, true);
  new Uint8Array(muxSab, 8, len).set(encoded.subarray(0, len));
  muxSabBusy = true;
  Atomics.store(muxCtrl, 0, 1);
  Atomics.notify(muxCtrl, 0, 1);
}

function connectStream(streamId, url, headers) {
  var urlObj;
  try { urlObj = new URL(url); } catch(e) { return; }
  var mod = urlObj.protocol === 'https:' ? https : http;
  var port = urlObj.port ? parseInt(urlObj.port, 10) : (urlObj.protocol === 'https:' ? 443 : 80);
  var reqOpts = {
    hostname: urlObj.hostname, port: port,
    path: (urlObj.pathname || '/') + (urlObj.search || ''),
    method: 'GET', headers: headers || {},
  };
  var req = mod.request(reqOpts, function(res) {
    var buf = '';
    res.on('data', function(chunk) {
      buf += chunk.toString('utf8');
      var lines = buf.split('\\n');
      buf = lines.pop() || '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.startsWith('data: ')) {
          var data = line.slice(6);
          eventQueue.push(JSON.stringify({ id: streamId, event: data }));
          tryFlushMuxQueue();
        }
      }
    });
    res.on('end', function() {
      streams.delete(streamId);
      eventQueue.push(JSON.stringify({ id: streamId, event: null, ended: true }));
      tryFlushMuxQueue();
    });
    res.on('error', function(e) {
      streams.delete(streamId);
      eventQueue.push(JSON.stringify({ id: streamId, event: null, error: e.message }));
      tryFlushMuxQueue();
    });
  });
  req.on('error', function(e) {
    streams.delete(streamId);
    eventQueue.push(JSON.stringify({ id: streamId, event: null, error: e.message }));
    tryFlushMuxQueue();
  });
  req.end();
  streams.set(streamId, { req: req, destroyed: false });
}

parentPort.on('message', function(msg) {
  if (msg.type === 'ack') {
    muxSabBusy = false;
    Atomics.store(muxCtrl, 0, 0);
    tryFlushMuxQueue();
  } else if (msg.type === 'add') {
    var headers = {};
    try { if (msg.headers && msg.headers !== '{}' && msg.headers !== '') headers = JSON.parse(msg.headers); } catch(e) {}
    connectStream(msg.stream_id, msg.url, headers);
  } else if (msg.type === 'remove') {
    var s = streams.get(msg.stream_id);
    if (s && !s.destroyed) { s.destroyed = true; s.req.destroy(); streams.delete(msg.stream_id); }
  } else if (msg.type === 'close') {
    for (var entry of streams.entries()) { var s2 = entry[1]; if (!s2.destroyed) { s2.destroyed = true; s2.req.destroy(); } }
    streams.clear();
    process.exit(0);
  }
});
`;

interface MuxSession {
  worker: Worker;
  muxSab: SharedArrayBuffer;
  muxCtrl: Int32Array;
}

export function createMuxRuntime(h: SharedHelpers) {
  const muxTable = new Map<number, MuxSession>();
  let nextMuxHandle = 1;

  return {
    mux_open(): bigint {
      const muxSab = new SharedArrayBuffer(MUX_SAB_SIZE);
      const worker = new Worker(_MUX_WORKER_CODE, {
        eval: true,
        workerData: { muxSab },
      });
      worker.on("error", (_err) => {
        for (const [h2, s] of muxTable) {
          if (s.worker === worker) { muxTable.delete(h2); break; }
        }
      });
      const handle = nextMuxHandle++;
      muxTable.set(handle, { worker, muxSab, muxCtrl: new Int32Array(muxSab, 0, 1) });
      return BigInt(handle);
    },

    mux_add(handleN: bigint, streamIdPtr: number, urlPtr: number, headersPtr: number): void {
      const handle = Number(handleN);
      const session = muxTable.get(handle);
      if (!session) return;
      const streamId = h.readString(streamIdPtr);
      const url = h.readString(urlPtr);
      const headers = h.readString(headersPtr);
      const urlErr = h.policyCheckUrl(url);
      if (urlErr) return;
      const effectErr = h.policyCheckEffect("Network");
      if (effectErr) return;
      session.worker.postMessage({ type: "add", stream_id: streamId, url, headers });
    },

    mux_next(handleN: bigint, timeoutN: bigint): number {
      const handle = Number(handleN);
      const session = muxTable.get(handle);
      if (!session) return h.allocOptionI32(null);
      const { muxCtrl, muxSab, worker } = session;
      Atomics.wait(muxCtrl, 0, 0, Number(timeoutN));
      const state = Atomics.load(muxCtrl, 0);
      if (state !== 1) return h.allocOptionI32(null);
      const muxMeta = new DataView(muxSab);
      const evtLen = muxMeta.getInt32(4, true);
      const evtBytes = new Uint8Array(muxSab, 8, evtLen);
      const evtJson = Buffer.from(evtBytes).toString("utf-8");
      Atomics.store(muxCtrl, 0, 0);
      worker.postMessage({ type: "ack" });
      return h.allocOptionI32(h.writeString(evtJson));
    },

    mux_remove(handleN: bigint, streamIdPtr: number): void {
      const handle = Number(handleN);
      const session = muxTable.get(handle);
      if (!session) return;
      const streamId = h.readString(streamIdPtr);
      session.worker.postMessage({ type: "remove", stream_id: streamId });
    },

    mux_close(handleN: bigint): void {
      const handle = Number(handleN);
      const session = muxTable.get(handle);
      if (!session) return;
      session.worker.postMessage({ type: "close" });
      muxTable.delete(handle);
    },
  };
}
