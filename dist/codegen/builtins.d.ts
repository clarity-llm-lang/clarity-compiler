import binaryen from "binaryen";
export interface BuiltinDef {
    name: string;
    importModule: string;
    importName: string;
    params: binaryen.Type;
    result: binaryen.Type;
}
export declare function getBuiltins(): BuiltinDef[];
