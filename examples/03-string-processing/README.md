# String Processing with I/O

**Complexity:** Intermediate
**Category:** Text Processing, Effects

## Description

A word counter that reads from stdin and prints statistics. This example demonstrates tail-recursive string processing, I/O effects, and the accumulator pattern for efficient recursion.

## What This Example Demonstrates

- **Effects system** (`FileSystem`, `Log`)
- **Reading from stdin** (`read_all_stdin`)
- **String operations** (length, char_at, equality, concatenation)
- **Tail recursion** with accumulator pattern
- **Character-by-character processing**
- **Multi-effect functions** (combining FileSystem + Log)

## Features Used

- **Language Features:**
  - Effect declarations (`effect[FileSystem, Log]`)
  - Tail-recursive functions
  - Accumulator pattern
  - String operations

- **Built-in Functions:**
  - `read_all_stdin() -> String` (FileSystem)
  - `string_length(s: String) -> Int64`
  - `char_at(s: String, i: Int64) -> String`
  - `string_eq(a: String, b: String) -> Bool`
  - `print_string(s: String) -> Unit` (Log)
  - `int_to_string(n: Int64) -> String`
  - String concatenation operator `++`

- **Effects:** `FileSystem`, `Log`

## Usage

### Compile

```bash
npx clarityc compile examples/03-string-processing/wordcount.clarity
```

### Run with input

```bash
# Pipe text to the program
echo "hello world foo bar" | npx clarityc run examples/03-string-processing/wordcount.clarity -f count_words

# Process a file
cat myfile.txt | npx clarityc run examples/03-string-processing/wordcount.clarity -f count_words

# Multi-line input
printf "hello world\nfoo bar\nbaz" | npx clarityc run examples/03-string-processing/wordcount.clarity -f count_words
```

### Example output

```
lines: 0
words: 4
chars: 19
```

## Code Walkthrough

### Tail Recursion with Accumulator

```clarity
function count_separators(s: String, i: Int64, acc: Int64) -> Int64 {
  match i >= string_length(s) {
    True -> acc,    // Base case: reached end, return accumulator
    False -> {
      let ch = char_at(s, i);
      let is_space = string_eq(ch, " ");
      let is_newline = string_eq(ch, "\n");
      let next = match is_space or is_newline {
        True -> acc + 1,    // Found separator, increment
        False -> acc        // Not a separator, keep acc
      };
      count_separators(s, i + 1, next)  // Tail call: recurse with next index
    }
  }
}
```

**Accumulator pattern:**
- Parameter `acc` accumulates the result as we recurse
- Each recursive call passes `acc + 1` or `acc` depending on condition
- Final call returns `acc` directly (base case)
- Tail-call optimized to a loop (no stack growth)

### Effects in Clarity

Functions that perform I/O must declare their effects:

```clarity
effect[FileSystem, Log] function count_words() -> Unit {
  let input = read_all_stdin();    // Requires FileSystem effect
  let chars = string_length(input);
  let lines = count_lines(input, 0, 0);
  let words = match chars > 0 {
    True -> count_separators(input, 0, 0) + 1,
    False -> 0
  };
  print_string("lines: " ++ int_to_string(lines));   // Requires Log effect
  print_string("words: " ++ int_to_string(words));
  print_string("chars: " ++ int_to_string(chars))
}
```

**Effect types:**
- `FileSystem` - File I/O, stdin/stdout, command-line args
- `Log` - Printing to stdout/stderr
- `DB` - Database operations (built-ins TBD)
- `Network` - HTTP and network operations (built-ins TBD)
- `Random` - Random number generation (built-ins TBD)
- `Time` - Current time and timestamps (built-ins TBD)
- `Test` - Test assertions

## String Operations

### Character Access

```clarity
let ch = char_at(s, i)  // Get character at index i (returns single-char String)
```

### String Comparison

```clarity
let is_eq = string_eq(s1, s2)  // True if strings are equal
```

### String Concatenation

```clarity
let result = "hello" ++ " " ++ "world"  // "hello world"
```

### String Length

```clarity
let len = string_length(s)  // Number of characters
```

## Learning Objectives

After studying this example, you should understand:

1. How to declare and use effects in Clarity
2. The accumulator pattern for efficient tail recursion
3. How to process strings character-by-character
4. How to read from stdin and print to stdout
5. String operations and concatenation with `++`
6. Why tail recursion is important (no stack overflow)

## Tail Recursion vs Tree Recursion

**Tree recursion** (fibonacci): Each call spawns multiple recursive calls
- Exponential time complexity
- Stack grows with recursion depth
- Not optimized

**Tail recursion** (wordcount): Last operation is the recursive call
- Linear time complexity
- Optimized to loops (no stack growth)
- Can process infinite streams

## Next Steps

- See `04-file-io` to learn file reading and writing
- Explore `05-sudoku-solver` requirements for advanced algorithms
- Study `07-string-toolkit` requirements for comprehensive string operations
