export var TokenKind;
(function (TokenKind) {
    // Literals
    TokenKind["IntLiteral"] = "IntLiteral";
    TokenKind["FloatLiteral"] = "FloatLiteral";
    TokenKind["StringLiteral"] = "StringLiteral";
    TokenKind["InterpolatedString"] = "InterpolatedString";
    // Identifiers
    TokenKind["Identifier"] = "Identifier";
    // Keywords
    TokenKind["Module"] = "module";
    TokenKind["Import"] = "import";
    TokenKind["Export"] = "export";
    TokenKind["From"] = "from";
    TokenKind["Function"] = "function";
    TokenKind["Type"] = "type";
    TokenKind["Const"] = "const";
    TokenKind["Let"] = "let";
    TokenKind["Mut"] = "mut";
    TokenKind["Match"] = "match";
    TokenKind["Effect"] = "effect";
    TokenKind["True"] = "True";
    TokenKind["False"] = "False";
    TokenKind["And"] = "and";
    TokenKind["Or"] = "or";
    TokenKind["If"] = "if";
    // Delimiters
    TokenKind["LParen"] = "(";
    TokenKind["RParen"] = ")";
    TokenKind["LBrace"] = "{";
    TokenKind["RBrace"] = "}";
    TokenKind["LBracket"] = "[";
    TokenKind["RBracket"] = "]";
    // Operators
    TokenKind["Plus"] = "+";
    TokenKind["Minus"] = "-";
    TokenKind["Star"] = "*";
    TokenKind["Slash"] = "/";
    TokenKind["Percent"] = "%";
    TokenKind["PlusPlus"] = "++";
    TokenKind["EqEq"] = "==";
    TokenKind["NotEq"] = "!=";
    TokenKind["Lt"] = "<";
    TokenKind["Gt"] = ">";
    TokenKind["LtEq"] = "<=";
    TokenKind["GtEq"] = ">=";
    TokenKind["Bang"] = "!";
    // Punctuation
    TokenKind["Arrow"] = "->";
    TokenKind["Pipe"] = "|";
    TokenKind["Comma"] = ",";
    TokenKind["Colon"] = ":";
    TokenKind["Semicolon"] = ";";
    TokenKind["Dot"] = ".";
    TokenKind["DotDot"] = "..";
    TokenKind["Eq"] = "=";
    TokenKind["Underscore"] = "_";
    // Special
    TokenKind["EOF"] = "EOF";
    TokenKind["Error"] = "Error";
})(TokenKind || (TokenKind = {}));
//# sourceMappingURL=tokens.js.map