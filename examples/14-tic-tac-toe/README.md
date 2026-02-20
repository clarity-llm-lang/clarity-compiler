# Tic-Tac-Toe Game

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Intermediate
**Category:** Games, Algorithms

## Overview

Play tic-tac-toe against optimal minimax AI. Demonstrates 3×3 grid representation using List<Int64>, game state management, and minimax algorithm for perfect play.

## Required Language Features

### 1. Array Type (for 3×3 grid)

```clarity
type Array<T>
function array_new<T>(size: Int64, initial: T) -> Array<T>
function array_get<T>(arr: Array<T>, index: Int64) -> Option<T>
function array_set<T>(arr: Array<T>, index: Int64, value: T) -> Array<T>
```

### 2. Random Number Generation

```clarity
effect[Random] function random_int(min: Int64, max: Int64) -> Int64
effect[Random] function random_float() -> Float64
```

## Example Implementation

```clarity
type Cell = Empty | X | O

type Board = Array<Cell>  // 9 cells for 3×3 grid

type GameState =
  | Playing
  | XWins
  | OWins
  | Draw

function new_board() -> Board {
  array_new(9, Empty)
}

function get_cell(board: Board, row: Int64, col: Int64) -> Cell {
  let idx = row * 3 + col;
  match array_get(board, idx) {
    Some(cell) -> cell,
    None -> Empty
  }
}

function set_cell(board: Board, row: Int64, col: Int64, cell: Cell) -> Board {
  let idx = row * 3 + col;
  array_set(board, idx, cell)
}

function check_winner(board: Board) -> GameState {
  // Check rows, columns, diagonals
  match check_rows(board) or check_cols(board) or check_diagonals(board) {
    Some(X) -> XWins,
    Some(O) -> OWins,
    None -> match is_full(board) {
      True -> Draw,
      False -> Playing
    }
  }
}

// Simple AI: random valid move
effect[Random] function ai_move(board: Board) -> Board {
  let empty_cells = find_empty_cells(board);
  let idx = random_int(0, length(empty_cells) - 1);
  let cell_idx = list_get(empty_cells, idx);
  match cell_idx {
    Some(i) -> array_set(board, i, O),
    None -> board
  }
}

// Better AI: minimax algorithm
function ai_move_minimax(board: Board) -> Board {
  let best_move = find_best_move(board);
  match best_move {
    Some(idx) -> array_set(board, idx, O),
    None -> board
  }
}

effect[FileSystem, Log] function play_game() -> Unit {
  let board = new_board();
  game_loop(board)
}

function game_loop(board: Board) -> Unit {
  print_board(board);

  match check_winner(board) {
    XWins -> print_string("You win!"),
    OWins -> print_string("AI wins!"),
    Draw -> print_string("Draw!"),
    Playing -> {
      print_string("Your move (row col):");
      let input = read_line();
      // Parse input, make move, AI move, continue
      game_loop(make_moves(board, input))
    }
  }
}
```

## Learning Objectives

- 2D grid representation with 1D arrays
- Game state management
- Win condition checking
- AI algorithms (random, minimax)
- Interactive game loop

## Dependencies

- ❌ Array type (CRITICAL - same as sudoku)
- ❌ Random number generation (MEDIUM - can do deterministic AI)
- ✅ User input (read_line already exists)
