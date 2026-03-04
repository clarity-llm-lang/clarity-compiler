import type { SharedHelpers } from "./types.js";
export declare const TTY_KEY_SAB_SIZE = 40;
export declare const TTY_KEY_OFFSET = 8;
export declare const TTY_KEY_MAX = 32;
export declare const _TTY_KEY_WORKER_CODE = "\nconst { workerData } = require('worker_threads');\nconst fs = require('fs');\nconst { sab } = workerData;\nconst ctrl = new Int32Array(sab, 0, 1);\nconst meta = new DataView(sab);\nconst KEY_OFFSET = 8, KEY_MAX = 32;\nconst STATUS_IDLE = 0, STATUS_KEY = 1, STATUS_EOF = 2, STATUS_ERROR = 3;\n\nfunction normalizeKey(buf, n) {\n  if (n === 0) return null;\n  var b0 = buf[0];\n  if (b0 === 0x1b && n >= 3 && buf[1] === 0x5b) {\n    var b2 = buf[2];\n    if (b2 === 0x41) return 'up';\n    if (b2 === 0x42) return 'down';\n    if (b2 === 0x43) return 'right';\n    if (b2 === 0x44) return 'left';\n    if (b2 === 0x48) return 'home';\n    if (b2 === 0x46) return 'end';\n    return 'escape';\n  }\n  if (b0 === 0x1b) return 'escape';\n  if (b0 === 0x0d || b0 === 0x0a) return 'enter';\n  if (b0 === 0x20) return 'space';\n  if (b0 === 0x7f || b0 === 0x08) return 'backspace';\n  if (b0 === 0x03) return 'ctrl+c';\n  if (b0 === 0x04) return 'ctrl+d';\n  if (b0 === 0x09) return 'tab';\n  if (b0 >= 0x20 && b0 < 0x7f) return String.fromCharCode(b0);\n  return null;\n}\n\nfunction readNext() {\n  var buf = Buffer.alloc(4);\n  var n;\n  try { n = fs.readSync(0, buf, 0, 4, null); }\n  catch(e) {\n    Atomics.store(ctrl, 0, STATUS_ERROR);\n    Atomics.notify(ctrl, 0, 1);\n    return;\n  }\n  if (n === 0) {\n    Atomics.store(ctrl, 0, STATUS_EOF);\n    Atomics.notify(ctrl, 0, 1);\n    return;\n  }\n  var key = normalizeKey(buf, n);\n  if (!key) { readNext(); return; }\n  var encoded = Buffer.from(key, 'utf8');\n  var len = Math.min(encoded.length, KEY_MAX);\n  meta.setInt32(4, len, true);\n  new Uint8Array(sab, KEY_OFFSET, len).set(encoded.subarray(0, len));\n  Atomics.store(ctrl, 0, STATUS_KEY);\n  Atomics.notify(ctrl, 0, 1);\n  Atomics.wait(ctrl, 0, STATUS_KEY);\n  readNext();\n}\n\nreadNext();\n";
export declare function createTtyRuntime(h: SharedHelpers): {
    tty_is_tty(): number;
    tty_term_width(): bigint;
    tty_term_height(): bigint;
    tty_enter_raw(): void;
    tty_exit_raw(): void;
    tty_read_key(timeoutN: bigint): number;
    tty_cursor_up(nN: bigint): void;
    tty_cursor_down(nN: bigint): void;
    tty_cursor_to_col(colN: bigint): void;
    tty_clear_line(): void;
    tty_hide_cursor(): void;
    tty_show_cursor(): void;
};
