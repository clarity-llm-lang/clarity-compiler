export enum TokenKind {
  // Literals
  IntLiteral = "IntLiteral",
  FloatLiteral = "FloatLiteral",
  StringLiteral = "StringLiteral",

  // Identifiers
  Identifier = "Identifier",

  // Keywords
  Module = "module",
  Function = "function",
  Type = "type",
  Const = "const",
  Let = "let",
  Mut = "mut",
  Match = "match",
  Effect = "effect",
  True = "True",
  False = "False",
  And = "and",
  Or = "or",
  If = "if",

  // Delimiters
  LParen = "(",
  RParen = ")",
  LBrace = "{",
  RBrace = "}",
  LBracket = "[",
  RBracket = "]",

  // Operators
  Plus = "+",
  Minus = "-",
  Star = "*",
  Slash = "/",
  Percent = "%",
  PlusPlus = "++",
  EqEq = "==",
  NotEq = "!=",
  Lt = "<",
  Gt = ">",
  LtEq = "<=",
  GtEq = ">=",
  Bang = "!",

  // Punctuation
  Arrow = "->",
  Pipe = "|",
  Comma = ",",
  Colon = ":",
  Semicolon = ";",
  Dot = ".",
  Eq = "=",
  Underscore = "_",

  // Special
  EOF = "EOF",
  Error = "Error",
}

export interface Token {
  kind: TokenKind;
  value: string;
  span: {
    start: { offset: number; line: number; column: number };
    end: { offset: number; line: number; column: number };
    source: string;
  };
}
