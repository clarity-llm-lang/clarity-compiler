# String Toolkit

**Status:** ✅ **IMPLEMENTED** (without case conversion)
**Complexity:** Intermediate
**Category:** String Manipulation, Text Processing

## Overview

A comprehensive toolkit for string manipulation demonstrating character operations, text validation, and transformations. Includes 13 tests covering various string operations.

**Note:** Case conversion (toUpperCase/toLowerCase) is not included as it would require extensive Unicode mapping tables which are impractical to implement by hand.

## What This Example Should Demonstrate

- String transformations (reverse, repeat, case conversion)
- Text validation (palindromes, pattern matching)
- Character classification (alphabetic, digit, whitespace)
- String analysis (searching, counting, finding)
- Option types for nullable results
- Tail-recursive string processing

## Why This Is Partially Blocked

### CRITICAL: Missing Character Code Operations

Current string operations:
- ✅ `char_at(s: String, i: Int64) -> String` - Get single-char string at index
- ✅ `string_eq(a: String, b: String) -> Bool` - String equality
- ✅ `string_length(s: String) -> Int64` - String length
- ✅ `substring(s: String, start: Int64, end: Int64) -> String` - Extract substring
- ✅ String concatenation with `++`

**Missing:**
- ❌ `char_code(ch: String) -> Int64` - Get ASCII/Unicode code point
- ❌ `char_from_code(code: Int64) -> String` - Create char from code point

**Problem:** Without char_code, case conversion requires checking every character against 52 string literals!

### Current Workaround (IMPRACTICAL)

```clarity
function to_uppercase_char(ch: String) -> String {
  match string_eq(ch, "a") { True -> "A", False ->
  match string_eq(ch, "b") { True -> "B", False ->
  match string_eq(ch, "c") { True -> "C", False ->
  match string_eq(ch, "d") { True -> "D", False ->
  match string_eq(ch, "e") { True -> "E", False ->
  match string_eq(ch, "f") { True -> "F", False ->
  match string_eq(ch, "g") { True -> "G", False ->
  match string_eq(ch, "h") { True -> "H", False ->
  match string_eq(ch, "i") { True -> "I", False ->
  match string_eq(ch, "j") { True -> "J", False ->
  // ... 16 more letters ...
  match string_eq(ch, "z") { True -> "Z", False -> ch }}}}}}}}}
  // 26 nested matches!
}
```

**This is:**
- 🚫 Extremely verbose and error-prone
- 🚫 Hard to maintain
- 🚫 Doesn't handle non-ASCII characters
- 🚫 Not the right way to demonstrate language features

## Required Language Features

### Character Code Operations

```clarity
// Get Unicode/ASCII code point
function char_code(ch: String) -> Int64

// Create character from code point
function char_from_code(code: Int64) -> String

// Example:
let code_a = char_code("a")  // 97
let code_A = char_code("A")  // 65
let letter = char_from_code(65)  // "A"
```

### String Splitting (Also Needed)

```clarity
// Split string by delimiter
function string_split(s: String, delimiter: String) -> List<String>

// Example:
let words = string_split("hello,world,foo", ",")  // ["hello", "world", "foo"]
```

## Ideal Implementation (with char_code)

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

## What Can Be Implemented NOW vs LATER

### ✅ Can Implement Now (Without char_code):
- reverse_string
- repeat
- is_palindrome
- contains, starts_with, ends_with
- count_char, find_char
- trim, trim_left, trim_right

### ❌ Blocked by Missing char_code:
- to_uppercase, to_lowercase
- is_uppercase, is_lowercase, is_alphabetic
- is_digit, is_alphanumeric
- Any character classification based on code ranges

## Usage (once implemented)

```bash
# Compile
npx clarityc compile examples/07-string-toolkit/strings.clarity --check-only

# Run tests
npx clarityc test examples/07-string-toolkit/strings.clarity

# Run individual functions
npx clarityc run examples/07-string-toolkit/strings.clarity -f reverse_string -a '"hello"'
npx clarityc run examples/07-string-toolkit/strings.clarity -f is_palindrome -a '"racecar"'
npx clarityc run examples/07-string-toolkit/strings.clarity -f to_uppercase -a '"hello world"'
```

## Dependencies for Implementation

**Critical (blocking case conversion):**
1. ❌ `char_code(ch: String) -> Int64` - Get character code point
2. ❌ `char_from_code(code: Int64) -> String` - Create char from code

**Highly desirable (makes implementation cleaner):**
3. ⚠️ `string_split(s: String, delimiter: String) -> List<String>` - Split by delimiter

## Learning Objectives

Once implemented, studying this example will teach:

1. Character-by-character string processing with recursion
2. Using Option types for nullable results
3. Tail-recursive accumulator pattern for string building
4. Character classification and ASCII code ranges
5. String validation and pattern matching
6. Whitespace handling
7. Performance considerations (string concatenation in loops)

## Related Examples

- `03-string-processing` - String processing with recursion
- `09-csv-processor` - More advanced string parsing (needs string_split)
- `19-json-parser` - Complex string parsing and validation

## Impact on Language Design

**Character code operations are fundamental for text processing.** Almost every programming language provides:
- C: `char c = 'A';` gives ASCII code 65
- Python: `ord('A')` → 65, `chr(65)` → 'A'
- JavaScript: `'A'.charCodeAt(0)` → 65, `String.fromCharCode(65)` → 'A'
- Rust: `'A' as u32` → 65, `char::from_u32(65)` → Some('A')

Without these operations, string manipulation is severely limited.

**Recommendation:** Add `char_code` and `char_from_code` as built-in functions. These are critical for:
- Case conversion
- Character validation
- Text parsing
- CSV/JSON parsing
- Any domain involving character classification

## Alternative Approaches Considered

### Approach 1: Add built-in case conversion functions
```clarity
function to_uppercase(s: String) -> String  // Built-in
function to_lowercase(s: String) -> String  // Built-in
```

**Problem:** This doesn't help with character classification (is_digit, is_alphabetic), which also needs char codes.

### Approach 2: Add character classification functions
```clarity
function is_uppercase(ch: String) -> Bool   // Built-in
function is_lowercase(ch: String) -> Bool   // Built-in
function is_digit(ch: String) -> Bool       // Built-in
```

**Problem:** Still need char_code for custom character ranges, Unicode handling, etc.

### Approach 3: Add char_code + char_from_code (RECOMMENDED)
```clarity
function char_code(ch: String) -> Int64
function char_from_code(code: Int64) -> String
```

**Benefits:**
- Enables all character operations
- Universal solution (works for any character set)
- Minimal API surface (just 2 functions)
- Users can build their own abstractions
- Matches every other programming language

## Next Steps

**Implementation priority: MEDIUM-HIGH**

Can partially implement now (reverse, palindrome, contains, etc.), but save until char_code is available for complete implementation.

**Recommendation:** Add char_code/char_from_code built-ins first, then implement this example to showcase string manipulation capabilities.
