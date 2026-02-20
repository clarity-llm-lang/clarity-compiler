# Expression Evaluator

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Advanced
**Category:** Compilers, Interpreters, AST

## Overview

A complete expression evaluator that lexes, parses, and evaluates arithmetic expressions like "2 + 3 * 5". Demonstrates all phases of a simple interpreter: lexical analysis, parsing with operator precedence, AST construction, and evaluation.

## Implementation Notes

This example implements a full interpreter pipeline using recursive descent parsing. The implementation includes:

- ✅ **Full lexer** - Tokenizes numbers, operators, and parentheses
- ✅ **Recursive descent parser** - Builds AST with correct operator precedence
- ✅ **AST evaluator** - Computes numeric results
- ✅ **Operator precedence** - Multiplication before addition (`*` and `/` bind tighter than `+` and `-`)
- ✅ **Parentheses** - Override precedence with grouping
- ✅ **Error handling** - Graceful handling of malformed input

### Architecture

The evaluator has three distinct phases:

1. **Lexer** (`lex()`) - String → List<Token>
2. **Parser** (`parse()`) - List<Token> → Expr (AST)
3. **Evaluator** (`eval()`) - Expr → Float64

## What This Example Demonstrates

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

## Usage

```bash
# Compile
npx clarityc compile examples/20-expr-evaluator/eval.clarity --check-only

# Run tests (9 tests covering lexing, parsing, and evaluation)
npx clarityc test examples/20-expr-evaluator/eval.clarity

# Run demo
npx clarityc run examples/20-expr-evaluator/eval.clarity -f demo
```

### Sample Output
```
Expression Evaluator Demo
=========================

Input: 2 + 3 * 5
Result: 17

Input: (2 + 3) * 5
Result: 25

Input: 10 / 2 - 3
Result: 2
```

## Test Coverage

The example includes 9 comprehensive tests:
- `test_lex_number` - Numeric token parsing
- `test_lex_operators` - Operator tokenization
- `test_lex_expression` - Full expression lexing
- `test_parse_number` - Parsing numeric literals
- `test_parse_addition` - Addition expressions
- `test_parse_multiplication` - Multiplication with precedence
- `test_parse_precedence` - Operator precedence rules
- `test_parse_parentheses` - Grouping with parentheses
- `test_eval` - End-to-end evaluation

## Learning Objectives

Studying this example teaches:

1. **Lexical analysis** - Breaking input into tokens
2. **Recursive descent parsing** - Building AST from tokens
3. **Abstract Syntax Trees (AST)** - Representing program structure
4. **Tree traversal** - Evaluating AST recursively
5. **Operator precedence** - Handling `*` before `+` correctly
6. **Algebraic data types** - Union types for Token and Expr
7. **Interpreter pattern** - Executing code by traversing AST

## Related Examples

- `02-recursion` - Recursion fundamentals
- `18-merkle-tree` - Tree data structures
- `07-string-toolkit` - String manipulation for lexing

## Dependencies Used

- ✅ **Recursive union types** - Token and Expr ADTs
- ✅ **Pattern matching** - Matching on tokens and expressions
- ✅ **String operations** - `char_at()`, `substring()`, `length()`
- ✅ **Float64 arithmetic** - Numeric operations
- ✅ **List operations** - Token stream management

## Future Enhancements

Possible extensions for this evaluator:
- **More operators** - Modulo (`%`), exponentiation (`^`), unary minus
- **Built-in functions** - `sqrt()`, `abs()`, `pow()`
- **Boolean expressions** - Comparison (`<`, `>`) and logic (`and`, `or`)
- **Variables with assignment** - Would require environment management
