export type ClarityType = {
    kind: "Int64";
} | {
    kind: "Float64";
} | {
    kind: "String";
} | {
    kind: "Bool";
} | {
    kind: "Bytes";
} | {
    kind: "Timestamp";
} | {
    kind: "Unit";
} | {
    kind: "Record";
    name: string;
    fields: Map<string, ClarityType>;
} | {
    kind: "Union";
    name: string;
    variants: ClarityVariant[];
} | {
    kind: "List";
    element: ClarityType;
} | {
    kind: "Map";
    key: ClarityType;
    value: ClarityType;
} | {
    kind: "Option";
    inner: ClarityType;
} | {
    kind: "Result";
    ok: ClarityType;
    err: ClarityType;
} | {
    kind: "Function";
    params: ClarityType[];
    paramNames?: string[];
    returnType: ClarityType;
    effects: Set<string>;
} | {
    kind: "TypeVar";
    name: string;
} | {
    kind: "Error";
};
export interface ClarityVariant {
    name: string;
    fields: Map<string, ClarityType>;
}
export declare const INT64: ClarityType;
export declare const FLOAT64: ClarityType;
export declare const STRING: ClarityType;
export declare const BOOL: ClarityType;
export declare const BYTES: ClarityType;
export declare const TIMESTAMP: ClarityType;
export declare const UNIT: ClarityType;
export declare const ERROR_TYPE: ClarityType;
export declare function typesEqual(a: ClarityType, b: ClarityType): boolean;
export declare function isPlaceholderType(t: ClarityType): boolean;
export declare function promoteType(a: ClarityType, b: ClarityType): ClarityType;
export declare function typeToString(t: ClarityType): string;
export declare function resolveBuiltinType(name: string): ClarityType | null;
export declare function containsTypeVar(t: ClarityType): boolean;
export declare function substituteTypeVars(t: ClarityType, subst: Map<string, ClarityType>): ClarityType;
export declare function unifyTypes(generic: ClarityType, concrete: ClarityType, bindings: Map<string, ClarityType>): boolean;
