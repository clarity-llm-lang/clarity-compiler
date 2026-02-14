# Database CRUD Operations (REQUIREMENTS)

**Status:** ⚠️ **BLOCKED** - Missing DB effect built-ins, Map type
**Complexity:** Intermediate-Advanced
**Category:** Database, Data Persistence

## Overview

Perform CRUD (Create, Read, Update, Delete) operations on a database. Demonstrates SQL execution, query results, and structured data handling.

## Required Language Features

### 1. Database Built-ins

```clarity
effect[DB] function db_query(sql: String, params: List<String>) -> Result<List<Row>, DbError>
effect[DB] function db_execute(sql: String, params: List<String>) -> Result<Int64, DbError>

type Row = Map<String, String>  // Column name -> value
type DbError = {
  code: Int64,
  message: String
}
```

### 2. Map Type (for query results)

```clarity
type Map<K, V>
function map_get<K, V>(m: Map<K, V>, key: K) -> Option<V>
```

## Example Implementation

```clarity
type User = {
  id: Int64,
  name: String,
  email: String,
  age: Int64
}

// Create table
effect[DB, Log] function create_users_table() -> Unit {
  let sql = "CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    age INTEGER
  )";

  match db_execute(sql, []) {
    Ok(_) -> print_string("Table created"),
    Err(e) -> print_string("Error: " ++ e.message)
  }
}

// Insert user
effect[DB, Log] function insert_user(name: String, email: String, age: Int64) -> Unit {
  let sql = "INSERT INTO users (name, email, age) VALUES (?, ?, ?)";
  let params = [name, email, int_to_string(age)];

  match db_execute(sql, params) {
    Ok(rows_affected) -> print_string("Inserted " ++ int_to_string(rows_affected) ++ " row(s)"),
    Err(e) -> print_string("Error: " ++ e.message)
  }
}

// Query user by ID
effect[DB, Log] function get_user(user_id: Int64) -> Option<User> {
  let sql = "SELECT id, name, email, age FROM users WHERE id = ?";
  let params = [int_to_string(user_id)];

  match db_query(sql, params) {
    Err(e) -> {
      print_string("Error: " ++ e.message);
      None
    },
    Ok(rows) -> match length(rows) == 0 {
      True -> None,
      False -> {
        let row = head(rows);
        Some(parse_user_row(row))
      }
    }
  }
}

function parse_user_row(row: Row) -> User {
  {
    id: map_get(row, "id") |> option_map(string_to_int) |> option_unwrap_or(0),
    name: map_get(row, "name") |> option_unwrap_or(""),
    email: map_get(row, "email") |> option_unwrap_or(""),
    age: map_get(row, "age") |> option_map(string_to_int) |> option_unwrap_or(0)
  }
}

// Update user
effect[DB, Log] function update_user(user_id: Int64, name: String, email: String) -> Unit {
  let sql = "UPDATE users SET name = ?, email = ? WHERE id = ?";
  let params = [name, email, int_to_string(user_id)];

  match db_execute(sql, params) {
    Ok(rows_affected) -> print_string("Updated " ++ int_to_string(rows_affected) ++ " row(s)"),
    Err(e) -> print_string("Error: " ++ e.message)
  }
}

// Delete user
effect[DB, Log] function delete_user(user_id: Int64) -> Unit {
  let sql = "DELETE FROM users WHERE id = ?";
  let params = [int_to_string(user_id)];

  match db_execute(sql, params) {
    Ok(rows_affected) -> print_string("Deleted " ++ int_to_string(rows_affected) ++ " row(s)"),
    Err(e) -> print_string("Error: " ++ e.message)
  }
}

// List all users
effect[DB, Log] function list_users() -> Unit {
  let sql = "SELECT id, name, email, age FROM users";

  match db_query(sql, []) {
    Err(e) -> print_string("Error: " ++ e.message),
    Ok(rows) -> print_users(rows)
  }
}

function print_users(rows: List<Row>) -> Unit {
  match length(rows) == 0 {
    True -> print_string("No users found"),
    False -> {
      print_user(parse_user_row(head(rows)));
      print_users(tail(rows))
    }
  }
}

function print_user(user: User) -> Unit {
  print_string(
    int_to_string(user.id) ++ ": " ++
    user.name ++ " (" ++
    user.email ++ "), age " ++
    int_to_string(user.age)
  )
}

// Main demo
effect[DB, Log] function main() -> Unit {
  create_users_table();

  insert_user("Alice", "alice@example.com", 30);
  insert_user("Bob", "bob@example.com", 25);

  list_users();

  match get_user(1) {
    Some(user) -> print_string("Found: " ++ user.name),
    None -> print_string("User not found")
  };

  update_user(1, "Alice Smith", "alice.smith@example.com");
  delete_user(2);

  list_users()
}
```

## Learning Objectives

- SQL database operations
- Parameterized queries (SQL injection prevention)
- Error handling with Result types
- Converting between database rows and Clarity records
- CRUD pattern implementation

## Dependencies

- ❌ DB effect built-ins (CRITICAL)
- ❌ Map type (CRITICAL)
- ⚠️ Connection pooling (future)
- ⚠️ Transaction support (future)

## Notes

This example uses SQLite-style syntax. A production implementation would need:
- Connection management
- Transaction support (BEGIN, COMMIT, ROLLBACK)
- Prepared statement caching
- Connection pooling
