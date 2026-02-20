# Sudoku Solver

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Advanced
**Category:** Algorithms, Backtracking

## Overview

A sudoku solver using recursive backtracking to solve 9×9 puzzles. This example would demonstrate complex algorithmic problem-solving, 2D grid manipulation, and efficient data structures.

## What This Example Should Demonstrate

- Recursive backtracking algorithm
- 2D grid representation and manipulation
- Complex validation logic (row, column, 3×3 box constraints)
- File parsing (reading puzzle from text file)
- Union types for result values
- Performance-critical operations requiring O(1) access

## Why This Can't Be Implemented Yet

### CRITICAL: Missing Indexed Array Operations

Clarity currently has `List<T>` with only these operations:
- `head(list)` - O(1) get first element
- `tail(list)` - O(1) get rest of list
- `append(list, elem)` - O(n) add to end
- `concat(list1, list2)` - O(n) merge lists
- `reverse(list)` - O(n) reverse
- `length(list)` - O(n) count elements

**Problem:** No way to get or set element at arbitrary index!

A sudoku solver needs frequent random access to grid cells:
```clarity
// NEEDED (doesn't exist):
let cell = list_get(grid, 42)           // Get element at index 42
let new_grid = list_set(grid, 42, 5)   // Set element at index 42 to 5
```

**Workaround attempt:** Implement get/set recursively with head/tail:
```clarity
// O(n) - WAY TOO SLOW for sudoku
function list_get_slow(list: List<T>, index: Int64) -> Option<T> {
  match index == 0 {
    True -> Some(head(list)),
    False -> list_get_slow(tail(list), index - 1)
  }
}
```

**Result:** Sudoku solver becomes O(n²) per cell access instead of O(1). A single solve attempt would take seconds or minutes instead of milliseconds.

## Required Language Features

### Option 1: Add Indexed List Operations

```clarity
// Built-in indexed access for List<T>
function list_get<T>(list: List<T>, index: Int64) -> Option<T>
function list_set<T>(list: List<T>, index: Int64, value: T) -> List<T>

// Example usage:
let grid: List<Int64> = [0, 0, 5, 3, ...]  // 81 elements for 9×9 sudoku
match list_get(grid, 42) {
  Some(val) -> print_int(val),
  None -> print_string("Index out of bounds")
}
let new_grid = list_set(grid, 42, 5)  // Set cell to 5
```

**Implementation:** Internally use array/vector with O(1) random access

### Option 2: Add Dedicated Array Type (PREFERRED)

```clarity
// New built-in Array type with O(1) indexed access
type Array<T>

function array_new<T>(size: Int64, initial: T) -> Array<T>
function array_get<T>(arr: Array<T>, index: Int64) -> Option<T>
function array_set<T>(arr: Array<T>, index: Int64, value: T) -> Array<T>
function array_length<T>(arr: Array<T>) -> Int64
function array_to_list<T>(arr: Array<T>) -> List<T>
function list_to_array<T>(list: List<T>) -> Array<T>

// Example usage:
let grid = array_new(81, 0)  // 9×9 grid, all cells empty
let grid2 = array_set(grid, 42, 5)  // Set cell to 5
match array_get(grid2, 42) {
  Some(val) -> print_int(val),  // Prints: 5
  None -> print_string("Invalid index")
}
```

**Why Array is better than List for this:**
- Clearly signals O(1) random access intent
- Optimized for index-based algorithms
- Distinguishes sequential processing (List) from random access (Array)

### Additional: Better Parsing

```clarity
// string_to_int returns Option<Int64>: Some(value) or None on failure
let result = string_to_int("xyz")  // Returns None
let num = match string_to_int("42") {
  Some(n) -> n,     // 42
  None -> 0 - 1     // parse failure
}

// Usage:
match parse_int(input) {
  Ok(num) -> process(num),
  Err(msg) -> print_string("Error: " ++ msg)
}
```

## Ideal Implementation (with Array<T>)

