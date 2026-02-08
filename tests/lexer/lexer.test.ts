import { describe, it, expect } from "vitest";
import { Lexer } from "../../src/lexer/lexer.js";
import { TokenKind } from "../../src/lexer/tokens.js";

describe("Lexer", () => {
  function tokenKinds(source: string): TokenKind[] {
    const lexer = new Lexer(source, "test.clarity");
    return lexer.tokenize().map((t) => t.kind);
  }

  function tokenValues(source: string): string[] {
    const lexer = new Lexer(source, "test.clarity");
    return lexer.tokenize().map((t) => t.value);
  }

  it("tokenizes empty input", () => {
    expect(tokenKinds("")).toEqual([TokenKind.EOF]);
  });

  it("tokenizes integers", () => {
    expect(tokenKinds("42")).toEqual([TokenKind.IntLiteral, TokenKind.EOF]);
    expect(tokenValues("42")[0]).toBe("42");
  });

  it("tokenizes floats", () => {
    expect(tokenKinds("3.14")).toEqual([TokenKind.FloatLiteral, TokenKind.EOF]);
    expect(tokenValues("3.14")[0]).toBe("3.14");
  });

  it("tokenizes strings", () => {
    const tokens = new Lexer('"hello world"', "test").tokenize();
    expect(tokens[0].kind).toBe(TokenKind.StringLiteral);
    expect(tokens[0].value).toBe("hello world");
  });

  it("handles string escapes", () => {
    const tokens = new Lexer('"hello\\nworld"', "test").tokenize();
    expect(tokens[0].value).toBe("hello\nworld");
  });

  it("reports unterminated strings", () => {
    const tokens = new Lexer('"unterminated', "test").tokenize();
    expect(tokens[0].kind).toBe(TokenKind.Error);
  });

  it("tokenizes keywords", () => {
    expect(tokenKinds("module function type const let mut match effect")).toEqual([
      TokenKind.Module, TokenKind.Function, TokenKind.Type, TokenKind.Const,
      TokenKind.Let, TokenKind.Mut, TokenKind.Match, TokenKind.Effect,
      TokenKind.EOF,
    ]);
  });

  it("tokenizes True and False", () => {
    expect(tokenKinds("True False")).toEqual([
      TokenKind.True, TokenKind.False, TokenKind.EOF,
    ]);
  });

  it("tokenizes identifiers", () => {
    expect(tokenKinds("foo bar_baz x123")).toEqual([
      TokenKind.Identifier, TokenKind.Identifier, TokenKind.Identifier, TokenKind.EOF,
    ]);
  });

  it("distinguishes keywords from similar identifiers", () => {
    // 'matched' should be Identifier, not Match + 'ed'
    expect(tokenKinds("matched")).toEqual([TokenKind.Identifier, TokenKind.EOF]);
    expect(tokenValues("matched")[0]).toBe("matched");
  });

  it("tokenizes operators", () => {
    expect(tokenKinds("+ - * / % ++ == != < > <= >=")).toEqual([
      TokenKind.Plus, TokenKind.Minus, TokenKind.Star, TokenKind.Slash,
      TokenKind.Percent, TokenKind.PlusPlus, TokenKind.EqEq, TokenKind.NotEq,
      TokenKind.Lt, TokenKind.Gt, TokenKind.LtEq, TokenKind.GtEq,
      TokenKind.EOF,
    ]);
  });

  it("tokenizes punctuation", () => {
    expect(tokenKinds("-> | , : ; . = ( ) { } [ ]")).toEqual([
      TokenKind.Arrow, TokenKind.Pipe, TokenKind.Comma, TokenKind.Colon,
      TokenKind.Semicolon, TokenKind.Dot, TokenKind.Eq,
      TokenKind.LParen, TokenKind.RParen, TokenKind.LBrace, TokenKind.RBrace,
      TokenKind.LBracket, TokenKind.RBracket,
      TokenKind.EOF,
    ]);
  });

  it("tokenizes underscore as wildcard", () => {
    expect(tokenKinds("_")).toEqual([TokenKind.Underscore, TokenKind.EOF]);
  });

  it("skips line comments", () => {
    expect(tokenKinds("42 // this is a comment\n43")).toEqual([
      TokenKind.IntLiteral, TokenKind.IntLiteral, TokenKind.EOF,
    ]);
  });

  it("tracks line and column numbers", () => {
    const tokens = new Lexer("foo\nbar", "test").tokenize();
    expect(tokens[0].span.start.line).toBe(1);
    expect(tokens[0].span.start.column).toBe(1);
    expect(tokens[1].span.start.line).toBe(2);
    expect(tokens[1].span.start.column).toBe(1);
  });

  it("tokenizes a simple function declaration", () => {
    const source = "function add(a: Int64, b: Int64) -> Int64 { a + b }";
    expect(tokenKinds(source)).toEqual([
      TokenKind.Function, TokenKind.Identifier,
      TokenKind.LParen,
      TokenKind.Identifier, TokenKind.Colon, TokenKind.Identifier, TokenKind.Comma,
      TokenKind.Identifier, TokenKind.Colon, TokenKind.Identifier,
      TokenKind.RParen,
      TokenKind.Arrow, TokenKind.Identifier,
      TokenKind.LBrace,
      TokenKind.Identifier, TokenKind.Plus, TokenKind.Identifier,
      TokenKind.RBrace,
      TokenKind.EOF,
    ]);
  });

  it("tokenizes effect annotation", () => {
    expect(tokenKinds("effect[DB, Log]")).toEqual([
      TokenKind.Effect, TokenKind.LBracket,
      TokenKind.Identifier, TokenKind.Comma, TokenKind.Identifier,
      TokenKind.RBracket, TokenKind.EOF,
    ]);
  });
});
