import binaryen from "binaryen";
import type { ModuleDecl, Expr } from "../ast/nodes.js";
export interface StringContext {
    mod: binaryen.Module;
    stringLiterals: Map<string, number>;
    dataSegmentOffset: number;
    dataSegments: {
        offset: number;
        data: Uint8Array;
    }[];
}
export declare function allocStringLiteral(ctx: StringContext, value: string): number;
export declare function prescanStringLiterals(ctx: StringContext, module: ModuleDecl): void;
export declare function scanExprForStrings(ctx: StringContext, expr: Expr): void;
