# String Toolkit

**Status:** ✅ **IMPLEMENTED** (without case conversion)
**Complexity:** Intermediate
**Category:** String Manipulation, Text Processing

## Overview

A comprehensive toolkit for string manipulation demonstrating character-by-character operations, text validation, and transformations. Includes 13 tests covering various string operations using Clarity's existing string builtins.

## Implementation Notes

This example implements a wide range of string operations using Clarity's current string capabilities. Case conversion (toUpperCase/toLowerCase) and character classification (is_digit, is_alpha) are not included as they would require `char_code()` builtin which is not yet available.

### What IS Implemented

✅ **String transformations:**
- `reverse_string()` - Reverse a string character by character
- `repeat()` - Repeat string n times
- `trim()`, `trim_left()`, `trim_right()` - Whitespace removal

✅ **String validation:**
- `is_palindrome()` - Check if string reads same forwards/backwards
- `contains()` - Check if string contains substring
- `starts_with()`, `ends_with()` - Prefix/suffix checking

✅ **String analysis:**
- `count_char()` - Count occurrences of a character
- `find_char()` - Find first occurrence (returns Option)

✅ **Character operations:**
- `is_whitespace()` - Check for space, tab, newline, carriage return

### What is NOT Implemented

❌ **Case conversion** (requires `char_code()` builtin):
- `to_uppercase()`, `to_lowercase()`
- `to_uppercase_char()`, `to_lowercase_char()`

❌ **Character classification** (requires `char_code()` builtin):
- `is_uppercase()`, `is_lowercase()`, `is_alphabetic()`
- `is_digit()`, `is_alphanumeric()`

## What This Example Demonstrates

