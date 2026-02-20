# Configuration Parser

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Intermediate
**Category:** Parsing, Text Processing

## Overview

Parse INI configuration files into a List<ConfigEntry>. Demonstrates text parsing, string processing, and key-value storage without requiring a Map type.

## Implementation Notes

Uses `List<ConfigEntry>` instead of `Map<K, V>` to avoid needing a Map type. For typical config files (< 100 entries), O(n) lookup is perfectly acceptable.

### Key Functions

```clarity
type ConfigEntry = { key: String, value: String }
type Config = List<ConfigEntry>

function parse_ini(content: String) -> Config
function get_config(config: Config, key: String, default: String) -> String
function set_config(config: Config, key: String, value: String) -> Config
```

## Example Usage

Parse INI file:
```ini
# config.ini
app_name = MyApp
port = 8080
debug = true

# Database settings
db_host = localhost
db_port = 5432
```

```clarity
effect[FileSystem] function load_config(filename: String) -> Config {
  let content = read_file(filename);
  parse_ini(content)
}

effect[Log] function main() -> Unit {
  let sample = """
# App config
app_name = MyApp
port = 8080
  """;

  let config = parse_ini(sample);

  // Get values with defaults
  let name = get_config(config, "app_name", "unknown");
  let port = get_config(config, "port", "3000");

  print_string("App: " ++ name);
  print_string("Port: " ++ port)
}
```

## Features Demonstrated

- INI file parsing (key=value format)
- Comment handling (# and ; prefixes)
- String processing with split, trim, substring
- List of records as alternative to Map
- Handling values containing '=' (join remaining parts)
- Robust whitespace trimming

## Learning Objectives

- File parsing line-by-line
- List-based configuration storage
- String trimming and splitting
- Handling comments and malformed input
- O(n) lookup trade-offs

## Usage

```bash
# Run demo
npx clarityc run examples/10-config-parser/config.clarity -f demo

# Run tests
npx clarityc test examples/10-config-parser/config.clarity
```

## Tests

12 tests covering:
- Empty config
- Set and get operations
- Updating existing keys
- Parsing simple lines
- Whitespace handling
- Comment lines (# and ;)
- Values containing '='
- Full INI parsing
- get_keys operation
- starts_with utility
