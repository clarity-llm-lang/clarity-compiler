import type { Diagnostic } from "../errors/diagnostic.js";
import type { Token } from "../lexer/tokens.js";
export declare function unexpectedToken(token: Token, expected?: string): Diagnostic;
export declare function clarityHint(token: Token): Diagnostic | null;