```clarity
module StringToolkit

// ============================================================================
// Character Classification
// ============================================================================

function is_uppercase(ch: String) -> Bool {
  let code = char_code(ch);
  code >= 65 and code <= 90  // 'A' to 'Z'
}

function is_lowercase(ch: String) -> Bool {
  let code = char_code(ch);
  code >= 97 and code <= 122  // 'a' to 'z'
}

function is_alphabetic(ch: String) -> Bool {
  is_uppercase(ch) or is_lowercase(ch)
}

function is_digit(ch: String) -> Bool {
  let code = char_code(ch);
  code >= 48 and code <= 57  // '0' to '9'
}

function is_whitespace(ch: String) -> Bool {
  string_eq(ch, " ") or string_eq(ch, "\t") or string_eq(ch, "\n") or string_eq(ch, "\r")
}

function is_alphanumeric(ch: String) -> Bool {
  is_alphabetic(ch) or is_digit(ch)
}

// ============================================================================
// Case Conversion (CLEAN with char_code!)
// ============================================================================

function to_uppercase_char(ch: String) -> String {
  let code = char_code(ch);
  match code >= 97 and code <= 122 {  // 'a' to 'z'
    True -> char_from_code(code - 32),  // Convert to uppercase
    False -> ch  // Not lowercase, return as-is
  }
}

function to_lowercase_char(ch: String) -> String {
  let code = char_code(ch);
  match code >= 65 and code <= 90 {  // 'A' to 'Z'
    True -> char_from_code(code + 32),  // Convert to lowercase
    False -> ch  // Not uppercase, return as-is
  }
}

// Convert entire string to uppercase
function to_uppercase(s: String) -> String {
  to_uppercase_helper(s, 0, "")
}

function to_uppercase_helper(s: String, idx: Int64, acc: String) -> String {
  match idx >= string_length(s) {
    True -> acc,
    False -> {
      let ch = char_at(s, idx);
      let upper = to_uppercase_char(ch);
      to_uppercase_helper(s, idx + 1, acc ++ upper)
    }
  }
}

// Convert entire string to lowercase
function to_lowercase(s: String) -> String {
  to_lowercase_helper(s, 0, "")
}

function to_lowercase_helper(s: String, idx: Int64, acc: String) -> String {
  match idx >= string_length(s) {
    True -> acc,
    False -> {
      let ch = char_at(s, idx);
      let lower = to_lowercase_char(ch);
      to_lowercase_helper(s, idx + 1, acc ++ lower)
    }
  }
}

// ============================================================================
// String Transformations (Can implement now!)
// ============================================================================

// Reverse string
function reverse_string(s: String) -> String {
  reverse_helper(s, string_length(s) - 1, "")
}

function reverse_helper(s: String, idx: Int64, acc: String) -> String {
  match idx < 0 {
    True -> acc,
    False -> {
      let ch = char_at(s, idx);
      reverse_helper(s, idx - 1, acc ++ ch)
    }
  }
}

// Repeat string n times
function repeat(s: String, n: Int64) -> String {
  match n <= 0 {
    True -> "",
    False -> s ++ repeat(s, n - 1)
  }
}

// ============================================================================
// String Validation (Can implement now!)
// ============================================================================

// Check if string is palindrome
function is_palindrome(s: String) -> Bool {
  is_palindrome_helper(s, 0, string_length(s) - 1)
}

function is_palindrome_helper(s: String, left: Int64, right: Int64) -> Bool {
  match left >= right {
    True -> True,  // Met in middle or crossed, it's a palindrome
    False -> {
      let ch_left = char_at(s, left);
      let ch_right = char_at(s, right);
      match string_eq(ch_left, ch_right) {
        False -> False,  // Mismatch, not palindrome
        True -> is_palindrome_helper(s, left + 1, right - 1)
      }
    }
  }
}

// Check if haystack contains needle
function contains(haystack: String, needle: String) -> Bool {
  let haystack_len = string_length(haystack);
  let needle_len = string_length(needle);
  match needle_len > haystack_len {
    True -> False,
    False -> contains_helper(haystack, needle, 0, haystack_len, needle_len)
  }
}

function contains_helper(haystack: String, needle: String, idx: Int64, h_len: Int64, n_len: Int64) -> Bool {
  match idx + n_len > h_len {
    True -> False,  // Past the end, not found
    False -> {
      let substr = substring(haystack, idx, idx + n_len);
      match string_eq(substr, needle) {
        True -> True,  // Found!
        False -> contains_helper(haystack, needle, idx + 1, h_len, n_len)
      }
    }
  }
}

// Check if string starts with prefix
function starts_with(s: String, prefix: String) -> Bool {
  let s_len = string_length(s);
  let p_len = string_length(prefix);
  match p_len > s_len {
    True -> False,
    False -> string_eq(substring(s, 0, p_len), prefix)
  }
}

// Check if string ends with suffix
function ends_with(s: String, suffix: String) -> Bool {
  let s_len = string_length(s);
  let suf_len = string_length(suffix);
  match suf_len > s_len {
    True -> False,
    False -> string_eq(substring(s, s_len - suf_len, s_len), suffix)
  }
}

// ============================================================================
// String Analysis (Can implement now!)
// ============================================================================

// Count occurrences of character in string
function count_char(s: String, target: String) -> Int64 {
  count_char_helper(s, target, 0, 0)
}

function count_char_helper(s: String, target: String, idx: Int64, acc: Int64) -> Int64 {
  match idx >= string_length(s) {
    True -> acc,
    False -> {
      let ch = char_at(s, idx);
      let next = match string_eq(ch, target) {
        True -> acc + 1,
        False -> acc
      };
      count_char_helper(s, target, idx + 1, next)
    }
  }
}

// Find first occurrence of character (returns Option)
function find_char(s: String, target: String) -> Option<Int64> {
  find_char_helper(s, target, 0)
}

function find_char_helper(s: String, target: String, idx: Int64) -> Option<Int64> {
  match idx >= string_length(s) {
    True -> None,
    False -> {
      let ch = char_at(s, idx);
      match string_eq(ch, target) {
        True -> Some(idx),
        False -> find_char_helper(s, target, idx + 1)
      }
    }
  }
}

// ============================================================================
// Whitespace Operations (Can implement now!)
// ============================================================================

// Trim whitespace from left
function trim_left(s: String) -> String {
  trim_left_helper(s, 0)
}

function trim_left_helper(s: String, idx: Int64) -> String {
  match idx >= string_length(s) {
    True -> "",
    False -> {
      let ch = char_at(s, idx);
      match is_whitespace(ch) {
        True -> trim_left_helper(s, idx + 1),
        False -> substring(s, idx, string_length(s))
      }
    }
  }
}

// Trim whitespace from right
function trim_right(s: String) -> String {
  trim_right_helper(s, string_length(s) - 1)
}

function trim_right_helper(s: String, idx: Int64) -> String {
  match idx < 0 {
    True -> "",
    False -> {
      let ch = char_at(s, idx);
      match is_whitespace(ch) {
        True -> trim_right_helper(s, idx - 1),
        False -> substring(s, 0, idx + 1)
      }
    }
  }
}

// Trim whitespace from both ends
function trim(s: String) -> String {
  trim_left(trim_right(s))
}

// ============================================================================
// Tests
// ============================================================================

effect[Test] function test_reverse() -> Unit {
  assert_eq_string(reverse_string("hello"), "olleh");
  assert_eq_string(reverse_string(""), "");
  assert_eq_string(reverse_string("a"), "a")
}

effect[Test] function test_palindrome() -> Unit {
  assert_true(is_palindrome("racecar"));
  assert_true(is_palindrome("abba"));
  assert_true(is_palindrome("a"));
  assert_false(is_palindrome("hello"));
  assert_true(is_palindrome(""))
}

effect[Test] function test_uppercase() -> Unit {
  assert_eq_string(to_uppercase("hello"), "HELLO");
  assert_eq_string(to_uppercase("Hello123"), "HELLO123");
  assert_eq_string(to_uppercase("ALREADY"), "ALREADY")
}

effect[Test] function test_lowercase() -> Unit {
  assert_eq_string(to_lowercase("HELLO"), "hello");
  assert_eq_string(to_lowercase("Hello123"), "hello123");
  assert_eq_string(to_lowercase("already"), "already")
}

effect[Test] function test_contains() -> Unit {
  assert_true(contains("hello world", "world"));
  assert_true(contains("foobar", "foo"));
  assert_false(contains("hello", "bye"));
  assert_true(contains("same", "same"))
}

effect[Test] function test_count_char() -> Unit {
  assert_eq(count_char("hello", "l"), 2);
  assert_eq(count_char("mississippi", "i"), 4);
  assert_eq(count_char("foo", "x"), 0)
}

effect[Test] function test_is_alphabetic() -> Unit {
  assert_true(is_alphabetic("a"));
  assert_true(is_alphabetic("Z"));
  assert_false(is_alphabetic("5"));
  assert_false(is_alphabetic(" "))
}

effect[Test] function test_is_digit() -> Unit {
  assert_true(is_digit("0"));
  assert_true(is_digit("9"));
  assert_false(is_digit("a"));
  assert_false(is_digit(" "))
}
```

