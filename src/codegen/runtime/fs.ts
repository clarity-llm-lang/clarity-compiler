// FileSystem builtins: file I/O, stdin/stdout, args, process control, fs_watch.

import * as nodeFs from "node:fs";
import { Worker } from "node:worker_threads";
import type { RuntimeConfig, SharedHelpers } from "./types.js";

// SAB layout for stdin reader worker
const STDIN_SAB_LINE_OFFSET = 8;
const STDIN_SAB_MAX_LINE = 65536;
const STDIN_SAB_SIZE = STDIN_SAB_LINE_OFFSET + STDIN_SAB_MAX_LINE;

const _STDIN_READER_WORKER_CODE = `
const { workerData } = require('worker_threads');
const fs = require('fs');
const { sab } = workerData;
const ctrl = new Int32Array(sab, 0, 1);
const meta = new DataView(sab);
const LINE_OFFSET = 8, MAX_LINE = 65536;
const STATUS_IDLE = 0, STATUS_LINE = 1, STATUS_EOF = 2, STATUS_ERROR = 3;

function readNext() {
  const buf = Buffer.alloc(MAX_LINE);
  let bytesRead;
  try {
    bytesRead = fs.readSync(0, buf, 0, buf.length, null);
  } catch(e) {
    meta.setInt32(4, 0, true);
    Atomics.store(ctrl, 0, STATUS_ERROR);
    Atomics.notify(ctrl, 0, 1);
    return;
  }
  if (bytesRead === 0) {
    Atomics.store(ctrl, 0, STATUS_EOF);
    Atomics.notify(ctrl, 0, 1);
    return;
  }
  let end = bytesRead;
  if (end > 0 && buf[end - 1] === 10) end--;
  if (end > 0 && buf[end - 1] === 13) end--;
  meta.setInt32(4, end, true);
  new Uint8Array(sab, LINE_OFFSET, end).set(buf.subarray(0, end));
  Atomics.store(ctrl, 0, STATUS_LINE);
  Atomics.notify(ctrl, 0, 1);
  Atomics.wait(ctrl, 0, STATUS_LINE);
  readNext();
}

readNext();
`;

export const _FS_WATCH_WORKER_CODE = `
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const { watchSab, path } = workerData;
const ctrl = new Int32Array(watchSab, 0, 2);
const eventQueue = [];
let busy = false;
function flushQueue() {
  if (busy || eventQueue.length === 0) return;
  const evt = eventQueue.shift();
  const encoded = Buffer.from(evt, 'utf8');
  const evtLen = Math.min(encoded.length, 4096);
  new Uint8Array(watchSab, 8, evtLen).set(encoded.subarray(0, evtLen));
  Atomics.store(ctrl, 1, evtLen);
  Atomics.store(ctrl, 0, 1);
  Atomics.notify(ctrl, 0, 1);
  busy = true;
}
var watcher;
try {
  watcher = fs.watch(path, { recursive: true }, function(event, filename) {
    var evt = JSON.stringify({ event: event, filename: filename || '' });
    eventQueue.push(evt);
    flushQueue();
  });
  watcher.on('error', function(err) {
    parentPort.postMessage({ type: 'error', message: err.message });
  });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
}
parentPort.on('message', function(msg) {
  if (msg.type === 'ack') {
    busy = false;
    flushQueue();
  } else if (msg.type === 'close') {
    if (watcher) { try { watcher.close(); } catch (_) {} }
    process.exit(0);
  }
});
`;

interface FsWatchSession {
  worker: Worker;
  watchSab: SharedArrayBuffer;
  watchCtrl: Int32Array;
}

