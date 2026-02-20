# Todo List CLI (REQUIREMENTS)

**Status:** ⚠️ **PARTIALLY BLOCKED** - Better arg parsing and full JSON model support still missing
**Complexity:** Intermediate
**Category:** CLI Application, CRUD, Persistence

## Overview

Command-line todo list with persistence (JSON file storage). Demonstrates CRUD operations, command parsing, and data persistence.

## Required Language Features

### 1. JSON for Persistence

```clarity
function json_parse(s: String) -> Result<JsonValue, String>
function json_stringify(val: JsonValue) -> String
```

### 2. Map Type (for storing todos by ID)

```clarity
type Map<K, V>  // Map<Int64, Todo>
```

### 3. Better Command Parsing

```clarity
// Current: get_args() returns List<String>
// Need: structured command parsing

type Command =
  | Add(text: String)
  | List
  | Done(id: Int64)
  | Delete(id: Int64)
  | Help

function parse_command(args: List<String>) -> Result<Command, String>
```

## Example Usage

```bash
todo add "Buy milk"              # Add new todo
todo add "Write documentation"
todo list                         # Show all todos
todo done 1                       # Mark todo #1 as done
todo delete 2                     # Delete todo #2
```

## Example Implementation

```clarity
type Todo = {
  id: Int64,
  text: String,
  done: Bool
}

type TodoList = Map<Int64, Todo>

effect[FileSystem, Log] function main() -> Unit {
  let args = get_args();
  let todos = load_todos("todos.json");

  match parse_command(args) {
    Err(msg) -> print_string("Error: " ++ msg),
    Ok(cmd) -> {
      let new_todos = execute_command(cmd, todos);
      save_todos("todos.json", new_todos)
    }
  }
}

function execute_command(cmd: Command, todos: TodoList) -> TodoList {
  match cmd {
    Add(text) -> add_todo(todos, text),
    List -> { list_todos(todos); todos },
    Done(id) -> mark_done(todos, id),
    Delete(id) -> delete_todo(todos, id),
    Help -> { show_help(); todos }
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

- ⚠️ JSON parsing/serialization (flat objects with scalar values only)
- ✅ Map type
- ⚠️ Better arg parsing (can implement manually)
