# Tic-Tac-Toe Game

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Intermediate
**Category:** Games, Algorithms

## Overview

A complete tic-tac-toe game with minimax AI. Demonstrates 3×3 grid representation using List<Int64>, game state management with union types, win detection, and the minimax algorithm for optimal computer play.

## Implementation Notes

This example implements a full tic-tac-toe game using Clarity's core features. The grid is represented as a `List<Int64>` with 9 elements (cells 0-8), and the `nth()` builtin provides indexed access.

### Key Features

- ✅ **Grid representation** - Flat list with 9 cells
- ✅ **Game state management** - Union type for Playing/XWins/OWins/Draw
- ✅ **Win detection** - Check rows, columns, and diagonals
- ✅ **Minimax AI** - Optimal computer player with recursive lookahead
- ✅ **Move validation** - Ensure moves are legal
- ✅ **Cell state** - Union type for Empty/X/O

## Usage

```bash
# Compile
npx clarityc compile examples/14-tic-tac-toe/tictactoe.clarity --check-only

# Run tests (8 tests covering game logic and AI)
npx clarityc test examples/14-tic-tac-toe/tictactoe.clarity

# Run demo (watch AI vs AI game)
npx clarityc run examples/14-tic-tac-toe/tictactoe.clarity -f demo
```

### Sample Output
```
Tic-Tac-Toe AI Demo
===================

Initial board:
. . .
. . .
. . .

AI X plays position 4 (center)
AI O plays position 0 (corner)
...

Final result: X Wins!
```

## Test Coverage

The example includes 8 comprehensive tests:
- `test_new_board` - Board initialization
- `test_make_move` - Making valid moves
- `test_check_winner_row` - Row win detection
- `test_check_winner_col` - Column win detection
- `test_check_winner_diagonal` - Diagonal win detection
- `test_is_draw` - Draw game detection
- `test_minimax_blocks_win` - AI blocks opponent win
- `test_minimax_takes_win` - AI takes winning move

## Learning Objectives

Studying this example teaches:

1. **Grid representation** - Mapping 2D positions to 1D list
2. **Game state management** - Union types for game outcomes
3. **Win condition checking** - Systematic validation of rows/columns/diagonals
4. **Minimax algorithm** - Recursive game tree search for optimal play
5. **Alpha-beta pruning** - Optimization technique (advanced)
6. **Union types in practice** - Cell states and game states

## Related Examples

- `05-sudoku-solver` - Another grid-based puzzle
- `02-recursion` - Recursion fundamentals for minimax
- `20-expr-evaluator` - Tree-based recursive algorithms

## Dependencies Used

- ✅ **List<T>** with nth() for indexed access
- ✅ **Union types** - Cell (Empty/X/O) and GameState variants
- ✅ **Pattern matching** - Checking game states
- ✅ **Recursion** - Minimax algorithm implementation
- ✅ **Option<T>** - Safe cell access
