import binaryen from "binaryen";
import type { ClarityType } from "../checker/types.js";
export declare function clarityTypeToWasm(type: ClarityType): binaryen.Type;
export declare function isNumericType(type: ClarityType): boolean;
export declare function isI64(type: ClarityType): boolean;
export declare function isF64(type: ClarityType): boolean;