export function createFsRuntime(
  h: SharedHelpers,
  config: RuntimeConfig,
  stdinBufferRef: { value: string },
  stdinReaderRef: {
    sab: SharedArrayBuffer | null;
    ctrl: Int32Array | null;
    worker: Worker | null;
  },
) {
  const FS_WATCH_SAB_SIZE = 8 + 4096;
  const fsWatchTable = new Map<number, FsWatchSession>();
  let nextFsWatchHandle = 1;
  let stdinEofLatched = false;  // latched after first EOF from read_line / read_line_or_eof
  let stdinWorkerEofLatched = false; // latched after stdin_try_read sees STATUS_EOF

  function ensureStdinReader(): void {
    if (stdinReaderRef.sab) return;
    stdinReaderRef.sab = new SharedArrayBuffer(STDIN_SAB_SIZE);
    stdinReaderRef.ctrl = new Int32Array(stdinReaderRef.sab, 0, 1);
    stdinReaderRef.worker = new Worker(_STDIN_READER_WORKER_CODE, {
      eval: true,
      workerData: { sab: stdinReaderRef.sab },
    });
    stdinReaderRef.worker.on("error", () => { /* worker errors are signalled via SAB */ });
  }

  return {
    read_line(): number {
      if (config.stdin !== undefined) {
        if (config.stdin === "") {
          stdinEofLatched = true;
          return h.writeString("");
        }
        const newline = config.stdin.indexOf("\n");
        if (newline === -1) {
          const line = config.stdin;
          config.stdin = "";
          // stdin exhausted after this line — next read_line() will latch EOF
          return h.writeString(line);
        }
        const line = config.stdin.substring(0, newline);
        config.stdin = config.stdin.substring(newline + 1);
        return h.writeString(line);
      }
      if (stdinEofLatched) return h.writeString("");
      try {
        const existingNl = stdinBufferRef.value.indexOf("\n");
        if (existingNl !== -1) {
          const line = stdinBufferRef.value.substring(0, existingNl);
          stdinBufferRef.value = stdinBufferRef.value.substring(existingNl + 1);
          return h.writeString(line);
        }
        const buf = Buffer.alloc(4096);
        const bytesRead = nodeFs.readSync(0, buf, 0, buf.length, null);
        if (bytesRead === 0) {
          stdinEofLatched = true;
          const line = stdinBufferRef.value;
          stdinBufferRef.value = "";
          return h.writeString(line);
        }
        stdinBufferRef.value += buf.toString("utf-8", 0, bytesRead);
        const newline = stdinBufferRef.value.indexOf("\n");
        if (newline === -1) {
          const line = stdinBufferRef.value;
          stdinBufferRef.value = "";
          return h.writeString(line);
        }
        const line = stdinBufferRef.value.substring(0, newline);
        stdinBufferRef.value = stdinBufferRef.value.substring(newline + 1);
        return h.writeString(line);
      } catch {
        stdinEofLatched = true;
        return h.writeString("");
      }
    },

    read_line_or_eof(): number {
      if (config.stdin !== undefined) {
        if (config.stdin === "") {
          stdinEofLatched = true;
          return h.allocOptionI32(null);
        }
        const newline = config.stdin.indexOf("\n");
        if (newline === -1) {
          const line = config.stdin;
          config.stdin = "";
          // No more data after this — treat as EOF on next call
          return h.allocOptionI32(h.writeString(line));
        }
        const line = config.stdin.substring(0, newline);
        config.stdin = config.stdin.substring(newline + 1);
        return h.allocOptionI32(h.writeString(line));
      }
      if (stdinEofLatched) return h.allocOptionI32(null);
      try {
        const existingNl = stdinBufferRef.value.indexOf("\n");
        if (existingNl !== -1) {
          const line = stdinBufferRef.value.substring(0, existingNl);
          stdinBufferRef.value = stdinBufferRef.value.substring(existingNl + 1);
          return h.allocOptionI32(h.writeString(line));
        }
        const buf = Buffer.alloc(4096);
        const bytesRead = nodeFs.readSync(0, buf, 0, buf.length, null);
        if (bytesRead === 0) {
          stdinEofLatched = true;
          return h.allocOptionI32(null);
        }
        stdinBufferRef.value += buf.toString("utf-8", 0, bytesRead);
        const newline = stdinBufferRef.value.indexOf("\n");
        if (newline === -1) {
          const line = stdinBufferRef.value;
          stdinBufferRef.value = "";
          // Don't latch EOF yet — there might be more data pending without a trailing newline
          return h.allocOptionI32(h.writeString(line));
        }
        const line = stdinBufferRef.value.substring(0, newline);
        stdinBufferRef.value = stdinBufferRef.value.substring(newline + 1);
        return h.allocOptionI32(h.writeString(line));
      } catch {
        stdinEofLatched = true;
        return h.allocOptionI32(null);
      }
    },

    read_all_stdin(): number {
      if (config.stdin !== undefined) {
        const content = config.stdin;
        config.stdin = "";
        return h.writeString(content);
      }
      try {
        const chunks: Buffer[] = [];
        const buf = Buffer.alloc(4096);
        let bytesRead: number;
        while ((bytesRead = nodeFs.readSync(0, buf, 0, buf.length, null)) > 0) {
          chunks.push(buf.subarray(0, bytesRead));
        }
        return h.writeString(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        return h.writeString("");
      }
    },

    read_file(pathPtr: number): number {
      const path = h.readString(pathPtr);
      try {
        if (config.fs) {
          return h.writeString(config.fs.readFileSync(path, "utf-8"));
        }
        return h.writeString(nodeFs.readFileSync(path, "utf-8"));
      } catch {
        return h.writeString("");
      }
    },

    write_file(pathPtr: number, contentPtr: number): void {
      const path = h.readString(pathPtr);
      const content = h.readString(contentPtr);
      if (config.fs) {
        config.fs.writeFileSync(path, content);
        return;
      }
      nodeFs.writeFileSync(path, content);
    },

    get_args(): number {
      const args = config.argv ?? [];
      const strPtrs = args.map(a => h.writeString(a));
      const listPtr = h.alloc(4 + strPtrs.length * 4);
      const view = new DataView(h.memory().buffer);
      view.setInt32(listPtr, strPtrs.length, true);
      for (let i = 0; i < strPtrs.length; i++) {
        view.setInt32(listPtr + 4 + i * 4, strPtrs[i], true);
      }
      return listPtr;
    },

    exit(code: bigint): void {
      process.exit(Number(code));
    },

    list_dir(pathPtr: number): number {
      const path = h.readString(pathPtr);
      try {
        const entries = nodeFs.readdirSync(path) as string[];
        return h.allocListI32(entries.map((e: string) => h.writeString(e)));
      } catch {
        return h.allocListI32([]);
      }
    },

    file_exists(pathPtr: number): number {
      const path = h.readString(pathPtr);
      try {
        nodeFs.statSync(path);
        return 1;
      } catch {
        return 0;
      }
    },

    remove_file(pathPtr: number): void {
      const path = h.readString(pathPtr);
      try {
        nodeFs.unlinkSync(path);
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== "ENOENT") throw e;
      }
    },

    make_dir(pathPtr: number): void {
      const path = h.readString(pathPtr);
      nodeFs.mkdirSync(path, { recursive: true });
    },

    fs_watch_start(pathPtr: number): number {
      const path = h.readString(pathPtr);
      const watchSab = new SharedArrayBuffer(FS_WATCH_SAB_SIZE);
      const watchCtrl = new Int32Array(watchSab, 0, 2);
      const handle = nextFsWatchHandle++;
      const worker = new Worker(_FS_WATCH_WORKER_CODE, {
        eval: true,
        workerData: { watchSab, path },
      });
      worker.on("message", (msg: { type: string; message?: string }) => {
        if (msg.type === "error") {
          fsWatchTable.delete(handle);
        }
      });
      worker.on("error", (_err: Error) => {
        fsWatchTable.delete(handle);
      });
      fsWatchTable.set(handle, { worker, watchSab, watchCtrl });
      return h.allocResultI64(true, BigInt(handle), 0);
    },

    fs_watch_next(handleN: bigint, timeoutN: bigint): number {
      const handle = Number(handleN);
      const session = fsWatchTable.get(handle);
      if (!session) return h.allocOptionI32(null);
      const { watchCtrl, watchSab } = session;
      Atomics.wait(watchCtrl, 0, 0, Number(timeoutN));
      const state = Atomics.load(watchCtrl, 0);
      if (state !== 1) return h.allocOptionI32(null);
      const meta = new DataView(watchSab);
      const evtLen = meta.getInt32(4, true);
      const evtBytes = new Uint8Array(watchSab, 8, evtLen);
      const evtJson = Buffer.from(evtBytes).toString("utf-8");
      Atomics.store(watchCtrl, 0, 0);
      session.worker.postMessage({ type: "ack" });
      return h.allocOptionI32(h.writeString(evtJson));
    },

    fs_watch_stop(handleN: bigint): void {
      const handle = Number(handleN);
      const session = fsWatchTable.get(handle);
      if (!session) return;
      session.worker.postMessage({ type: "close" });
      fsWatchTable.delete(handle);
    },

    stdin_try_read(timeoutN: bigint): number {
      const timeoutMs = Number(timeoutN);

      if (config.stdin !== undefined) {
        if (config.stdin === "") return h.allocOptionI32(null);
        const newline = config.stdin.indexOf("\n");
        if (newline === -1) {
          const line = config.stdin;
          config.stdin = "";
          return h.allocOptionI32(h.writeString(line));
        }
        const line = config.stdin.substring(0, newline);
        config.stdin = config.stdin.substring(newline + 1);
        return h.allocOptionI32(h.writeString(line));
      }

      if (stdinWorkerEofLatched) return h.allocOptionI32(null);

      ensureStdinReader();
      const ctrl = stdinReaderRef.ctrl!;
      const sab = stdinReaderRef.sab!;
      let current = Atomics.load(ctrl, 0);
      if (current === 0) {
        Atomics.wait(ctrl, 0, 0, timeoutMs);
        current = Atomics.load(ctrl, 0);
      }
      if (current === 1) {
        // STATUS_LINE
        const meta = new DataView(sab);
        const lineLen = meta.getInt32(4, true);
        const lineBytes = new Uint8Array(sab, STDIN_SAB_LINE_OFFSET, lineLen);
        const line = Buffer.from(lineBytes).toString("utf-8");
        Atomics.store(ctrl, 0, 0);
        Atomics.notify(ctrl, 0, 1);
        return h.allocOptionI32(h.writeString(line));
      }
      if (current === 2 || current === 3) {
        // STATUS_EOF or STATUS_ERROR — latch so future calls return immediately
        stdinWorkerEofLatched = true;
      }
      return h.allocOptionI32(null);
    },

    stdin_eof_detected(): number {
      return (stdinEofLatched || stdinWorkerEofLatched) ? 1 : 0;
    },
  };
}
