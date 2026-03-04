import { type Token } from "./tokens.js";
export declare class Lexer {
    private source;
    private filename;
    private pos;
    private line;
    private col;
    constructor(source: string, filename?: string);
    tokenize(): Token[];
    private nextToken;
    private readNumber;
    private readIdentOrKeyword;
    private readString;
    private readTripleQuoteString;
    private readPunctuation;
    private skipWhitespaceAndComments;
    private advance;
    private makeToken;
    private isDigit;
    private isAlpha;
    private isAlphaNum;
}
