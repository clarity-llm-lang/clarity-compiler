# Linear Regression

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Advanced
**Category:** Data Science, Machine Learning, Numerical Computing

## Overview

Compute linear regression (y = mx + b) from (x, y) data points using least squares method. Demonstrates numerical computing with Float64, higher-order functions, and statistical algorithms.

## Required Language Features

### 1. Matrix Type (2D arrays)

```clarity
type Matrix<T>
function matrix_new<T>(rows: Int64, cols: Int64, initial: T) -> Matrix<T>
function matrix_get<T>(m: Matrix<T>, row: Int64, col: Int64) -> Option<T>
function matrix_set<T>(m: Matrix<T>, row: Int64, col: Int64, val: T) -> Matrix<T>
function matrix_multiply(a: Matrix<Float64>, b: Matrix<Float64>) -> Matrix<Float64>
function matrix_transpose(m: Matrix<Float64>) -> Matrix<Float64>
function matrix_inverse(m: Matrix<Float64>) -> Option<Matrix<Float64>>
```

### 2. Vector Operations

```clarity
type Vector<T> = List<T>  // or dedicated Vector type

function vector_dot(a: Vector<Float64>, b: Vector<Float64>) -> Float64
function vector_sum(v: Vector<Float64>) -> Float64
function vector_mean(v: Vector<Float64>) -> Float64
function vector_map(v: Vector<Float64>, f: (Float64) -> Float64) -> Vector<Float64>
```

## Mathematical Background

Linear regression finds the best-fit line y = mx + b through data points.

**Formulas:**
```
m = (n * Σ(xy) - Σx * Σy) / (n * Σ(x²) - (Σx)²)
b = (Σy - m * Σx) / n
```

Where:
- n = number of data points
- Σx = sum of x values
- Σy = sum of y values
- Σxy = sum of (x * y) products
- Σ(x²) = sum of x² values

## Example Implementation

```clarity
type Point = {
  x: Float64,
  y: Float64
}

type LinearModel = {
  slope: Float64,     // m
  intercept: Float64  // b
}

function linear_regression(points: List<Point>) -> LinearModel {
  let n = int_to_float(length(points));
  let sum_x = sum_of(points, get_x);
  let sum_y = sum_of(points, get_y);
  let sum_xy = sum_of_products(points);
  let sum_x_squared = sum_of_squares(points, get_x);

  // Calculate slope: m = (n * Σ(xy) - Σx * Σy) / (n * Σ(x²) - (Σx)²)
  let numerator = n * sum_xy - sum_x * sum_y;
  let denominator = n * sum_x_squared - sum_x * sum_x;
  let slope = numerator / denominator;

  // Calculate intercept: b = (Σy - m * Σx) / n
  let intercept = (sum_y - slope * sum_x) / n;

  { slope: slope, intercept: intercept }
}

function sum_of(points: List<Point>, getter: (Point) -> Float64) -> Float64 {
  match length(points) == 0 {
    True -> 0.0,
    False -> getter(head(points)) + sum_of(tail(points), getter)
  }
}

function sum_of_products(points: List<Point>) -> Float64 {
  match length(points) == 0 {
    True -> 0.0,
    False -> {
      let p = head(points);
      p.x * p.y + sum_of_products(tail(points))
    }
  }
}

function sum_of_squares(points: List<Point>, getter: (Point) -> Float64) -> Float64 {
  match length(points) == 0 {
    True -> 0.0,
    False -> {
      let val = getter(head(points));
      val * val + sum_of_squares(tail(points), getter)
    }
  }
}

function get_x(p: Point) -> Float64 { p.x }
function get_y(p: Point) -> Float64 { p.y }

function predict(model: LinearModel, x: Float64) -> Float64 {
  model.slope * x + model.intercept
}

// Calculate R² (coefficient of determination)
function r_squared(model: LinearModel, points: List<Point>) -> Float64 {
  let mean_y = sum_of(points, get_y) / int_to_float(length(points));
  let ss_total = sum_squared_errors(points, mean_y, actual_y);
  let ss_residual = sum_squared_errors_model(model, points);
  1.0 - (ss_residual / ss_total)
}

effect[Log] function demo() -> Unit {
  // Sample data: y = 2x + 1 with some noise
  let points = [
    { x: 1.0, y: 3.1 },
    { x: 2.0, y: 5.2 },
    { x: 3.0, y: 6.9 },
    { x: 4.0, y: 9.1 },
    { x: 5.0, y: 10.8 }
  ];

  let model = linear_regression(points);

  print_string("Slope: " ++ float_to_string(model.slope));
  print_string("Intercept: " ++ float_to_string(model.intercept));

  // Predict y for x = 6
  let prediction = predict(model, 6.0);
  print_string("Prediction for x=6: " ++ float_to_string(prediction));

  let r2 = r_squared(model, points);
  print_string("R²: " ++ float_to_string(r2))
}
```

