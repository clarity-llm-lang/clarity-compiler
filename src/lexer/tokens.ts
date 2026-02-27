export enum TokenKind {
  // Literals
  IntLiteral = "IntLiteral",
  FloatLiteral = "FloatLiteral",
  StringLiteral = "StringLiteral",
  InterpolatedString = "InterpolatedString",

  // Identifiers
  Identifier = "Identifier",

  // Keywords
  Module = "module",
  Import = "import",
  Export = "export",
  From = "from",
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
  DotDot = "..",
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
  // Only present for InterpolatedString tokens.
  // "Hello ${name}!" → parts: ["Hello ", "!"], exprSources: ["name"]
  interpolation?: {
    parts: string[];       // literal string segments (length = exprSources.length + 1)
    exprSources: string[]; // raw source text of each ${...} expression
    exprOffsets: number[]; // absolute source offset of each expression's start (for spans)
  };
}
