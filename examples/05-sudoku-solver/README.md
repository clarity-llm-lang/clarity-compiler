# Sudoku Solver

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Advanced
**Category:** Algorithms, Backtracking

## Overview

A sudoku solver using recursive backtracking to solve 9×9 puzzles. Demonstrates complex algorithmic problem-solving, 2D grid manipulation using List<Int64>, and recursive constraint satisfaction.

## Implementation Notes

This example uses `List<Int64>` to represent the 9×9 grid (81 cells) with `nth()` builtin for indexed access. While not O(1) like a dedicated array type, it's sufficient for demonstrating the backtracking algorithm on typical sudoku puzzles.

### Key Design Decisions

- **Grid representation**: Flat `List<Int64>` with 81 elements, indexed as `row * 9 + col`
- **Empty cells**: Represented as `0`, filled cells as `1-9`
- **Access pattern**: Uses `nth(grid, index)` which returns `Option<Int64>`
- **Result type**: `SolveResult` union with `Solved(grid)` or `Unsolvable` variants
- **Validation**: Separate functions for row, column, and 3×3 box constraints

## What This Example Demonstrates

- Recursive backtracking algorithm
- 2D grid representation using 1D list
- Complex validation logic (row, column, 3×3 box constraints)
- Pattern matching on Option types
- Union types for result values
- Constraint satisfaction problems
- Exhaustive search with pruning

## Implementation Overview

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

## Usage

```bash
# Compile
npx clarityc compile examples/05-sudoku-solver/sudoku.clarity

# Run tests (8 tests covering validation, solving, and edge cases)
npx clarityc test examples/05-sudoku-solver/sudoku.clarity

# Run demo (solves a sample puzzle)
npx clarityc run examples/05-sudoku-solver/sudoku.clarity -f demo
```

## Dependencies Used

- ✅ **List<T>** with nth() for indexed access
- ✅ **Option<T>** for safe indexing
- ✅ **Pattern matching** for control flow
- ✅ **Recursion** for backtracking algorithm
- ✅ **Union types** for result values

## Learning Objectives

Studying this example teaches:

1. **Recursive backtracking algorithms** - The core constraint satisfaction technique
2. **2D grid representation with 1D lists** - Mapping (row, col) to flat index
3. **Complex validation logic** - Checking row, column, and box constraints
4. **Option type handling** - Safe indexed access with pattern matching
5. **Algorithmic thinking** - Breaking down problems into smaller validations
6. **Performance considerations** - Understanding algorithm complexity

## Test Coverage

The example includes 8 comprehensive tests:
- `test_get_set_cell` - Grid access operations
- `test_is_valid_placement` - Constraint validation
- `test_find_empty` - Empty cell detection
- `test_solve_simple` - Basic puzzle solving
- `test_solve_medium` - Moderate difficulty
- `test_solve_hard` - Complex backtracking
- `test_unsolvable` - Invalid puzzle detection
- `test_already_solved` - Solved puzzle recognition

## Related Examples

- `02-recursion` - Recursion fundamentals
- `14-tic-tac-toe` - Another grid-based game
- `20-expr-evaluator` - Tree-based recursive algorithms
