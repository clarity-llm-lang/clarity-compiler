# Hello World - Basic Arithmetic

**Complexity:** Beginner
**Category:** Fundamentals

## Description

The simplest Clarity program demonstrating pure functions and basic arithmetic operations. This is your starting point for learning Clarity.

## What This Example Demonstrates

- **Pure functions** (no side effects, no effects required)
- **Function declarations** with type signatures
- **Basic arithmetic operators** (`+`, `*`)
- **Int64 type** (64-bit integers)
- **Function composition** (one function calling another)

## Features Used

- **Language Features:**
  - Function declarations
  - Type annotations
  - Basic arithmetic expressions
  - Return values

- **Built-in Functions:** None (uses only primitive operators)

- **Effects:** None (pure functions)

## Usage

### Compile

```bash
npx clarityc compile examples/01-hello-world/hello.clarity
```

### Type-check only

```bash
npx clarityc compile examples/01-hello-world/hello.clarity --check-only
```

### Run individual functions

```bash
# Calculate 5 + 3
npx clarityc run examples/01-hello-world/hello.clarity -f add -a 5 3

# Calculate 4 * 6
npx clarityc run examples/01-hello-world/hello.clarity -f multiply -a 4 6

# Calculate square of 7
npx clarityc run examples/01-hello-world/hello.clarity -f square -a 7
```

## Code Walkthrough

```clarity
module Hello

// Simple addition: takes two Int64, returns their sum
function add(a: Int64, b: Int64) -> Int64 {
  a + b
}

// Simple multiplication: takes two Int64, returns their product
function multiply(a: Int64, b: Int64) -> Int64 {
  a * b
}

// Composition example: square calls multiply
function square(n: Int64) -> Int64 {
  multiply(n, n)
}
```

## Learning Objectives

After studying this example, you should understand:

1. How to declare a Clarity module
2. How to write pure functions with type signatures
3. How to use basic arithmetic operators
4. How function composition works in Clarity
5. How to compile and run Clarity programs

## Next Steps

- Move to `02-recursion` to learn pattern matching and recursive functions
- See how Clarity replaces loops with recursion
- Understand the `match` expression for control flow
