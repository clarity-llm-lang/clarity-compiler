# JSON Parser (REQUIREMENTS)

**Status:** ⚠️ **PARTIALLY BLOCKED** - Missing char_code, better error handling
**Complexity:** Advanced
**Category:** Parsing, Text Processing

## Overview

Parse JSON strings into structured data (JsonValue). Demonstrates recursive descent parsing, error handling with line/column info, and text processing.

## Required Language Features

### 1. Character Code Operations (for classification)

```clarity
function char_code(ch: String) -> Int64
function is_digit(ch: String) -> Bool     // Can implement with char_code
function is_whitespace(ch: String) -> Bool
```

### 2. Better Error Handling with Source Locations

```clarity
type ParseResult<T> = Result<T, ParseError>

type ParseError = {
  message: String,
  line: Int64,
  column: Int64,
  context: String  // Surrounding text for debugging
}
```

### 3. JSON Value Type

```clarity
type JsonValue =
  | JsonNull
  | JsonBool(Bool)
  | JsonNumber(Float64)
  | JsonString(String)
  | JsonArray(List<JsonValue>)
  | JsonObject(Map<String, JsonValue>)
```

## Example Implementation

```clarity
type Parser = {
  input: String,
  pos: Int64,
  line: Int64,
  col: Int64
}

function parse_json(input: String) -> ParseResult<JsonValue> {
  let parser = { input: input, pos: 0, line: 1, col: 1 };
  let parser2 = skip_whitespace(parser);
  parse_value(parser2)
}

function parse_value(p: Parser) -> ParseResult<JsonValue> {
  match is_at_end(p) {
    True -> Err({ message: "Unexpected end of input", line: p.line, column: p.col, context: "" }),
    False -> {
      let ch = peek(p);
      match ch {
        "\"" -> parse_string(p),
        "[" -> parse_array(p),
        "{" -> parse_object(p),
        "t" -> parse_true(p),
        "f" -> parse_false(p),
        "n" -> parse_null(p),
        "-" -> parse_number(p),
        _ -> match is_digit(ch) {
          True -> parse_number(p),
          False -> Err({ message: "Unexpected character: " ++ ch, line: p.line, column: p.col, context: "" })
        }
      }
    }
  }
}

function parse_string(p: Parser) -> ParseResult<JsonValue> {
  // Expect opening quote
  match consume(p, "\"") {
    Err(e) -> Err(e),
    Ok(p2) -> parse_string_content(p2, "")
  }
}

function parse_string_content(p: Parser, acc: String) -> ParseResult<JsonValue> {
  match is_at_end(p) {
    True -> Err({ message: "Unterminated string", line: p.line, column: p.col, context: "" }),
    False -> {
      let ch = peek(p);
      match ch {
        "\"" -> Ok({ value: JsonString(acc), parser: advance(p) }),
        "\\" -> {
          // Handle escape sequences
          let p2 = advance(p);
          match peek(p2) {
            "\"" -> parse_string_content(advance(p2), acc ++ "\""),
            "\\" -> parse_string_content(advance(p2), acc ++ "\\"),
            "n" -> parse_string_content(advance(p2), acc ++ "\n"),
            "t" -> parse_string_content(advance(p2), acc ++ "\t"),
            _ -> Err({ message: "Invalid escape sequence", line: p2.line, column: p2.col, context: "" })
          }
        },
        _ -> parse_string_content(advance(p), acc ++ ch)
      }
    }
  }
}

function parse_number(p: Parser) -> ParseResult<JsonValue> {
  // Parse optional minus, digits, optional decimal, optional exponent
  let p2 = match peek(p) {
    "-" -> advance(p),
    _ -> p
  };
  let result = parse_digits(p2);
  match result {
    Err(e) -> Err(e),
    Ok({ digits, parser: p3 }) -> {
      // TODO: Handle decimal point and exponent
      let num = string_to_float(digits);
      Ok({ value: JsonNumber(num), parser: p3 })
    }
  }
}

function parse_array(p: Parser) -> ParseResult<JsonValue> {
  match consume(p, "[") {
    Err(e) -> Err(e),
    Ok(p2) -> {
      let p3 = skip_whitespace(p2);
      match peek(p3) {
        "]" -> Ok({ value: JsonArray([]), parser: advance(p3) }),
        _ -> parse_array_elements(p3, [])
      }
    }
  }
}

function parse_array_elements(p: Parser, acc: List<JsonValue>) -> ParseResult<JsonValue> {
  match parse_value(p) {
    Err(e) -> Err(e),
    Ok({ value, parser: p2 }) -> {
      let new_acc = acc ++ [value];
      let p3 = skip_whitespace(p2);
      match peek(p3) {
        "]" -> Ok({ value: JsonArray(new_acc), parser: advance(p3) }),
        "," -> parse_array_elements(skip_whitespace(advance(p3)), new_acc),
        _ -> Err({ message: "Expected ',' or ']'", line: p3.line, column: p3.col, context: "" })
      }
    }
  }
}

function parse_object(p: Parser) -> ParseResult<JsonValue> {
  // Similar to parse_array, but with key-value pairs
  // Requires Map<String, JsonValue>
}

// Parser helper functions
function peek(p: Parser) -> String {
  char_at(p.input, p.pos)
}

function advance(p: Parser) -> Parser {
  let ch = peek(p);
  match string_eq(ch, "\n") {
    True -> { input: p.input, pos: p.pos + 1, line: p.line + 1, col: 1 },
    False -> { input: p.input, pos: p.pos + 1, line: p.line, col: p.col + 1 }
  }
}

function is_at_end(p: Parser) -> Bool {
  p.pos >= string_length(p.input)
}

function consume(p: Parser, expected: String) -> Result<Parser, ParseError> {
  match string_eq(peek(p), expected) {
    True -> Ok(advance(p)),
    False -> Err({ message: "Expected '" ++ expected ++ "'", line: p.line, column: p.col, context: "" })
  }
}

function skip_whitespace(p: Parser) -> Parser {
  match is_at_end(p) {
    True -> p,
    False -> {
      let ch = peek(p);
      match is_whitespace(ch) {
        True -> skip_whitespace(advance(p)),
        False -> p
      }
    }
  }
}
```

