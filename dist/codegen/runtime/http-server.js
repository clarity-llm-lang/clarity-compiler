// HTTP server builtins: http_listen, http_next_request, http_respond, SSE server, http_close_server.
import { Worker } from "node:worker_threads";
const HTTP_SERVER_MAX_REQ = 8 * 1024 * 1024; // 8 MB
const HTTP_SERVER_SAB_SIZE = 8 + HTTP_SERVER_MAX_REQ;
const HTTP_SERVER_STARTUP_SAB_SIZE = 128;
export const _HTTP_SERVER_WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const http = require('http');
const { reqSab, startupSab, port } = workerData;
const reqCtrl = new Int32Array(reqSab, 0, 1);
const reqMeta = new DataView(reqSab);
const startupCtrl = new Int32Array(startupSab, 0, 1);
const startupMeta = new DataView(startupSab);
const REQ_MAX = reqSab.byteLength - 8;

var pendingRequests = new Map();
var nextId = 1;
var requestQueue = [];
var reqSabBusy = false;

function tryFlushQueue() {
  if (reqSabBusy || requestQueue.length === 0) return;
  var entry = requestQueue.shift();
  var json = JSON.stringify(entry);
  var encoded = Buffer.from(json, 'utf8');
  var len = Math.min(encoded.length, REQ_MAX);
  reqMeta.setInt32(4, len, true);
  new Uint8Array(reqSab, 8, len).set(encoded.subarray(0, len));
  reqSabBusy = true;
  Atomics.store(reqCtrl, 0, 1);
  Atomics.notify(reqCtrl, 0, 1);
}

var server = http.createServer(function(req, res) {
  var chunks = [];
  req.on('data', function(chunk) { chunks.push(Buffer.from(chunk)); });
  req.on('end', function() {
    var id = nextId++;
    var url = req.url || '/';
    var qIdx = url.indexOf('?');
    var path = qIdx === -1 ? url : url.slice(0, qIdx);
    var query = qIdx === -1 ? '' : url.slice(qIdx);
    var hdrs = {};
    var rawHdrs = req.headers;
    for (var k in rawHdrs) { if (Object.prototype.hasOwnProperty.call(rawHdrs, k)) hdrs[k] = String(rawHdrs[k]); }
    var body = Buffer.concat(chunks).toString('utf8');
    pendingRequests.set(id, { res: res, sseMode: false });
    requestQueue.push({ id: id, method: req.method || 'GET', path: path, query: query, headers: hdrs, body: body });
    tryFlushQueue();
  });
});

parentPort.on('message', function(msg) {
  if (msg.type === 'ack') {
    reqSabBusy = false;
    Atomics.store(reqCtrl, 0, 0);
    tryFlushQueue();
  } else if (msg.type === 'respond') {
    var pr = pendingRequests.get(msg.id);
    if (!pr || pr.sseMode) return;
    pendingRequests.delete(msg.id);
    pr.res.writeHead(msg.status || 200, msg.headers || {});
    pr.res.end(msg.body || '');
  } else if (msg.type === 'sse_start') {
    var pr2 = pendingRequests.get(msg.id);
    if (!pr2) return;
    pr2.sseMode = true;
    var sseHdrs = Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }, msg.headers || {});
    pr2.res.writeHead(200, sseHdrs);
    if (pr2.res.flushHeaders) pr2.res.flushHeaders();
  } else if (msg.type === 'sse_event') {
    var pr3 = pendingRequests.get(msg.id);
    if (!pr3 || !pr3.sseMode) return;
    pr3.res.write('data: ' + (msg.data || '') + '\\n\\n');
  } else if (msg.type === 'sse_close') {
    var pr4 = pendingRequests.get(msg.id);
    if (!pr4) return;
    pendingRequests.delete(msg.id);
    pr4.res.end();
  } else if (msg.type === 'close') {
    server.close();
    process.exit(0);
  }
});

server.on('error', function(err) {
  var encoded = Buffer.from(err.message, 'utf8');
  var len = Math.min(encoded.length, startupSab.byteLength - 8);
  startupMeta.setInt32(4, len, true);
  new Uint8Array(startupSab, 8, len).set(encoded.subarray(0, len));
  Atomics.store(startupCtrl, 0, 2);
  Atomics.notify(startupCtrl, 0, 1);
});

