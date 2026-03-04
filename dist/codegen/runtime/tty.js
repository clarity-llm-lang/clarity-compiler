// TTY builtins: raw key input, cursor control, terminal queries.
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
  if (b0 === 0x1b && n >= 3 && buf[1] === 0x5b) {
    var b2 = buf[2];
    if (b2 === 0x41) return 'up';
    if (b2 === 0x42) return 'down';
    if (b2 === 0x43) return 'right';
    if (b2 === 0x44) return 'left';
    if (b2 === 0x48) return 'home';
    if (b2 === 0x46) return 'end';
    return 'escape';
  }
  if (b0 === 0x1b) return 'escape';
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
  var buf = Buffer.alloc(4);
  var n;
  try { n = fs.readSync(0, buf, 0, 4, null); }
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
    function ensureTtyKeyReader() {
        if (ttyKeyWorker)
            return;
        ttyKeySab = new SharedArrayBuffer(TTY_KEY_SAB_SIZE);
        ttyKeyCtrl = new Int32Array(ttyKeySab, 0, 1);
        ttyKeyWorker = new Worker(_TTY_KEY_WORKER_CODE, {
            eval: true,
            workerData: { sab: ttyKeySab },
        });
        ttyKeyWorker.on("error", () => { ttyKeyWorker = null; ttyKeySab = null; ttyKeyCtrl = null; });
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
                if (process.stdin.isTTY)
                    process.stdin.setRawMode(true);
            }
            catch { /* not a TTY */ }
        },
        tty_exit_raw() {
            try {
                if (process.stdin.isTTY)
                    process.stdin.setRawMode(false);
            }
            catch { /* not a TTY */ }
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
    };
}
//# sourceMappingURL=tty.js.map