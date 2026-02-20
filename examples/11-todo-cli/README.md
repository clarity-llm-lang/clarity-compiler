# Todo List CLI

**Status:** ✅ **IMPLEMENTED** (using line-based persistence; JSON optional)
**Complexity:** Intermediate
**Category:** CLI Application, CRUD, Persistence

## Overview

Command-line todo list with persistence. Demonstrates CRUD operations, command parsing, and data persistence.

## Usage

### 1. Persistence Format

```clarity
// Current implementation uses: id|done|text lines
// Optional enhancement: JSON persistence built-ins
function json_parse(s: String) -> Result<JsonValue, String>      // optional
function json_stringify(val: JsonValue) -> String                // optional
```

## Implementation Details

### Persistence format
Todos are stored in `todos.txt`, one per line:
```
1	Buy milk|false
2	Write documentation|true
```
Each line is `id<TAB>text|done`. The `|` separator uses the **last** pipe in the
entry, so todo text may safely contain `|` characters.

### 3. Better Command Parsing (optional enhancement)

```clarity
// In-memory: Map<String, String>  key=string-id, value=entry
// Entry encoding: "text|done"  where done = "true" / "false"

function make_entry(text: String, done: Bool) -> String  // encode
function entry_text(entry: String) -> String              // decode text
function entry_done(entry: String) -> Bool                // decode status
```

### Command parsing

```clarity
type Command =
  | AddCmd(text: String)
  | ListCmd
  | DoneCmd(id: Int64)
  | DeleteCmd(id: Int64)
  | HelpCmd
  | ErrorCmd(msg: String)

function parse_command(args: List<String>) -> Command
```

### Main dispatch

```clarity
effect[FileSystem, Log] function main() -> Unit {
  let args = get_args();
  let path = "todos.txt";
  let cmd  = parse_command(args);
  match cmd {
    AddCmd(text)  -> cmd_add(path, text),
    ListCmd       -> cmd_list(path),
    DoneCmd(id)   -> cmd_done(path, id),
    DeleteCmd(id) -> cmd_delete(path, id),
    HelpCmd       -> print_help(),
    ErrorCmd(msg) -> print_string("Error: " ++ msg)
  }
}
```

## Learning Objectives

- CLI application structure
- Command parsing from arguments
- CRUD operations
- JSON persistence
- Map-based data storage

## Dependencies

- ✅ `Map<K, V>` and map built-ins
- ✅ File I/O + `get_args()`
- ⚠️ JSON built-ins (optional; would simplify interoperability)
- ⚠️ Structured command parser type (ergonomics improvement)
