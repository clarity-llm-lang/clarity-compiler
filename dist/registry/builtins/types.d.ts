import { INT64, FLOAT64, STRING, BOOL, UNIT, BYTES, TIMESTAMP, type ClarityType } from "../../checker/types.js";
export { INT64, FLOAT64, STRING, BOOL, UNIT, BYTES, TIMESTAMP };
export type { ClarityType };
export interface ClarityBuiltin {
    name: string;
    params: ClarityType[];
    paramNames: string[];
    returnType: ClarityType;
    effects: string[];
    doc: string;
    category: string;
}
export interface EffectDefinition {
    name: string;
    description: string;
}
export declare const LIST_INT: ClarityType;
export declare const LIST_STRING: ClarityType;
export declare const MAP_STRING_STRING: ClarityType;
export declare const OPTION_STRING: ClarityType;
export declare const OPTION_MAP_STRING_STRING: ClarityType;
export declare const T: ClarityType;
export declare const LIST_T: ClarityType;
export declare const K: ClarityType;
export declare const V: ClarityType;
export declare const MAP_KV: ClarityType;
export declare const LIST_K: ClarityType;
export declare const LIST_V: ClarityType;
