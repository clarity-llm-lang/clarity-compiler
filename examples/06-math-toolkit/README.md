# Math Toolkit

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Intermediate
**Category:** Mathematics, Algorithms

## Overview

A comprehensive collection of mathematical functions demonstrating pure functional programming, recursion patterns, and numeric computations in Clarity. Includes 16 test functions covering integer math, floating-point geometry, and list operations.

## What This Example Should Demonstrate

- Pure mathematical functions (no effects)
- Recursive algorithms (factorial, gcd, fibonacci)
- Both Int64 and Float64 operations
- Type conversions between numeric types
- Tail recursion for performance
- List processing with numeric data
- Comprehensive test suite with effect[Test]

## Why This CAN Be Implemented Now

All required built-ins exist:
- ✅ Arithmetic operators (`+`, `-`, `*`, `/`, `%`)
- ✅ Comparison operators (`<`, `>`, `<=`, `>=`, `==`)
- ✅ Math functions: `sqrt`, `pow`, `floor`, `ceil`, `abs_int`, `min_int`, `max_int`
- ✅ Type conversions: `int_to_float`, `float_to_int`
- ✅ List operations: `head`, `tail`, `append`, `length`
- ✅ Test assertions: `assert_eq`, `assert_eq_float`, `assert_true`, `assert_false`
- ✅ Recursion and pattern matching

**No workarounds needed!** This example can be fully implemented elegantly.

## Planned Functions

### Integer Mathematics

```clarity
// Factorial: n! = n × (n-1) × ... × 2 × 1
function factorial(n: Int64) -> Int64 {
  match n <= 1 {
    True -> 1,
    False -> n * factorial(n - 1)
  }
}

// Greatest Common Divisor (Euclidean algorithm)
function gcd(a: Int64, b: Int64) -> Int64 {
  match b == 0 {
    True -> a,
    False -> gcd(b, a % b)
  }
}

// Least Common Multiple
function lcm(a: Int64, b: Int64) -> Int64 {
  (a * b) / gcd(a, b)
}

// Check if n is prime (trial division)
function is_prime(n: Int64) -> Bool {
  match n <= 1 {
    True -> False,
    False -> match n <= 3 {
      True -> True,
      False -> is_prime_helper(n, 2)
    }
  }
}

function is_prime_helper(n: Int64, divisor: Int64) -> Bool {
  match divisor * divisor > n {
    True -> True,  // No divisor found, n is prime
    False -> match n % divisor == 0 {
      True -> False,  // Found divisor, not prime
      False -> is_prime_helper(n, divisor + 1)
    }
  }
}

// Integer exponentiation: base^exp
function power(base: Int64, exp: Int64) -> Int64 {
  match exp <= 0 {
    True -> 1,
    False -> base * power(base, exp - 1)
  }
}

// Nth Fibonacci number (0, 1, 1, 2, 3, 5, 8, ...)
function nth_fibonacci(n: Int64) -> Int64 {
  match n <= 1 {
    True -> n,
    False -> nth_fibonacci(n - 1) + nth_fibonacci(n - 2)
  }
}

// Efficient tail-recursive fibonacci
function fib_fast(n: Int64) -> Int64 {
  fib_helper(n, 0, 1)
}

function fib_helper(n: Int64, a: Int64, b: Int64) -> Int64 {
  match n == 0 {
    True -> a,
    False -> fib_helper(n - 1, b, a + b)
  }
}
```

### Float Mathematics

```clarity
// Euclidean distance between two points
function distance(x1: Float64, y1: Float64, x2: Float64, y2: Float64) -> Float64 {
  let dx = x2 - x1;
  let dy = y2 - y1;
  sqrt(dx * dx + dy * dy)
}

// Hypotenuse of right triangle (Pythagorean theorem)
function hypotenuse(a: Float64, b: Float64) -> Float64 {
  sqrt(a * a + b * b)
}

// Area of circle: π r²
function circle_area(radius: Float64) -> Float64 {
  let pi = 3.141592653589793;
  pi * radius * radius
}

// Area of triangle using Heron's formula
function triangle_area(a: Float64, b: Float64, c: Float64) -> Float64 {
  let s = (a + b + c) / 2.0;  // Semi-perimeter
  sqrt(s * (s - a) * (s - b) * (s - c))
}
```

### List Operations

```clarity
// Sum of list (tail-recursive)
function sum_list(values: List<Int64>) -> Int64 {
  sum_helper(values, 0)
}

function sum_helper(values: List<Int64>, acc: Int64) -> Int64 {
  match length(values) == 0 {
    True -> acc,
    False -> {
      let first = head(values);
      let rest = tail(values);
      sum_helper(rest, acc + first)
    }
  }
}

// Mean (average) of list
function mean(values: List<Int64>) -> Float64 {
  let sum = sum_list(values);
  let count = length(values);
  int_to_float(sum) / int_to_float(count)
}

// Product of list
function product_list(values: List<Int64>) -> Int64 {
  product_helper(values, 1)
}

function product_helper(values: List<Int64>, acc: Int64) -> Int64 {
  match length(values) == 0 {
    True -> acc,
    False -> {
      let first = head(values);
      let rest = tail(values);
      product_helper(rest, acc * first)
    }
  }
}
```

### Test Suite

