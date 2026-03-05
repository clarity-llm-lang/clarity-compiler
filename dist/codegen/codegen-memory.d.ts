import binaryen from "binaryen";
import type { ClarityType, ClarityVariant } from "../checker/types.js";
export declare function fieldSize(type: ClarityType): number;
export declare function fieldAlign(type: ClarityType): number;
export declare function recordLayout(fields: Map<string, ClarityType>): {
    name: string;
    type: ClarityType;
    offset: number;
}[];
export declare function recordSize(fields: Map<string, ClarityType>): number;
export declare function unionSize(variants: ClarityVariant[]): number;
export declare function storeField(mod: binaryen.Module, basePtr: binaryen.ExpressionRef, offset: number, value: binaryen.ExpressionRef, type: ClarityType): binaryen.ExpressionRef;
export declare function loadField(mod: binaryen.Module, basePtr: binaryen.ExpressionRef, offset: number, type: ClarityType): binaryen.ExpressionRef;
