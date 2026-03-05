// FileSystem builtins: file I/O, stdin, args, process control, fs_watch.
import { INT64, STRING, BOOL, UNIT, LIST_STRING, OPTION_STRING, } from "./types.js";
export const FS_BUILTINS = [
    // --- I/O primitives (require FileSystem effect) ---
    { name: "read_line", params: [], paramNames: [], returnType: STRING, effects: ["FileSystem"], doc: "Read one line from stdin (up to newline). Returns empty string on EOF.", category: "io" },
    { name: "read_line_or_eof", params: [], paramNames: [], returnType: OPTION_STRING, effects: ["FileSystem"], doc: "Read one line from stdin. Returns Some(line) on success, None on EOF. After the first None, all subsequent calls also return None immediately (EOF is latched). Use this instead of read_line() when you need to distinguish EOF from an empty line. Do not mix with stdin_try_read() in the same program.", category: "io" },
    { name: "read_all_stdin", params: [], paramNames: [], returnType: STRING, effects: ["FileSystem"], doc: "Read all remaining input from stdin.", category: "io" },
    { name: "read_file", params: [STRING], paramNames: ["path"], returnType: STRING, effects: ["FileSystem"], doc: "Read the entire contents of a file as a string.", category: "io" },
    { name: "write_file", params: [STRING, STRING], paramNames: ["path", "content"], returnType: UNIT, effects: ["FileSystem"], doc: "Write a string to a file, replacing existing contents.", category: "io" },
    { name: "get_args", params: [], paramNames: [], returnType: LIST_STRING, effects: ["FileSystem"], doc: "Return command-line arguments as a list of strings.", category: "io" },
    { name: "exit", params: [INT64], paramNames: ["code"], returnType: UNIT, effects: ["FileSystem"], doc: "Exit the process with the given status code.", category: "io" },
    { name: "list_dir", params: [STRING], paramNames: ["path"], returnType: LIST_STRING, effects: ["FileSystem"], doc: "Return a list of entry names (files and subdirectories) in the given directory. Names are not sorted. Returns an empty list if the directory does not exist or cannot be read.", category: "io" },
    { name: "file_exists", params: [STRING], paramNames: ["path"], returnType: BOOL, effects: ["FileSystem"], doc: "Return True if a file or directory exists at the given path, False otherwise.", category: "io" },
    { name: "remove_file", params: [STRING], paramNames: ["path"], returnType: UNIT, effects: ["FileSystem"], doc: "Remove the file at the given path. Does nothing if the file does not exist. Raises a runtime error if the path is a directory.", category: "io" },
    { name: "make_dir", params: [STRING], paramNames: ["path"], returnType: UNIT, effects: ["FileSystem"], doc: "Create a directory at the given path, creating all intermediate directories as needed (mkdir -p semantics). Does nothing if the directory already exists.", category: "io" },
    {
        name: "fs_watch_start", params: [STRING], paramNames: ["path"],
        returnType: { kind: "Result", ok: INT64, err: STRING },
        effects: ["FileSystem"], doc: "Start watching a file or directory for changes. Returns Ok(handle) on success, Err(message) if the path does not exist or cannot be watched. Pass the handle to fs_watch_next to receive events and fs_watch_stop to stop. Uses OS-level file-watch APIs (FSEvents on macOS, inotify on Linux) with an automatic polling fallback where native APIs are unavailable.", category: "filesystem",
    },
    {
        name: "fs_watch_next", params: [INT64, INT64], paramNames: ["handle", "timeout_ms"],
        returnType: OPTION_STRING,
        effects: ["FileSystem"], doc: "Block until a file system change event arrives on the given watch handle, or until timeout_ms milliseconds elapse. Returns Some(event_json) where event_json is {\"event\":\"change\"|\"rename\",\"filename\":\"relative/path\"}. Returns None on timeout. Call fs_watch_start first to obtain a handle.", category: "filesystem",
    },
    {
        name: "fs_watch_stop", params: [INT64], paramNames: ["handle"],
        returnType: UNIT,
        effects: ["FileSystem"], doc: "Stop watching a directory and release the watch handle. After this call the handle is invalid. Safe to call if the handle is already stopped.", category: "filesystem",
    },
    {
        name: "stdin_try_read", params: [INT64], paramNames: ["timeout_ms"],
        returnType: OPTION_STRING,
        effects: ["FileSystem"], doc: "Attempt to read a line from stdin, blocking for at most timeout_ms milliseconds. Returns Some(line) when a line arrives within the timeout (trailing newline stripped), or None on timeout or EOF. Uses a background worker thread so it can be interleaved with sse_next_event_timeout in a poll loop. Do not mix with read_line() in the same program.", category: "io",
    },
    { name: "stdin_eof_detected", params: [], paramNames: [], returnType: BOOL, effects: ["FileSystem"], doc: "Return True if stdin has reached EOF (i.e., a previous read_line_or_eof() returned None, or stdin_try_read() encountered EOF). Use to exit poll loops cleanly when piped input is exhausted.", category: "io" },
];
//# sourceMappingURL=fs.js.map