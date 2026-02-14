# Expression Evaluator (REQUIREMENTS)

**Status:** ✅ **CAN BE MOSTLY IMPLEMENTED** - Only missing Map for variable environments
**Complexity:** Advanced
**Category:** Compilers, Interpreters, AST

## Overview

A simple expression evaluator that parses and evaluates arithmetic expressions like "2 + 3 * x" where x is a variable. Demonstrates lexing, parsing, AST construction, and interpretation.

## What This Demonstrates

- **Lexer** - Tokenize input string into tokens
- **Parser** - Build Abstract Syntax Tree (AST) from tokens
- **Evaluator** - Traverse AST and compute result
- **Variable environment** - Store variable values
- **Operator precedence** - Handle * before +

## Required Language Features

### Map for Variable Environment (Optional)

```clarity
type Env = Map<String, Float64>

// Alternative: Use List of (name, value) pairs
type Env = List<Binding>
type Binding = { name: String, value: Float64 }
```

## Example Implementation

```clarity
// ============================================================================
// Tokens
// ============================================================================

type Token =
  | TNumber(Float64)
  | TVariable(String)
  | TPlus
  | TMinus
  | TStar
  | TSlash
  | TLParen
  | TRParen
  | TEOF

// ============================================================================
// AST
// ============================================================================

type Expr =
  | Number(Float64)
  | Variable(String)
  | Add(left: Expr, right: Expr)
  | Subtract(left: Expr, right: Expr)
  | Multiply(left: Expr, right: Expr)
  | Divide(left: Expr, right: Expr)

// ============================================================================
// Lexer
// ============================================================================

type Lexer = {
  input: String,
  pos: Int64
}

function lex(input: String) -> List<Token> {
  let lexer = { input: input, pos: 0 };
  lex_tokens(lexer, [])
}

function lex_tokens(lexer: Lexer, acc: List<Token>) -> List<Token> {
  let lexer2 = skip_whitespace_lex(lexer);

  match is_at_end_lex(lexer2) {
    True -> reverse_list(acc ++ [TEOF]),
    False -> {
      let ch = peek_lex(lexer2);
      match ch {
        "+" -> lex_tokens(advance_lex(lexer2), acc ++ [TPlus]),
        "-" -> lex_tokens(advance_lex(lexer2), acc ++ [TMinus]),
        "*" -> lex_tokens(advance_lex(lexer2), acc ++ [TStar]),
        "/" -> lex_tokens(advance_lex(lexer2), acc ++ [TSlash]),
        "(" -> lex_tokens(advance_lex(lexer2), acc ++ [TLParen]),
        ")" -> lex_tokens(advance_lex(lexer2), acc ++ [TRParen]),
        _ -> match is_digit(ch) {
          True -> {
            let { number, lexer: lexer3 } = lex_number(lexer2);
            lex_tokens(lexer3, acc ++ [TNumber(number)])
          },
          False -> match is_alpha(ch) {
            True -> {
              let { name, lexer: lexer3 } = lex_variable(lexer2);
              lex_tokens(lexer3, acc ++ [TVariable(name)])
            },
            False -> lex_tokens(advance_lex(lexer2), acc)  // Skip unknown chars
          }
        }
      }
    }
  }
}

function lex_number(lexer: Lexer) -> { number: Float64, lexer: Lexer } {
  lex_digits(lexer, "")
}

function lex_digits(lexer: Lexer, acc: String) -> { number: Float64, lexer: Lexer } {
  match is_at_end_lex(lexer) {
    True -> { number: string_to_float(acc), lexer: lexer },
    False -> {
      let ch = peek_lex(lexer);
      match is_digit(ch) or string_eq(ch, ".") {
        True -> lex_digits(advance_lex(lexer), acc ++ ch),
        False -> { number: string_to_float(acc), lexer: lexer }
      }
    }
  }
}

function lex_variable(lexer: Lexer) -> { name: String, lexer: Lexer } {
  lex_alphanumeric(lexer, "")
}

function lex_alphanumeric(lexer: Lexer, acc: String) -> { name: String, lexer: Lexer } {
  match is_at_end_lex(lexer) {
    True -> { name: acc, lexer: lexer },
    False -> {
      let ch = peek_lex(lexer);
      match is_alpha(ch) or is_digit(ch) {
        True -> lex_alphanumeric(advance_lex(lexer), acc ++ ch),
        False -> { name: acc, lexer: lexer }
      }
    }
  }
}

// ============================================================================
// Parser (Recursive Descent with Precedence)
// ============================================================================

type Parser = {
  tokens: List<Token>,
  pos: Int64
}

function parse(tokens: List<Token>) -> Expr {
  let parser = { tokens: tokens, pos: 0 };
  let { expr, parser: _ } = parse_expression(parser);
  expr
}

// Expression: Term (('+' | '-') Term)*
function parse_expression(p: Parser) -> { expr: Expr, parser: Parser } {
  let { expr: left, parser: p2 } = parse_term(p);
  parse_expression_rest(p2, left)
}

function parse_expression_rest(p: Parser, left: Expr) -> { expr: Expr, parser: Parser } {
  match peek_token(p) {
    TPlus -> {
      let p2 = advance_parser(p);
      let { expr: right, parser: p3 } = parse_term(p2);
      parse_expression_rest(p3, Add(left, right))
    },
    TMinus -> {
      let p2 = advance_parser(p);
      let { expr: right, parser: p3 } = parse_term(p2);
      parse_expression_rest(p3, Subtract(left, right))
    },
    _ -> { expr: left, parser: p }
  }
}

// Term: Factor (('*' | '/') Factor)*
function parse_term(p: Parser) -> { expr: Expr, parser: Parser } {
  let { expr: left, parser: p2 } = parse_factor(p);
  parse_term_rest(p2, left)
}

function parse_term_rest(p: Parser, left: Expr) -> { expr: Expr, parser: Parser } {
  match peek_token(p) {
    TStar -> {
      let p2 = advance_parser(p);
      let { expr: right, parser: p3 } = parse_factor(p2);
      parse_term_rest(p3, Multiply(left, right))
    },
    TSlash -> {
      let p2 = advance_parser(p);
      let { expr: right, parser: p3 } = parse_factor(p2);
      parse_term_rest(p3, Divide(left, right))
    },
    _ -> { expr: left, parser: p }
  }
}

// Factor: Number | Variable | '(' Expression ')'
function parse_factor(p: Parser) -> { expr: Expr, parser: Parser } {
  match peek_token(p) {
    TNumber(n) -> { expr: Number(n), parser: advance_parser(p) },
    TVariable(v) -> { expr: Variable(v), parser: advance_parser(p) },
    TLParen -> {
      let p2 = advance_parser(p);  // Skip '('
      let { expr, parser: p3 } = parse_expression(p2);
      let p4 = advance_parser(p3);  // Skip ')'
      { expr: expr, parser: p4 }
    },
    _ -> { expr: Number(0.0), parser: p }  // Error case
  }
}

// ============================================================================
// Evaluator
// ============================================================================

type Env = List<Binding>
type Binding = { name: String, value: Float64 }

function env_get(env: Env, name: String) -> Float64 {
  match length(env) == 0 {
    True -> 0.0,  // Variable not found, default to 0
    False -> {
      let binding = head(env);
      match string_eq(binding.name, name) {
        True -> binding.value,
        False -> env_get(tail(env), name)
      }
    }
  }
}

function env_set(env: Env, name: String, value: Float64) -> Env {
  [{ name: name, value: value }] ++ env
}

function eval(expr: Expr, env: Env) -> Float64 {
  match expr {
    Number(n) -> n,
    Variable(v) -> env_get(env, v),
    Add(left, right) -> eval(left, env) + eval(right, env),
    Subtract(left, right) -> eval(left, env) - eval(right, env),
    Multiply(left, right) -> eval(left, env) * eval(right, env),
    Divide(left, right) -> eval(left, env) / eval(right, env)
  }
}

// ============================================================================
// Demo
// ============================================================================

effect[Log] function demo() -> Unit {
  let input = "2 + 3 * x";
  let tokens = lex(input);
  let ast = parse(tokens);

  let env = env_set([], "x", 5.0);
  let result = eval(ast, env);

  print_string("Input: " ++ input);
  print_string("Result: " ++ float_to_string(result));  // 2 + 3 * 5 = 17
}

effect[Test] function test_eval() -> Unit {
  let env = env_set([], "x", 10.0);

  // Test: 2 + 3 = 5
  let expr1 = Add(Number(2.0), Number(3.0));
  assert_eq_float(eval(expr1, env), 5.0);

  // Test: 2 * 3 + 4 = 10
  let expr2 = Add(Multiply(Number(2.0), Number(3.0)), Number(4.0));
  assert_eq_float(eval(expr2, env), 10.0);

  // Test: 2 + 3 * x where x = 10 -> 2 + 30 = 32
  let expr3 = Add(Number(2.0), Multiply(Number(3.0), Variable("x")));
  assert_eq_float(eval(expr3, env), 32.0)
}
```

## Learning Objectives

- Lexical analysis (tokenization)
- Recursive descent parsing
- Abstract Syntax Trees (AST)
- Tree traversal and evaluation
- Operator precedence
- Variable environments
- Interpreter pattern

## Dependencies

- ⚠️ `char_code` for `is_digit`, `is_alpha` (can work around with string_eq)
- ⚠️ `Map<String, Float64>` for cleaner environment (can use List of bindings)
- ✅ Recursive union types (already supported)
- ✅ Pattern matching (already supported)

## Extensions

Once basic evaluator works, extend with:
- **More operators**: %, ^, unary minus
- **Functions**: sin, cos, sqrt, abs
- **Boolean expressions**: ==, <, >, and, or
- **If expressions**: if x > 0 then x else -x
- **Let bindings**: let x = 5 in x * x

## Related Examples

- `19-json-parser` - Another parsing example
- `02-recursion` - Recursion patterns
- `18-merkle-tree` - Tree data structures

## Impact on Language Design

This example shows Clarity can already handle:
- Recursive data structures (Expr, Token)
- Pattern matching on unions
- Tree traversal
- Interpreters and compilers

**Good fit for Clarity!** Compiler/interpreter implementation is a sweet spot for functional languages with algebraic data types.