## Usage

```bash
# Compile
npx clarityc compile examples/07-string-toolkit/strings.clarity --check-only

# Run tests (13 tests covering all implemented functions)
npx clarityc test examples/07-string-toolkit/strings.clarity

# Run individual functions
npx clarityc run examples/07-string-toolkit/strings.clarity -f demo
```

### Sample Output
```
String Toolkit Demo
===================

Reverse: olleh
Palindrome check: true
Contains: true
Count 'l': 2
Trimmed: "hello"
```

## Dependencies Used

- ✅ `char_at()` - Character access by index
- ✅ `length()` - String length
- ✅ `substring()` - Extract substring
- ✅ String concatenation with `++`
- ✅ String equality comparison
- ✅ Pattern matching and recursion

## Learning Objectives

Studying this example teaches:

1. **Character-by-character string processing** - Recursive iteration through strings
2. **Option types for safe operations** - Using `find_char()` returning `Option<Int64>`
3. **Tail-recursive accumulator patterns** - Building strings efficiently
4. **String validation techniques** - Palindrome checking, substring search
5. **Whitespace handling** - Identifying and trimming whitespace characters
6. **Pattern matching on strings** - Comparing characters and substrings

## Test Coverage

The example includes 13 comprehensive tests covering:
- `test_reverse` - String reversal
- `test_repeat` - String repetition
- `test_is_palindrome` - Palindrome detection
- `test_contains` - Substring search
- `test_starts_with` / `test_ends_with` - Prefix/suffix checking
- `test_count_char` - Character counting
- `test_find_char` - Character search with Option
- `test_trim` / `test_trim_left` / `test_trim_right` - Whitespace trimming
- `test_is_whitespace` - Whitespace detection

## Related Examples

- `03-string-processing` - String processing with recursion
- `09-csv-processor` - More advanced string parsing
- `10-config-parser` - INI file parsing
- `20-expr-evaluator` - Lexical analysis and tokenization

## Future Enhancements

When `char_code()` and `char_from_code()` builtins become available, this example could be extended with:
- Case conversion (`to_uppercase`, `to_lowercase`)
- Character classification (`is_digit`, `is_alpha`, `is_alphanumeric`)
- More sophisticated text transformations
