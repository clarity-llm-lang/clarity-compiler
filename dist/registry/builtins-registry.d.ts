import { type ClarityType } from "../checker/types.js";
export interface ClarityBuiltin {
    /** Function name as used in Clarity source code */
    name: string;
    /** Clarity parameter types */
    params: ClarityType[];
    /** Clarity parameter names (must match params array length) */
    paramNames: string[];
    /** Clarity return type */
    returnType: ClarityType;
    /** Required effects (empty array = pure function) */
    effects: string[];
    /** LLM-readable description of what the function does */
    doc: string;
    /** Category for grouping: "io", "string", "math", "list", "conversion", "test", "log" */
    category: string;
}
export interface EffectDefinition {
    /** Effect name as used in effect[...] annotations */
    name: string;
    /** LLM-readable description of what this effect enables */
    description: string;
}
export declare const EFFECT_DEFINITIONS: EffectDefinition[];
export declare const CLARITY_BUILTINS: ClarityBuiltin[];
/** Get the set of all known effect names (for the checker) */
export declare function getKnownEffectNames(): Set<string>;
/** Get all built-ins for a given effect */
export declare function getBuiltinsForEffect(effectName: string): ClarityBuiltin[];
/** Get all built-ins in a given category */
export declare function getBuiltinsByCategory(category: string): ClarityBuiltin[];