```clarity
effect[Test] function test_factorial() -> Unit {
  assert_eq(factorial(0), 1);
  assert_eq(factorial(1), 1);
  assert_eq(factorial(5), 120);
  assert_eq(factorial(10), 3628800)
}

effect[Test] function test_gcd() -> Unit {
  assert_eq(gcd(48, 18), 6);
  assert_eq(gcd(100, 50), 50);
  assert_eq(gcd(17, 13), 1)
}

effect[Test] function test_lcm() -> Unit {
  assert_eq(lcm(4, 6), 12);
  assert_eq(lcm(21, 6), 42)
}

effect[Test] function test_is_prime() -> Unit {
  assert_false(is_prime(1));
  assert_true(is_prime(2));
  assert_true(is_prime(17));
  assert_false(is_prime(18));
  assert_true(is_prime(97));
  assert_false(is_prime(100))
}

effect[Test] function test_power() -> Unit {
  assert_eq(power(2, 0), 1);
  assert_eq(power(2, 10), 1024);
  assert_eq(power(5, 3), 125)
}

effect[Test] function test_distance() -> Unit {
  assert_eq_float(distance(0.0, 0.0, 3.0, 4.0), 5.0);
  assert_eq_float(distance(1.0, 1.0, 4.0, 5.0), 5.0)
}

effect[Test] function test_circle_area() -> Unit {
  let pi = 3.141592653589793;
  assert_eq_float(circle_area(1.0), pi);
  assert_eq_float(circle_area(2.0), pi * 4.0)
}

effect[Test] function test_sum_list() -> Unit {
  let nums = [1, 2, 3, 4, 5];  // Assuming list literals work
  assert_eq(sum_list(nums), 15)
}

effect[Test] function test_mean() -> Unit {
  let nums = [2, 4, 6, 8, 10];
  assert_eq_float(mean(nums), 6.0)
}
```

## Usage (once implemented)

```bash
# Compile
npx clarityc compile examples/06-math-toolkit/math.clarity --check-only

# Run tests
npx clarityc test examples/06-math-toolkit/math.clarity

# Run individual functions
npx clarityc run examples/06-math-toolkit/math.clarity -f factorial -a 10
npx clarityc run examples/06-math-toolkit/math.clarity -f is_prime -a 97
npx clarityc run examples/06-math-toolkit/math.clarity -f gcd -a 48 18
```

## Dependencies for Implementation

✅ **All dependencies available!**

Optional improvements that would make implementation nicer:
- ⚠️ **List literals** - `[1, 2, 3]` syntax (currently might need to build with append)
- ⚠️ **Constants** - `const pi: Float64 = 3.14159...` (currently use let)
- ⚠️ **Better integer division** - Currently `/` truncates, might want separate operator

## Learning Objectives

Once implemented, studying this example will teach:

1. Pure functional programming (no side effects)
2. Classic recursive algorithms (factorial, fibonacci, gcd)
3. Tail recursion for performance (sum_list, fib_fast)
4. Working with both Int64 and Float64
5. Type conversions between numeric types
6. List processing with recursion
7. Test-driven development with effect[Test]
8. Mathematical algorithms and proofs
9. Performance trade-offs (naive vs tail-recursive fibonacci)

## Algorithms Explained

### Greatest Common Divisor (Euclidean Algorithm)

```
gcd(48, 18):
  48 % 18 = 12  -> gcd(18, 12)
  18 % 12 = 6   -> gcd(12, 6)
  12 % 6 = 0    -> gcd(6, 0)
  b == 0        -> return 6
```

### Prime Checking (Trial Division)

```
is_prime(17):
  Check divisors 2, 3, 4, ...
  Stop when divisor² > 17 (i.e., divisor > 4)
  17 % 2 ≠ 0, 17 % 3 ≠ 0, 17 % 4 ≠ 0
  No divisor found -> 17 is prime
```

### Tail Recursion Optimization

**Naive fibonacci (exponential time):**
```clarity
fib(5) = fib(4) + fib(3)
       = (fib(3) + fib(2)) + (fib(2) + fib(1))
       = ... (many redundant calculations)
```

**Tail-recursive fibonacci (linear time):**
```clarity
fib_fast(5) = fib_helper(5, 0, 1)
            = fib_helper(4, 1, 1)
            = fib_helper(3, 1, 2)
            = fib_helper(2, 2, 3)
            = fib_helper(1, 3, 5)
            = fib_helper(0, 5, 8)
            = 5
```

Each step just updates accumulators, no tree of recursive calls!

## Related Examples

- `01-hello-world` - Basic arithmetic
- `02-recursion` - Recursion fundamentals
- `03-string-processing` - Tail recursion with accumulators
- `17-linear-regression` - Advanced numerical computing

## Impact on Language Design

This example shows that Clarity's current feature set is sufficient for many pure computational tasks. The main improvements would be:

1. **List literals** - `[1, 2, 3]` instead of building with append
2. **Map/filter/reduce** - Higher-order list operations
3. **Better numeric types** - BigInt for large numbers, Decimal for precise arithmetic

But these are optimizations, not blockers. This example can be implemented TODAY.

## Next Steps

**Implementation priority: HIGH**

Since all features exist, this should be implemented soon to:
1. Demonstrate pure functional programming in Clarity
2. Provide useful utility functions for other examples
3. Show comprehensive test suite patterns
4. Validate that the effect[Test] system works well

**Recommendation:** Implement this example in the next development session.
