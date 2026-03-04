export declare enum TokenKind {
    IntLiteral = "IntLiteral",
    FloatLiteral = "FloatLiteral",
    StringLiteral = "StringLiteral",
    InterpolatedString = "InterpolatedString",
    Identifier = "Identifier",
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
    LParen = "(",
    RParen = ")",
    LBrace = "{",
    RBrace = "}",
    LBracket = "[",
    RBracket = "]",
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
    Arrow = "->",
    Pipe = "|",
    Comma = ",",
    Colon = ":",
    Semicolon = ";",
    Dot = ".",
    DotDot = "..",
    Eq = "=",
    Underscore = "_",
    EOF = "EOF",
    Error = "Error"
}
export interface Token {
    kind: TokenKind;
    value: string;
    span: {
        start: {
            offset: number;
            line: number;
            column: number;
        };
        end: {
            offset: number;
            line: number;
            column: number;
        };
        source: string;
    };
    interpolation?: {
        parts: string[];
        exprSources: string[];
        exprOffsets: number[];
    };
}
