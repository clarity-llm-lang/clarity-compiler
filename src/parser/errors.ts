import type { Span } from "../errors/diagnostic.js";
import type { Diagnostic } from "../errors/diagnostic.js";
import { error } from "../errors/diagnostic.js";
import type { Token } from "../lexer/tokens.js";
import { TokenKind } from "../lexer/tokens.js";

export function unexpectedToken(token: Token, expected?: string): Diagnostic {
  const msg = expected
    ? `Expected ${expected}, got '${token.value}'`
    : `Unexpected token '${token.value}'`;
  return error(msg, token.span);
}

export function clarityHint(token: Token): Diagnostic | null {
  // Provide helpful messages when LLMs try to use constructs from other languages
  if (token.kind === TokenKind.Identifier) {
    switch (token.value) {
      case "if":
        return error(
          "Clarity does not have 'if' expressions",
          token.span,
          "Use 'match' for conditional logic: match condition { True -> ..., False -> ... }",
        );
      case "else":
        return error(
          "Clarity does not have 'else' expressions",
          token.span,
          "Use 'match' for conditional logic: match condition { True -> ..., False -> ... }",
        );
      case "while":
      case "for":
        return error(
          `Clarity does not have '${token.value}' loops`,
          token.span,
          "Use recursion or higher-order functions like map, filter, fold",
        );
      case "class":
      case "interface":
        return error(
          `Clarity does not have '${token.value}' declarations`,
          token.span,
          "Use 'type' to define record types or union types",
        );
      case "return":
        return error(
          "Clarity does not have explicit 'return'",
          token.span,
          "The last expression in a block is the return value",
        );
      case "null":
      case "nil":
      case "undefined":
        return error(
          `Clarity does not have '${token.value}'`,
          token.span,
          "Use Option type: Some(value) or None",
        );
      case "try":
      case "catch":
      case "throw":
        return error(
          `Clarity does not have exceptions ('${token.value}')`,
          token.span,
          "Use Result type: Ok(value) or Error(reason)",
        );
      case "var":
        return error(
          "Clarity does not have 'var'",
          token.span,
          "Use 'let' for immutable bindings or 'let mut' for mutable bindings",
        );
    }
  }
  return null;
}