## Learning Objectives

- Recursive descent parsing
- Parser combinators
- Error handling with context
- Character classification
- State management in parsers
- JSON specification

## Dependencies

- ❌ `char_code` for `is_digit`, `is_whitespace` (CRITICAL)
- ❌ `Map<K, V>` for JSON objects (CRITICAL)
- ⚠️ Better error types with source locations (DESIRABLE)
- ✅ `string_to_float` returns `Option<Float64>` (Some/None)

## Related Examples

- `03-string-processing` - Character-by-character processing
- `07-string-toolkit` - Character classification
- `20-expr-evaluator` - Another parser example

## Testing

```clarity
effect[Test] function test_parse_null() -> Unit {
  match parse_json("null") {
    Ok(JsonNull) -> assert_true(True),
    _ -> assert_true(False)
  }
}

effect[Test] function test_parse_string() -> Unit {
  match parse_json("\"hello\"") {
    Ok(JsonString(s)) -> assert_eq_string(s, "hello"),
    _ -> assert_true(False)
  }
}

effect[Test] function test_parse_array() -> Unit {
  match parse_json("[1, 2, 3]") {
    Ok(JsonArray(arr)) -> assert_eq(length(arr), 3),
    _ -> assert_true(False)
  }
}
```

## Impact on Language Design

Parsing is fundamental for:
- Configuration files
- API responses
- Protocol implementations
- DSLs

A good parser requires:
- Character classification (is_digit, is_alpha, etc.)
- Efficient string operations
- Good error messages with source locations
- Parser combinators or similar abstractions
