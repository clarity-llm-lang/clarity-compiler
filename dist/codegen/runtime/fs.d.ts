import { Worker } from "node:worker_threads";
import type { RuntimeConfig, SharedHelpers } from "./types.js";
export declare const _FS_WATCH_WORKER_CODE = "\nconst { workerData, parentPort } = require('worker_threads');\nconst fs = require('fs');\nconst { watchSab, path } = workerData;\nconst ctrl = new Int32Array(watchSab, 0, 2);\nconst eventQueue = [];\nlet busy = false;\nfunction flushQueue() {\n  if (busy || eventQueue.length === 0) return;\n  const evt = eventQueue.shift();\n  const encoded = Buffer.from(evt, 'utf8');\n  const evtLen = Math.min(encoded.length, 4096);\n  new Uint8Array(watchSab, 8, evtLen).set(encoded.subarray(0, evtLen));\n  Atomics.store(ctrl, 1, evtLen);\n  Atomics.store(ctrl, 0, 1);\n  Atomics.notify(ctrl, 0, 1);\n  busy = true;\n}\nvar watcher;\ntry {\n  watcher = fs.watch(path, { recursive: true }, function(event, filename) {\n    var evt = JSON.stringify({ event: event, filename: filename || '' });\n    eventQueue.push(evt);\n    flushQueue();\n  });\n  watcher.on('error', function(err) {\n    parentPort.postMessage({ type: 'error', message: err.message });\n  });\n} catch (e) {\n  parentPort.postMessage({ type: 'error', message: e.message });\n}\nparentPort.on('message', function(msg) {\n  if (msg.type === 'ack') {\n    busy = false;\n    flushQueue();\n  } else if (msg.type === 'close') {\n    if (watcher) { try { watcher.close(); } catch (_) {} }\n    process.exit(0);\n  }\n});\n";
export declare function createFsRuntime(h: SharedHelpers, config: RuntimeConfig, stdinBufferRef: {
    value: string;
}, stdinReaderRef: {
    sab: SharedArrayBuffer | null;
    ctrl: Int32Array | null;
    worker: Worker | null;
}): {
    read_line(): number;
    read_all_stdin(): number;
    read_file(pathPtr: number): number;
    write_file(pathPtr: number, contentPtr: number): void;
    get_args(): number;
    exit(code: bigint): void;
    list_dir(pathPtr: number): number;
    file_exists(pathPtr: number): number;
    remove_file(pathPtr: number): void;
    make_dir(pathPtr: number): void;
    fs_watch_start(pathPtr: number): number;
    fs_watch_next(handleN: bigint, timeoutN: bigint): number;
    fs_watch_stop(handleN: bigint): void;
    stdin_try_read(timeoutN: bigint): number;
};
