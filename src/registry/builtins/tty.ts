// TTY builtins: raw terminal input and cursor/line control.

import {
  INT64, BOOL, UNIT, OPTION_STRING,
  type ClarityBuiltin,
} from "./types.js";

export const TTY_BUILTINS: ClarityBuiltin[] = [
  { name: "tty_is_tty", params: [], paramNames: [], returnType: BOOL, effects: [], doc: "Return True if stdout is connected to a real TTY (interactive terminal). Pure — no effect required. Use this to decide whether to use cursor/raw-mode features or fall back to plain output.", category: "tty" },
  { name: "tty_term_width", params: [], paramNames: [], returnType: INT64, effects: ["TTY"], doc: "Return the current terminal width in columns. Returns 80 if not a TTY or width is unavailable.", category: "tty" },
  { name: "tty_term_height", params: [], paramNames: [], returnType: INT64, effects: ["TTY"], doc: "Return the current terminal height in rows. Returns 24 if not a TTY or height is unavailable.", category: "tty" },
  { name: "tty_enter_raw", params: [], paramNames: [], returnType: UNIT, effects: ["TTY"], doc: "Enable raw (character-at-a-time) mode on stdin. After this call, keypresses are delivered immediately without waiting for Enter, and line editing is disabled. Restore with tty_exit_raw(). Has no effect if stdin is not a TTY.", category: "tty" },
  { name: "tty_exit_raw", params: [], paramNames: [], returnType: UNIT, effects: ["TTY"], doc: "Disable raw mode and restore normal line-buffered stdin. Always call this before your program exits if you called tty_enter_raw().", category: "tty" },
  {
    name: "tty_read_key", params: [INT64], paramNames: ["timeout_ms"],
    returnType: OPTION_STRING, effects: ["TTY"],
    doc: "Read one keypress from stdin (requires raw mode via tty_enter_raw). Blocks up to timeout_ms milliseconds. Returns Some(key) where key is one of: \"up\", \"down\", \"left\", \"right\", \"enter\", \"space\", \"backspace\", \"escape\", \"ctrl+c\", \"ctrl+d\", or a single printable character. Returns None on timeout or EOF.", category: "tty",
  },
  { name: "tty_cursor_up", params: [INT64], paramNames: ["n"], returnType: UNIT, effects: ["TTY"], doc: "Move the cursor up n lines using ANSI escape codes. Has no effect if n <= 0.", category: "tty" },
  { name: "tty_cursor_down", params: [INT64], paramNames: ["n"], returnType: UNIT, effects: ["TTY"], doc: "Move the cursor down n lines using ANSI escape codes. Has no effect if n <= 0.", category: "tty" },
  { name: "tty_cursor_to_col", params: [INT64], paramNames: ["col"], returnType: UNIT, effects: ["TTY"], doc: "Move the cursor to column col on the current line (1-based). Use col=1 to return to the start of the line.", category: "tty" },
  { name: "tty_clear_line", params: [], paramNames: [], returnType: UNIT, effects: ["TTY"], doc: "Clear the current line and move cursor to column 1. Equivalent to \\x1b[2K\\r. Use for in-place line redraw.", category: "tty" },
  { name: "tty_hide_cursor", params: [], paramNames: [], returnType: UNIT, effects: ["TTY"], doc: "Hide the terminal cursor. Remember to call tty_show_cursor() before your program exits.", category: "tty" },
  { name: "tty_show_cursor", params: [], paramNames: [], returnType: UNIT, effects: ["TTY"], doc: "Show the terminal cursor (restores visibility after tty_hide_cursor).", category: "tty" },
];
