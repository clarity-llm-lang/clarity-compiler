import { TokenKind, type Token } from "./tokens.js";
import { KEYWORDS } from "./keywords.js";

export class Lexer {
  private source: string;
  private filename: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;

  constructor(source: string, filename: string = "<stdin>") {
    this.source = source;
    this.filename = filename;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;
      tokens.push(this.nextToken());
    }
    tokens.push(this.makeToken(TokenKind.EOF, "", this.pos, this.line, this.col));
    return tokens;
  }

  private nextToken(): Token {
    const ch = this.source[this.pos];

    if (this.isDigit(ch)) return this.readNumber();
    if (this.isAlpha(ch) || ch === "_") return this.readIdentOrKeyword();
    if (ch === '"') return this.readString();

    return this.readPunctuation();
  }

  private readNumber(): Token {
    const startPos = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    let isFloat = false;

    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      this.advance();
    }

    if (
      this.pos < this.source.length &&
      this.source[this.pos] === "." &&
      this.pos + 1 < this.source.length &&
      this.isDigit(this.source[this.pos + 1])
    ) {
      isFloat = true;
      this.advance(); // skip '.'
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        this.advance();
      }
    }

    const value = this.source.slice(startPos, this.pos);
    return this.makeToken(
      isFloat ? TokenKind.FloatLiteral : TokenKind.IntLiteral,
      value,
      startPos,
      startLine,
      startCol,
    );
  }

  private readIdentOrKeyword(): Token {
    const startPos = this.pos;
    const startLine = this.line;
    const startCol = this.col;

    while (
      this.pos < this.source.length &&
      (this.isAlphaNum(this.source[this.pos]) || this.source[this.pos] === "_")
    ) {
      this.advance();
    }

    const value = this.source.slice(startPos, this.pos);

    // Single underscore is the wildcard token
    if (value === "_") {
      return this.makeToken(TokenKind.Underscore, value, startPos, startLine, startCol);
    }

    const keyword = KEYWORDS.get(value);
    if (keyword !== undefined) {
      return this.makeToken(keyword, value, startPos, startLine, startCol);
    }

    return this.makeToken(TokenKind.Identifier, value, startPos, startLine, startCol);
  }

  private readString(): Token {
    const startPos = this.pos;
    const startLine = this.line;
    const startCol = this.col;

    this.advance(); // skip first "

    // Check for triple-quote """
    if (
      this.pos < this.source.length && this.source[this.pos] === '"' &&
      this.pos + 1 < this.source.length && this.source[this.pos + 1] === '"'
    ) {
      this.advance(); // skip second "
      this.advance(); // skip third "
      return this.readTripleQuoteString(startPos, startLine, startCol);
    }

    let value = "";

    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      if (this.source[this.pos] === "\\") {
        this.advance(); // skip backslash
        if (this.pos < this.source.length) {
          const escaped = this.source[this.pos];
          switch (escaped) {
            case "n": value += "\n"; break;
            case "t": value += "\t"; break;
            case "\\": value += "\\"; break;
            case '"': value += '"'; break;
            default:
              value += "\\" + escaped;
          }
          this.advance();
        }
      } else {
        value += this.source[this.pos];
        this.advance();
      }
    }

    if (this.pos >= this.source.length) {
      return this.makeToken(TokenKind.Error, "Unterminated string literal", startPos, startLine, startCol);
    }

    this.advance(); // skip closing "
    return this.makeToken(TokenKind.StringLiteral, value, startPos, startLine, startCol);
  }

  private readTripleQuoteString(startPos: number, startLine: number, startCol: number): Token {
    let value = "";

    // Skip the first newline after opening """ if present
    if (this.pos < this.source.length && this.source[this.pos] === "\n") {
      this.advance();
    } else if (
      this.pos + 1 < this.source.length &&
      this.source[this.pos] === "\r" && this.source[this.pos + 1] === "\n"
    ) {
      this.advance();
      this.advance();
    }

    while (this.pos < this.source.length) {
      // Check for closing """
      if (
        this.source[this.pos] === '"' &&
        this.pos + 1 < this.source.length && this.source[this.pos + 1] === '"' &&
        this.pos + 2 < this.source.length && this.source[this.pos + 2] === '"'
      ) {
        this.advance(); // skip first "
        this.advance(); // skip second "
        this.advance(); // skip third "
        return this.makeToken(TokenKind.StringLiteral, value, startPos, startLine, startCol);
      }

      if (this.source[this.pos] === "\\") {
        this.advance(); // skip backslash
        if (this.pos < this.source.length) {
          const escaped = this.source[this.pos];
          switch (escaped) {
            case "n": value += "\n"; break;
            case "t": value += "\t"; break;
            case "\\": value += "\\"; break;
            case '"': value += '"'; break;
            default:
              value += "\\" + escaped;
          }
          this.advance();
        }
      } else {
        value += this.source[this.pos];
        this.advance();
      }
    }

    return this.makeToken(TokenKind.Error, "Unterminated multi-line string literal", startPos, startLine, startCol);
  }

  private readPunctuation(): Token {
    const startPos = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    const ch = this.source[this.pos];
    const next = this.pos + 1 < this.source.length ? this.source[this.pos + 1] : "";

    // Two-character tokens
    switch (ch + next) {
      case "->": this.advance(); this.advance(); return this.makeToken(TokenKind.Arrow, "->", startPos, startLine, startCol);
      case "++": this.advance(); this.advance(); return this.makeToken(TokenKind.PlusPlus, "++", startPos, startLine, startCol);
      case "==": this.advance(); this.advance(); return this.makeToken(TokenKind.EqEq, "==", startPos, startLine, startCol);
      case "!=": this.advance(); this.advance(); return this.makeToken(TokenKind.NotEq, "!=", startPos, startLine, startCol);
      case "<=": this.advance(); this.advance(); return this.makeToken(TokenKind.LtEq, "<=", startPos, startLine, startCol);
      case ">=": this.advance(); this.advance(); return this.makeToken(TokenKind.GtEq, ">=", startPos, startLine, startCol);
      case "..": this.advance(); this.advance(); return this.makeToken(TokenKind.DotDot, "..", startPos, startLine, startCol);
    }

    // Single-character tokens
    this.advance();
    switch (ch) {
      case "(": return this.makeToken(TokenKind.LParen, ch, startPos, startLine, startCol);
      case ")": return this.makeToken(TokenKind.RParen, ch, startPos, startLine, startCol);
      case "{": return this.makeToken(TokenKind.LBrace, ch, startPos, startLine, startCol);
      case "}": return this.makeToken(TokenKind.RBrace, ch, startPos, startLine, startCol);
      case "[": return this.makeToken(TokenKind.LBracket, ch, startPos, startLine, startCol);
      case "]": return this.makeToken(TokenKind.RBracket, ch, startPos, startLine, startCol);
      case "+": return this.makeToken(TokenKind.Plus, ch, startPos, startLine, startCol);
      case "-": return this.makeToken(TokenKind.Minus, ch, startPos, startLine, startCol);
      case "*": return this.makeToken(TokenKind.Star, ch, startPos, startLine, startCol);
      case "/": return this.makeToken(TokenKind.Slash, ch, startPos, startLine, startCol);
      case "%": return this.makeToken(TokenKind.Percent, ch, startPos, startLine, startCol);
      case "<": return this.makeToken(TokenKind.Lt, ch, startPos, startLine, startCol);
      case ">": return this.makeToken(TokenKind.Gt, ch, startPos, startLine, startCol);
      case "!": return this.makeToken(TokenKind.Bang, ch, startPos, startLine, startCol);
      case "|": return this.makeToken(TokenKind.Pipe, ch, startPos, startLine, startCol);
      case ",": return this.makeToken(TokenKind.Comma, ch, startPos, startLine, startCol);
      case ":": return this.makeToken(TokenKind.Colon, ch, startPos, startLine, startCol);
      case ";": return this.makeToken(TokenKind.Semicolon, ch, startPos, startLine, startCol);
      case ".": return this.makeToken(TokenKind.Dot, ch, startPos, startLine, startCol);
      case "=": return this.makeToken(TokenKind.Eq, ch, startPos, startLine, startCol);
    }

    return this.makeToken(TokenKind.Error, `Unexpected character: '${ch}'`, startPos, startLine, startCol);
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];

      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
      } else if (ch === "\n") {
        this.advance();
      } else if (
        ch === "/" &&
        this.pos + 1 < this.source.length &&
        this.source[this.pos + 1] === "/"
      ) {
        // Line comment
        while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private advance(): void {
    if (this.pos < this.source.length) {
      if (this.source[this.pos] === "\n") {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
      this.pos++;
    }
  }

  private makeToken(
    kind: TokenKind,
    value: string,
    startPos: number,
    startLine: number,
    startCol: number,
  ): Token {
    return {
      kind,
      value,
      span: {
        start: { offset: startPos, line: startLine, column: startCol },
        end: { offset: this.pos, line: this.line, column: this.col },
        source: this.filename,
      },
    };
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  }

  private isAlphaNum(ch: string): boolean {
    return this.isDigit(ch) || this.isAlpha(ch);
  }
}
