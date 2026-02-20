# Todo List CLI

**Status:** ✅ **Implemented** (14 tests)
**Complexity:** Intermediate
**Category:** CLI Application, CRUD, Persistence

## Overview

Command-line todo list with file persistence. Demonstrates CRUD operations,
command parsing from argv, `Map<String, String>` for in-memory storage, and
a custom tab-separated text format for persistence.

## Usage

```bash
# Run with the Clarity compiler
npx clarityc run examples/11-todo-cli/todo.clarity -f main -a add "Buy milk"
npx clarityc run examples/11-todo-cli/todo.clarity -f main -a list
npx clarityc run examples/11-todo-cli/todo.clarity -f main -a done 1
npx clarityc run examples/11-todo-cli/todo.clarity -f main -a delete 1
npx clarityc run examples/11-todo-cli/todo.clarity -f main -a help

# Run tests
npx clarityc test examples/11-todo-cli/todo.clarity
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

### Data model

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

## Language Features Demonstrated

- `Map<String, String>` for key-value storage
- `get_args()` for CLI argument parsing
- `read_file` / `write_file` for persistence
- `split()`, `trim()`, `index_of()`, `substring()` for text parsing
- `string_to_int()` returning `Option<Int64>` for safe ID parsing
- Union types (`Command`) for structured dispatch
- Tail-recursive helpers for list and map traversal
- `last_index_of` helper to handle text containing `|` characters

## Tests (14)

| Test | Covers |
|------|--------|
| `test_make_entry` | Entry encoding |
| `test_entry_text` | Text extraction (incl. pipes in text) |
| `test_entry_done` | Done-status extraction |
| `test_parse_command_add` | `add <text>` command |
| `test_parse_command_list` | `list` command |
| `test_parse_command_done` | `done <id>` command |
| `test_parse_command_delete` | `delete <id>` command |
| `test_parse_command_help` | `help` and no-args → HelpCmd |
| `test_parse_command_error` | Missing id, bad id, unknown command |
| `test_next_id_empty` | ID=1 for empty store |
| `test_next_id` | max+1 for populated store |
| `test_roundtrip` | serialize → parse round-trip |
| `test_parse_todos_empty` | Empty file → empty store |
| `test_parse_todos_multiline` | Multi-line file parsing |
