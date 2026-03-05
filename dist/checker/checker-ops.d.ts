import type { Diagnostic, Span } from "../errors/diagnostic.js";
import type { ClarityType } from "./types.js";
export declare function checkBinaryOp(diagnostics: Diagnostic[], op: string, left: ClarityType, right: ClarityType, span: Span): ClarityType;
export declare function checkUnaryOp(diagnostics: Diagnostic[], op: string, operand: ClarityType, span: Span): ClarityType;
