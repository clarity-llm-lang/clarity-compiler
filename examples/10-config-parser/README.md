# Configuration Parser (REQUIREMENTS)

**Status:** ⚠️ **BLOCKED** - Missing string_split, Map type, regex
**Complexity:** Intermediate
**Category:** Parsing, Text Processing

## Overview

Parse INI or TOML configuration files into a Map<String, String>. Demonstrates text parsing and key-value storage.

## Required Language Features

### 1. String Operations

```clarity
function string_split(s: String, delimiter: String) -> List<String>
function string_trim(s: String) -> String  // Remove whitespace
```

### 2. Map Type

```clarity
type Map<K, V>
function map_new<K, V>() -> Map<K, V>
function map_set<K, V>(m: Map<K, V>, key: K, value: V) -> Map<K, V>
function map_get<K, V>(m: Map<K, V>, key: K) -> Option<V>
```

### 3. Regex (Optional but helpful)

```clarity
function regex_match(pattern: String, text: String) -> Bool
function regex_captures(pattern: String, text: String) -> Option<List<String>>
```

## Example Use Case

Parse INI file:
```ini
# config.ini
app_name = MyApp
port = 8080
debug = true

[database]
host = localhost
port = 5432
```

```clarity
effect[FileSystem, Log] function load_config(filename: String) -> Map<String, String> {
  let content = read_file(filename);
  let lines = string_split(content, "\n");
  parse_ini_lines(lines, map_new())
}

function parse_ini_lines(lines: List<String>, config: Map<String, String>) -> Map<String, String> {
  match length(lines) == 0 {
    True -> config,
    False -> {
      let line = trim(head(lines));
      let rest = tail(lines);

      // Skip comments and empty lines
      match starts_with(line, "#") or string_eq(line, "") {
        True -> parse_ini_lines(rest, config),
        False -> {
          // Parse key = value
          let parts = string_split(line, "=");
          match length(parts) == 2 {
            True -> {
              let key = trim(head(parts));
              let value = trim(head(tail(parts)));
              let new_config = map_set(config, key, value);
              parse_ini_lines(rest, new_config)
            },
            False -> parse_ini_lines(rest, config)  // Skip malformed lines
          }
        }
      }
    }
  }
}
```

## Learning Objectives

- File parsing line-by-line
- Map-based configuration storage
- String trimming and splitting
- Handling comments and malformed input

## Dependencies

- ❌ `string_split` (CRITICAL)
- ❌ `Map<K, V>` (CRITICAL)
- ⚠️ `string_trim` (can implement with char_at)
- ⚠️ Regex (NICE TO HAVE)