## Matrix-Based Approach

For more complex regression (multiple variables), use matrix operations:

```clarity
// X = [1, x₁]    β = [b]    y = [y₁]
//     [1, x₂]        [m]        [y₂]
//     [1, x₃]                   [y₃]
//
// Normal equation: β = (XᵀX)⁻¹Xᵀy

function linear_regression_matrix(X: Matrix<Float64>, y: Vector<Float64>) -> Vector<Float64> {
  let X_transpose = matrix_transpose(X);
  let XtX = matrix_multiply(X_transpose, X);

  match matrix_inverse(XtX) {
    None -> [],  // Singular matrix, can't solve
    Some(XtX_inv) -> {
      let Xty = matrix_vector_multiply(X_transpose, y);
      matrix_vector_multiply(XtX_inv, Xty)
    }
  }
}
```

## Learning Objectives

- Statistical algorithms
- Numerical computing with floats
- Matrix/vector operations
- Higher-order functions (map, reduce on vectors)
- Least squares method
- Model evaluation (R²)

## Usage

### Compile the example

```bash
npx tsx src/index.ts compile examples/17-linear-regression/regression.clarity
```

### Run the demo

```bash
npx tsx src/index.ts run examples/17-linear-regression/regression.clarity -f demo
```

**Output:**
```
Linear Regression Results:
Slope (m): 1.9300000000000024
Intercept (b): 1.229999999999992

Prediction for x=6: 12.810000000000006

R² (coefficient of determination): 0.9984185697437546
(R² close to 1.0 indicates a good fit)
```

### Run tests

```bash
npx tsx src/index.ts test examples/17-linear-regression/regression.clarity
```

**Output:**
```
[PASS] test_perfect_linear_fit (3 assertions)
[PASS] test_horizontal_line (2 assertions)
[PASS] test_negative_slope (2 assertions)
[PASS] test_prediction (2 assertions)
[PASS] test_two_points (2 assertions)
[PASS] test_r_squared_perfect_fit (1 assertions)

6 tests, 6 passed, 0 failed
```

## Implementation Details

This implementation uses:
- **List<Point>** for storing data points
- **Higher-order functions** for computing sums and aggregations
- **Least squares method** for finding the best-fit line
- **R² calculation** for measuring goodness of fit

The algorithm computes the optimal slope and intercept using these formulas:
- slope = (n × Σ(xy) - Σx × Σy) / (n × Σ(x²) - (Σx)²)
- intercept = (Σy - slope × Σx) / n

## Dependencies

- ✅ List<T> with head/tail/length operations
- ✅ Higher-order functions (passing functions as arguments)
- ✅ Float64 arithmetic operations
- ✅ Record types (Point, LinearModel)

## Related Examples

- `06-math-toolkit` - Basic numerical functions
- `09-csv-processor` - Loading data from CSV

## Future Enhancements

For production data science workloads, the following would be valuable:

1. **Matrix operations** for multivariate regression
2. **Array<T>** for more efficient random access
3. **FFI to numerical libraries** for BLAS-level performance

The matrix-based approach (shown in comments) would enable:
- Multiple regression (multiple predictor variables)
- Polynomial regression
- Ridge/Lasso regression
- Other advanced statistical models
