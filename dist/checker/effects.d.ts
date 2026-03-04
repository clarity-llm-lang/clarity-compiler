import type { Span } from "../errors/diagnostic.js";
import type { Diagnostic } from "../errors/diagnostic.js";
export declare const KNOWN_EFFECTS: Set<string>;
export declare function validateEffectNames(effects: string[], span: Span): Diagnostic[];
export declare function checkEffectSafety(callerEffects: Set<string>, calleeEffects: Set<string>, callSpan: Span): Diagnostic[];
