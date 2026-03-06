// TTY builtins: raw key input, cursor control, terminal queries.
import * as nodeFs from "node:fs";
import { Worker } from "node:worker_threads";
export const TTY_KEY_SAB_SIZE = 40;
export const TTY_KEY_OFFSET = 8;
export const TTY_KEY_MAX = 32;
export const _TTY_KEY_WORKER_CODE = `
const { workerData } = require('worker_threads');
const fs = require('fs');
const { sab } = workerData;
const ctrl = new Int32Array(sab, 0, 1);
const meta = new DataView(sab);
const KEY_OFFSET = 8, KEY_MAX = 32;
const STATUS_IDLE = 0, STATUS_KEY = 1, STATUS_EOF = 2, STATUS_ERROR = 3;

function normalizeKey(buf, n) {
  if (n === 0) return null;
  var b0 = buf[0];
  if (b0 === 0x1b) {
    // macOS fix: if only ESC arrived, drain remaining sequence bytes.
    // In raw mode on macOS, readSync may split escape sequences across reads.
    // We try a second read up to 7 more bytes to capture the full sequence.
    if (n === 1) {
      var extra = 0;
      try { extra = fs.readSync(0, buf, 1, 7, null); } catch(_) {}
      if (extra > 0) n += extra;
    }
    if (n >= 3 && buf[1] === 0x5b) {
      var b2 = buf[2];
      if (b2 === 0x41) return 'up';
      if (b2 === 0x42) return 'down';
      if (b2 === 0x43) return 'right';
      if (b2 === 0x44) return 'left';
      if (b2 === 0x48) return 'home';
      if (b2 === 0x46) return 'end';
      if (b2 === 0x35 && n >= 4 && buf[3] === 0x7e) return 'page_up';
      if (b2 === 0x36 && n >= 4 && buf[3] === 0x7e) return 'page_down';
      if (b2 === 0x33 && n >= 4 && buf[3] === 0x7e) return 'delete';
    }
    if (n >= 3 && buf[1] === 0x4f) {
      if (buf[2] === 0x50) return 'f1';
      if (buf[2] === 0x51) return 'f2';
      if (buf[2] === 0x52) return 'f3';
      if (buf[2] === 0x53) return 'f4';
    }
    return 'escape';
  }
  if (b0 === 0x0d || b0 === 0x0a) return 'enter';
  if (b0 === 0x20) return 'space';
  if (b0 === 0x7f || b0 === 0x08) return 'backspace';
  if (b0 === 0x03) return 'ctrl+c';
  if (b0 === 0x04) return 'ctrl+d';
  if (b0 === 0x09) return 'tab';
  if (b0 >= 0x20 && b0 < 0x7f) return String.fromCharCode(b0);
  return null;
}

function readNext() {
  // Use 8-byte buffer to handle longer sequences (F-keys, etc.)
  var buf = Buffer.alloc(8);
  var n;
  try { n = fs.readSync(0, buf, 0, 8, null); }
  catch(e) {
    Atomics.store(ctrl, 0, STATUS_ERROR);
    Atomics.notify(ctrl, 0, 1);
    return;
  }
  if (n === 0) {
    Atomics.store(ctrl, 0, STATUS_EOF);
    Atomics.notify(ctrl, 0, 1);
    return;
  }
  var key = normalizeKey(buf, n);
  if (!key) { readNext(); return; }
  var encoded = Buffer.from(key, 'utf8');
  var len = Math.min(encoded.length, KEY_MAX);
  meta.setInt32(4, len, true);
  new Uint8Array(sab, KEY_OFFSET, len).set(encoded.subarray(0, len));
  Atomics.store(ctrl, 0, STATUS_KEY);
  Atomics.notify(ctrl, 0, 1);
  Atomics.wait(ctrl, 0, STATUS_KEY);
  readNext();
}

readNext();
`;
export function createTtyRuntime(h) {
    let ttyKeyWorker = null;
    let ttyKeySab = null;
    let ttyKeyCtrl = null;
    let rawModeActive = false;
    let exitHandlersRegistered = false;
    function restoreTerminal() {
        if (rawModeActive) {
            try {
                if (process.stdin.isTTY)
                    process.stdin.setRawMode(false);
            }
            catch { /* not a TTY */ }
            rawModeActive = false;
        }
    }
    function ensureExitHandlers() {
        if (exitHandlersRegistered)
            return;
        exitHandlersRegistered = true;
        // Restore terminal mode on process exit, SIGINT, SIGTERM, and uncaught errors
        // so the user's terminal is not left in raw mode after the program exits.
        process.on("exit", restoreTerminal);
        process.on("SIGINT", () => { restoreTerminal(); process.exit(130); });
        process.on("SIGTERM", () => { restoreTerminal(); process.exit(143); });
        process.on("uncaughtException", (err) => {
            restoreTerminal();
            process.stderr.write(err.stack ?? String(err));
            process.exit(1);
        });
    }
    function ensureTtyKeyReader() {
        if (ttyKeyWorker)
            return;
        ttyKeySab = new SharedArrayBuffer(TTY_KEY_SAB_SIZE);
        ttyKeyCtrl = new Int32Array(ttyKeySab, 0, 1);
        ttyKeyWorker = new Worker(_TTY_KEY_WORKER_CODE, {
            eval: true,
            workerData: { sab: ttyKeySab },
        });
        ttyKeyWorker.on("error", (err) => {
            // Worker failed — log to stderr for debugging and mark as broken.
            process.stderr.write(`[tty_read_key worker error] ${err.message ?? String(err)}\n`);
            ttyKeyWorker = null;
            ttyKeySab = null;
            ttyKeyCtrl = null;
        });
    }
    return {
        tty_is_tty() {
            return (process.stdout.isTTY === true) ? 1 : 0;
        },
        tty_term_width() {
            return BigInt((process.stdout.columns ?? 80));
        },
        tty_term_height() {
            return BigInt((process.stdout.rows ?? 24));
        },
        tty_enter_raw() {
            try {
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(true);
                    rawModeActive = true;
                    ensureExitHandlers();
                }
            }
            catch { /* not a TTY */ }
        },
        tty_exit_raw() {
            restoreTerminal();
        },
        tty_read_key(timeoutN) {
            const timeoutMs = Number(timeoutN);
            ensureTtyKeyReader();
            const ctrl = ttyKeyCtrl;
            const sab = ttyKeySab;
            let current = Atomics.load(ctrl, 0);
            if (current === 0) {
                Atomics.wait(ctrl, 0, 0, timeoutMs);
                current = Atomics.load(ctrl, 0);
            }
            if (current === 1) {
                const meta = new DataView(sab);
                const keyLen = meta.getInt32(4, true);
                const keyBytes = new Uint8Array(sab, TTY_KEY_OFFSET, keyLen);
                const key = Buffer.from(keyBytes).toString("utf-8");
                Atomics.store(ctrl, 0, 0);
                Atomics.notify(ctrl, 0, 1);
                return h.allocOptionI32(h.writeString(key));
            }
            return h.allocOptionI32(null);
        },
        tty_cursor_up(nN) {
            const n = Number(nN);
            if (n > 0)
                process.stdout.write(`\x1b[${n}A`);
        },
        tty_cursor_down(nN) {
            const n = Number(nN);
            if (n > 0)
                process.stdout.write(`\x1b[${n}B`);
        },
        tty_cursor_to_col(colN) {
            const col = Number(colN);
            if (col >= 1)
                process.stdout.write(`\x1b[${col}G`);
        },
        tty_clear_line() {
            process.stdout.write("\x1b[2K\r");
        },
        tty_hide_cursor() {
            process.stdout.write("\x1b[?25l");
        },
        tty_show_cursor() {
            process.stdout.write("\x1b[?25h");
        },
        tty_read_numeric_choice(countN) {
            // RQ-LANG-CLI-TTY-003: numeric-selection fallback that works in any terminal.
            // Prints a prompt, reads a full line from stdin, validates the integer 1..count,
            // and returns the zero-based index (choice - 1). Returns -1n on invalid input.
            // Works in both raw-mode TTY and plain line-buffered terminals (CI, SSH no PTY).
            const count = Number(countN);
            process.stdout.write("> ");
            try {
                const buf = Buffer.alloc(256);
                let total = 0;
                while (total < 255) {
                    const n = nodeFs.readSync(0, buf, total, 1, null);
                    if (n === 0)
                        break;
                    const ch = buf[total];
                    total++;
                    if (ch === 0x0a || ch === 0x0d)
                        break; // LF or CR = end of line
                }
                const line = buf.subarray(0, total).toString("utf-8").replace(/[\r\n]+$/, "").trim();
                const parsed = parseInt(line, 10);
                if (isNaN(parsed) || parsed < 1 || parsed > count)
                    return -1n;
                return BigInt(parsed - 1);
            }
            catch {
                return -1n;
            }
        },
    };
}
//# sourceMappingURL=tty.js.map