# JSON API Client (REQUIREMENTS)

**Status:** ⚠️ **PARTIALLY BLOCKED** - Missing JSON parsing/serialization runtime
**Complexity:** Intermediate
**Category:** Network, Data Processing

## Overview

Fetch data from a JSON API, parse the response, and extract values. Demonstrates HTTP requests, JSON handling, and structured data processing.

## Required Language Features

### 1. HTTP Client (Network effect built-ins)

```clarity
effect[Network] function http_get(url: String) -> Result<String, HttpError>
effect[Network] function http_post(url: String, body: String) -> Result<String, HttpError>

type HttpError = {
  status_code: Int64,
  message: String
}
```

### 2. JSON Parsing/Serialization

```clarity
function json_parse(s: String) -> Result<JsonValue, String>
function json_stringify(val: JsonValue) -> String

type JsonValue =
  | JsonNull
  | JsonBool(Bool)
  | JsonNumber(Float64)
  | JsonString(String)
  | JsonArray(List<JsonValue>)
  | JsonObject(Map<String, JsonValue>)
```

### 3. Map/Dictionary Type

```clarity
type Map<K, V>
function map_new<K, V>() -> Map<K, V>
function map_get<K, V>(m: Map<K, V>, key: K) -> Option<V>
function map_set<K, V>(m: Map<K, V>, key: K, value: V) -> Map<K, V>
function map_keys<K, V>(m: Map<K, V>) -> List<K>
function map_values<K, V>(m: Map<K, V>) -> List<V>
```

## Example Use Case

Fetch weather data from OpenWeatherMap API:

```clarity
effect[Network, Log] function get_weather(city: String) -> Unit {
  let url = "https://api.openweathermap.org/data/2.5/weather?q=" ++ city;

  match http_get(url) {
    Err(e) -> print_string("HTTP error: " ++ e.message),
    Ok(response_body) -> {
      match json_parse(response_body) {
        Err(msg) -> print_string("Parse error: " ++ msg),
        Ok(json) -> {
          match json {
            JsonObject(obj) -> {
              match map_get(obj, "main") {
                Some(JsonObject(main)) -> {
                  match map_get(main, "temp") {
                    Some(JsonNumber(temp)) -> {
                      print_string("Temperature: " ++ float_to_string(temp))
                    },
                    _ -> print_string("Temperature not found")
                  }
                },
                _ -> print_string("Main object not found")
              }
            },
            _ -> print_string("Expected JSON object")
          }
        }
      }
    }
  }
}
```

## Learning Objectives

- HTTP requests with error handling
- JSON parsing and traversal
- Working with Result types for error handling
- Map operations for key-value data
- Pattern matching on union types (JsonValue)

## Dependencies

- ✅ HTTP client (Network effect built-ins)
- ❌ JSON parsing (`json_parse`, `json_stringify`)
- ✅ Map type (`Map<K, V>`)
- ✅ String operations (already available)
- ✅ Result type (already available)