server.listen(port, function() {
  Atomics.store(startupCtrl, 0, 1);
  Atomics.notify(startupCtrl, 0, 1);
});
`;
export function createHttpServerRuntime(h) {
    const httpServerTable = new Map();
    let nextHttpServerHandle = 1;
    const httpRequestServerMap = new Map();
    return {
        http_listen(portN) {
            const port = Number(portN);
            const effectErr = h.policyCheckEffect("Network");
            if (effectErr)
                return h.allocResultI64(false, 0n, h.writeString(effectErr));
            try {
                const reqSab = new SharedArrayBuffer(HTTP_SERVER_SAB_SIZE);
                const startupSab = new SharedArrayBuffer(HTTP_SERVER_STARTUP_SAB_SIZE);
                const startupCtrl = new Int32Array(startupSab, 0, 1);
                const worker = new Worker(_HTTP_SERVER_WORKER_CODE, {
                    eval: true,
                    workerData: { reqSab, startupSab, port },
                });
                worker.on("error", (_err) => {
                    for (const [handle, s] of httpServerTable) {
                        if (s.worker === worker) {
                            httpServerTable.delete(handle);
                            break;
                        }
                    }
                });
                Atomics.wait(startupCtrl, 0, 0);
                const startupState = Atomics.load(startupCtrl, 0);
                if (startupState === 2) {
                    const startupMeta = new DataView(startupSab);
                    const errLen = startupMeta.getInt32(4, true);
                    const errBytes = new Uint8Array(startupSab, 8, errLen);
                    const errMsg = Buffer.from(errBytes).toString("utf-8");
                    worker.terminate();
                    return h.allocResultI64(false, 0n, h.writeString(errMsg));
                }
                const handle = nextHttpServerHandle++;
                httpServerTable.set(handle, { worker, reqSab, reqCtrl: new Int32Array(reqSab, 0, 1) });
                h.policyAuditLog({ effect: "Network", op: "http_listen", port, handle });
                return h.allocResultI64(true, BigInt(handle));
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return h.allocResultI64(false, 0n, h.writeString(msg));
            }
        },
        http_next_request(handleN) {
            const handle = Number(handleN);
            const session = httpServerTable.get(handle);
            if (!session)
                return h.allocResultString(false, h.writeString(`Unknown http server handle: ${handle}`));
            const { reqCtrl, reqSab, worker } = session;
            Atomics.wait(reqCtrl, 0, 0);
            const state = Atomics.load(reqCtrl, 0);
            if (state !== 1)
                return h.allocResultString(false, h.writeString("http_next_request: unexpected SAB state"));
            const reqMeta = new DataView(reqSab);
            const jsonLen = reqMeta.getInt32(4, true);
            const jsonBytes = new Uint8Array(reqSab, 8, jsonLen);
            const requestJson = Buffer.from(jsonBytes).toString("utf-8");
            Atomics.store(reqCtrl, 0, 0);
            worker.postMessage({ type: "ack" });
            try {
                const parsed = JSON.parse(requestJson);
                if (parsed && typeof parsed.id === "number") {
                    httpRequestServerMap.set(BigInt(parsed.id), handle);
                }
            }
            catch { /* ignore */ }
            return h.allocResultString(true, h.writeString(requestJson));
        },
        http_respond(requestIdN, statusN, headersPtr, bodyPtr) {
            const requestId = requestIdN;
            const status = Number(statusN);
            const headersJson = h.readString(headersPtr);
            const body = h.readString(bodyPtr);
            const serverHandle = httpRequestServerMap.get(requestId);
            if (serverHandle === undefined)
                return;
            httpRequestServerMap.delete(requestId);
            const session = httpServerTable.get(serverHandle);
            if (!session)
                return;
            let headers = {};
            try {
                if (headersJson.trim() !== "" && headersJson.trim() !== "{}") {
                    const parsed = JSON.parse(headersJson);
                    for (const [k, v] of Object.entries(parsed))
                        headers[k] = String(v);
                }
            }
            catch { /* ignore */ }
            session.worker.postMessage({ type: "respond", id: Number(requestId), status, headers, body });
        },
        http_close_server(handleN) {
            const handle = Number(handleN);
            const session = httpServerTable.get(handle);
            if (!session)
                return;
            session.worker.postMessage({ type: "close" });
            httpServerTable.delete(handle);
        },
        http_start_sse(requestIdN, headersPtr) {
            const requestId = requestIdN;
            const headersJson = h.readString(headersPtr);
            const serverHandle = httpRequestServerMap.get(requestId);
            if (serverHandle === undefined)
                return;
            const session = httpServerTable.get(serverHandle);
            if (!session)
                return;
            let headers = {};
            try {
                if (headersJson.trim() !== "" && headersJson.trim() !== "{}") {
                    const parsed = JSON.parse(headersJson);
                    for (const [k, v] of Object.entries(parsed))
                        headers[k] = String(v);
                }
            }
            catch { /* ignore */ }
            session.worker.postMessage({ type: "sse_start", id: Number(requestId), headers });
        },
        http_send_sse_event(requestIdN, dataPtr) {
            const requestId = requestIdN;
            const data = h.readString(dataPtr);
            const serverHandle = httpRequestServerMap.get(requestId);
            if (serverHandle === undefined)
                return;
            const session = httpServerTable.get(serverHandle);
            if (!session)
                return;
            session.worker.postMessage({ type: "sse_event", id: Number(requestId), data });
        },
        http_close_sse(requestIdN) {
            const requestId = requestIdN;
            const serverHandle = httpRequestServerMap.get(requestId);
            if (serverHandle === undefined)
                return;
            httpRequestServerMap.delete(requestId);
            const session = httpServerTable.get(serverHandle);
            if (!session)
                return;
            session.worker.postMessage({ type: "sse_close", id: Number(requestId) });
        },
    };
}
//# sourceMappingURL=http-server.js.map