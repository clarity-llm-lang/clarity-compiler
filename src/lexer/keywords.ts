import { TokenKind } from "./tokens.js";

export const KEYWORDS: Map<string, TokenKind> = new Map([
  ["module", TokenKind.Module],
  ["function", TokenKind.Function],
  ["type", TokenKind.Type],
  ["const", TokenKind.Const],
  ["let", TokenKind.Let],
  ["mut", TokenKind.Mut],
  ["match", TokenKind.Match],
  ["effect", TokenKind.Effect],
  ["True", TokenKind.True],
  ["False", TokenKind.False],
  ["and", TokenKind.And],
  ["or", TokenKind.Or],
  ["if", TokenKind.If],
]);
