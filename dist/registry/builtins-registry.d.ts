export type { ClarityBuiltin, EffectDefinition } from "./builtins/types.js";
import type { ClarityBuiltin, EffectDefinition } from "./builtins/types.js";
export declare const EFFECT_DEFINITIONS: EffectDefinition[];
export declare const CLARITY_BUILTINS: ClarityBuiltin[];
/** Get the set of all known effect names (for the checker) */
export declare function getKnownEffectNames(): Set<string>;
/** Get all built-ins for a given effect */
export declare function getBuiltinsForEffect(effectName: string): ClarityBuiltin[];
/** Get all built-ins in a given category */
export declare function getBuiltinsByCategory(category: string): ClarityBuiltin[];