```clarity
module SudokuSolver

// 9×9 grid = 81 cells, indexed as: row * 9 + col
type Grid = Array<Int64>  // 0 = empty, 1-9 = digits

// Result type
type SolveResult =
  | Solved(grid: Grid)
  | Unsolvable

// Get cell value at (row, col)
function get_cell(grid: Grid, row: Int64, col: Int64) -> Int64 {
  let idx = row * 9 + col;
  match array_get(grid, idx) {
    Some(val) -> val,
    None -> 0  // Should never happen with valid grid
  }
}

// Set cell value at (row, col)
function set_cell(grid: Grid, row: Int64, col: Int64, val: Int64) -> Grid {
  let idx = row * 9 + col;
  array_set(grid, idx, val)
}

// Check if placing num at (row, col) is valid
function is_valid(grid: Grid, row: Int64, col: Int64, num: Int64) -> Bool {
  let row_ok = is_valid_row(grid, row, num);
  let col_ok = is_valid_col(grid, col, num);
  let box_ok = is_valid_box(grid, row, col, num);
  row_ok and col_ok and box_ok
}

// Validate row doesn't contain num
function is_valid_row(grid: Grid, row: Int64, num: Int64) -> Bool {
  is_valid_row_helper(grid, row, 0, num)
}

function is_valid_row_helper(grid: Grid, row: Int64, col: Int64, num: Int64) -> Bool {
  match col >= 9 {
    True -> True,  // Checked all columns, no conflict
    False -> {
      let cell = get_cell(grid, row, col);
      match cell == num {
        True -> False,  // Found duplicate!
        False -> is_valid_row_helper(grid, row, col + 1, num)
      }
    }
  }
}

// Validate column (similar to row)
function is_valid_col(grid: Grid, col: Int64, num: Int64) -> Bool {
  // ... similar to is_valid_row
}

// Validate 3×3 box
function is_valid_box(grid: Grid, row: Int64, col: Int64, num: Int64) -> Bool {
  let box_row = (row / 3) * 3;
  let box_col = (col / 3) * 3;
  is_valid_box_helper(grid, box_row, box_col, 0, num)
}

function is_valid_box_helper(grid: Grid, start_row: Int64, start_col: Int64, idx: Int64, num: Int64) -> Bool {
  match idx >= 9 {
    True -> True,
    False -> {
      let r = start_row + (idx / 3);
      let c = start_col + (idx % 3);
      let cell = get_cell(grid, r, c);
      match cell == num {
        True -> False,
        False -> is_valid_box_helper(grid, start_row, start_col, idx + 1, num)
      }
    }
  }
}

// Find next empty cell (value 0)
function find_empty(grid: Grid, idx: Int64) -> Option<Int64> {
  match idx >= 81 {
    True -> None,  // No empty cells
    False -> {
      match array_get(grid, idx) {
        Some(val) -> match val == 0 {
          True -> Some(idx),  // Found empty cell
          False -> find_empty(grid, idx + 1)
        },
        None -> None
      }
    }
  }
}

// Recursive backtracking solver
function solve(grid: Grid) -> SolveResult {
  match find_empty(grid, 0) {
    None -> Solved(grid),  // No empty cells = solved!
    Some(idx) -> {
      let row = idx / 9;
      let col = idx % 9;
      try_digits(grid, row, col, 1)
    }
  }
}

// Try digits 1-9 in empty cell
function try_digits(grid: Grid, row: Int64, col: Int64, digit: Int64) -> SolveResult {
  match digit > 9 {
    True -> Unsolvable,  // Tried all digits, backtrack
    False -> {
      match is_valid(grid, row, col, digit) {
        False -> try_digits(grid, row, col, digit + 1),  // Skip invalid
        True -> {
          let new_grid = set_cell(grid, row, col, digit);
          match solve(new_grid) {
            Solved(solution) -> Solved(solution),  // Success!
            Unsolvable -> try_digits(grid, row, col, digit + 1)  // Backtrack
          }
        }
      }
    }
  }
}

// Read puzzle from file
effect[FileSystem, Log] function main(filename: String) -> Unit {
  let content = read_file(filename);
  let grid = parse_puzzle(content);

  match solve(grid) {
    Solved(solution) -> {
      print_string("Solution:");
      print_grid(solution)
    },
    Unsolvable -> print_string("No solution exists")
  }
}

// Parse puzzle file (space-separated digits, 0 = empty)
function parse_puzzle(content: String) -> Grid {
  // TODO: Split content by whitespace, convert to Int64, create Array
  // Requires: string_split, parse_int, list_to_array
}

// Print grid in 9×9 format
effect[Log] function print_grid(grid: Grid) -> Unit {
  print_grid_row(grid, 0)
}

function print_grid_row(grid: Grid, row: Int64) -> Unit {
  match row >= 9 {
    True -> Unit,
    False -> {
      print_row(grid, row, 0);
      print_string("");  // Newline
      print_grid_row(grid, row + 1)
    }
  }
}

function print_row(grid: Grid, row: Int64, col: Int64) -> Unit {
  match col >= 9 {
    True -> Unit,
    False -> {
      let val = get_cell(grid, row, col);
      print_string(int_to_string(val) ++ " ");
      print_row(grid, row, col + 1)
    }
  }
}
```

## Test Puzzle Example

**puzzle1.txt (easy):**
```
5 3 0 0 7 0 0 0 0
6 0 0 1 9 5 0 0 0
0 9 8 0 0 0 0 6 0
8 0 0 0 6 0 0 0 3
4 0 0 8 0 3 0 0 1
7 0 0 0 2 0 0 0 6
0 6 0 0 0 0 2 8 0
0 0 0 4 1 9 0 0 5
0 0 0 0 8 0 0 7 9
```

## Usage (once implemented)

```bash
# Compile
npx clarityc compile examples/05-sudoku-solver/sudoku.clarity

# Solve puzzle
npx clarityc run examples/05-sudoku-solver/sudoku.clarity -f main -a '"examples/05-sudoku-solver/puzzle1.txt"'

# Run tests
npx clarityc test examples/05-sudoku-solver/sudoku.clarity
```

## Dependencies for Implementation

Before this can be implemented, Clarity needs:

1. ✅ **Array<T> type** with indexed access (CRITICAL)
2. ✅ **parse_int returning Result<Int64, String>** (HIGH)
3. ⚠️ **string_split** for parsing (MEDIUM - can work around)
4. ⚠️ **Better file parsing utilities** (NICE TO HAVE)

## Learning Objectives

Once implemented, studying this example will teach:

1. Recursive backtracking algorithms
2. 2D grid representation with 1D arrays
3. Complex validation logic with multiple constraints
4. Efficient data structure usage (Array vs List trade-offs)
5. File parsing and text processing
6. Algorithm optimization and performance considerations

## Related Examples

- `02-recursion` - Recursion fundamentals
- `04-file-io` - File reading
- `14-tic-tac-toe` - Another grid-based game (also needs Array)
- `20-expr-evaluator` - Another backtracking example

## Impact on Language Design

This example reveals that Clarity needs efficient random access data structures. Many real-world algorithms (games, simulations, matrix operations) are impractical without O(1) indexed access.

**Recommendation:** Add `Array<T>` as a first-class type alongside `List<T>`.
