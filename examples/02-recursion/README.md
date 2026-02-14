# Recursion and Pattern Matching

**Complexity:** Beginner → Intermediate
**Category:** Fundamentals

## Description

Learn recursion and pattern matching in Clarity through classic algorithms. This example demonstrates how Clarity replaces loops with recursion and uses `match` expressions for control flow.

## What This Example Demonstrates

- **Recursive function calls** (fibonacci)
- **Pattern matching** with `match` expressions
- **Boolean conditions** in match
- **Multiple recursive calls** (fibonacci tree recursion)
- **Let bindings** for intermediate values

## Features Used

- **Language Features:**
  - Recursion (function calling itself)
  - `match` expressions for control flow
  - Boolean comparisons (`<=`, `>=`)
  - Let bindings
  - Arithmetic operators

- **Built-in Functions:** None (pure computation)

- **Effects:** None (pure functions)

## Usage

### Compile

```bash
npx clarityc compile examples/02-recursion/fibonacci.clarity
```

### Run examples

```bash
# Calculate 10th Fibonacci number
npx clarityc run examples/02-recursion/fibonacci.clarity -f fibonacci -a 10

# Calculate absolute value of -42
npx clarityc run examples/02-recursion/fibonacci.clarity -f abs -a -42

# Find maximum of 15 and 23
npx clarityc run examples/02-recursion/fibonacci.clarity -f max -a 15 23
```

## Code Walkthrough

### Fibonacci (Classic Tree Recursion)

```clarity
function fibonacci(n: Int64) -> Int64 {
  match n <= 1 {
    True -> n,              // Base case: fib(0) = 0, fib(1) = 1
    False -> {
      let a = fibonacci(n - 1);   // Recursive call 1
      let b = fibonacci(n - 2);   // Recursive call 2
      a + b                       // Return sum
    }
  }
}
```

**How it works:**
- Base case: n ≤ 1 returns n directly
- Recursive case: compute fibonacci(n-1) + fibonacci(n-2)
- Tree recursion: each call spawns two more calls

### Absolute Value (Simple Pattern Match)

```clarity
function abs(n: Int64) -> Int64 {
  match n >= 0 {
    True -> n,        // Positive: return as-is
    False -> 0 - n    // Negative: negate it
  }
}
```

### Maximum (Comparison with Match)

```clarity
function max(a: Int64, b: Int64) -> Int64 {
  match a >= b {
    True -> a,
    False -> b
  }
}
```

## Pattern Matching in Clarity

Clarity uses `match` expressions instead of `if/else`:

```clarity
match condition {
  True -> value_if_true,
  False -> value_if_false
}
```

For multi-line branches, use curly braces:

```clarity
match condition {
  True -> {
    let x = compute_something();
    x + 1
  },
  False -> 0
}
```

## Recursion vs Loops

Clarity has **no loops** (`for`, `while`). Instead, use recursion:

**Iterative (other languages):**
```javascript
let result = 1;
for (let i = 1; i <= n; i++) {
  result = result * i;
}
```

**Recursive (Clarity):**
```clarity
function factorial(n: Int64) -> Int64 {
  match n <= 1 {
    True -> 1,
    False -> n * factorial(n - 1)
  }
}
```

## Learning Objectives

After studying this example, you should understand:

1. How to write recursive functions in Clarity
2. How to use `match` expressions for control flow
3. The difference between base cases and recursive cases
4. How tree recursion works (fibonacci)
5. How Clarity replaces loops with recursion

## Performance Note

The naive fibonacci implementation has exponential time complexity O(2^n). For better performance, use tail-recursive accumulator patterns (see `03-string-processing/wordcount.clarity` for examples).

## Next Steps

- Study `03-string-processing` to see tail-recursive accumulator patterns
- Learn about effects (FileSystem, Log) and I/O operations
- See how to process strings character-by-character with recursion
