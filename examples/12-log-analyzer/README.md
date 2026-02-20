# Log Analyzer (REQUIREMENTS)

**Status:** ✅ **IMPLEMENTED** (regex-free parser; DateTime parsing remains optional)
**Complexity:** Intermediate-Advanced
**Category:** Text Processing, Data Aggregation

## Overview

Parse Apache/Nginx logs, extract fields, count requests by IP, find errors, analyze time patterns.

## Required Language Features

### 1. Regex for Pattern Matching

```clarity
function regex_match(pattern: String, text: String) -> Bool
function regex_captures(pattern: String, text: String) -> Option<List<String>>

// Example: Parse Apache log line
// 127.0.0.1 - - [10/Oct/2000:13:55:36 -0700] "GET /index.html HTTP/1.0" 200 2326
let pattern = r'(\S+) \S+ \S+ \[([\w:/]+\s[+\-]\d{4})\] "(\S+) (\S+)\s*(\S*)" (\d{3}) (\d+)';
match regex_captures(pattern, line) {
  Some(groups) -> {
    let ip = groups[0];
    let timestamp = groups[1];
    let method = groups[2];
    let path = groups[3];
    let status = string_to_int(groups[5]);
    // Process...
  },
  None -> print_string("Invalid log format")
}
```

### 2. Map for Aggregation

```clarity
type Map<K, V>  // Map<String, Int64> for counting
function map_get<K, V>(m: Map<K, V>, key: K) -> Option<V>
function map_set<K, V>(m: Map<K, V>, key: K, value: V) -> Map<K, V>
```

### 3. DateTime Parsing (Optional)

```clarity
type DateTime
function parse_datetime(s: String, format: String) -> Result<DateTime, String>
function datetime_diff(d1: DateTime, d2: DateTime) -> Int64  // seconds
```

## Example Use Case

```clarity
effect[FileSystem, Log] function analyze_logs(filename: String) -> Unit {
  let content = read_file(filename);
  let lines = string_split(content, "\n");

  // Count requests per IP
  let ip_counts = count_by_ip(lines, map_new());
  print_map(ip_counts);

  // Find errors (status >= 400)
  let errors = filter(lines, is_error_line);
  print_string("Errors: " ++ int_to_string(length(errors)))
}

function count_by_ip(lines: List<String>, counts: Map<String, Int64>) -> Map<String, Int64> {
  match length(lines) == 0 {
    True -> counts,
    False -> {
      let line = head(lines);
      match regex_captures(log_pattern, line) {
        Some(groups) -> {
          let ip = head(groups);
          let current = match map_get(counts, ip) {
            Some(n) -> n,
            None -> 0
          };
          let new_counts = map_set(counts, ip, current + 1);
          count_by_ip(tail(lines), new_counts)
        },
        None -> count_by_ip(tail(lines), counts)
      }
    }
  }
}
```

## Learning Objectives

- Regular expression pattern matching
- Log parsing and field extraction
- Data aggregation with Map
- Filtering and analysis
- Working with timestamps

## Dependencies

- ⚠️ Regex built-ins (optional ergonomics upgrade)
- ✅ Map type and map built-ins
- ⚠️ DateTime parsing (NICE TO HAVE)
- ✅ `split` string builtin
