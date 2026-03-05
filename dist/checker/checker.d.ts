import type { Diagnostic, Span } from "../errors/diagnostic.js";
import type { ModuleDecl, Expr, Pattern, TypeNode } from "../ast/nodes.js";
import { type ClarityType } from "./types.js";
import { Environment } from "./environment.js";
export declare class Checker {
    env: Environment;
    diagnostics: Diagnostic[];
    currentEffects: Set<string>;
    private typeParamsInScope;
    private optionTypes;
    private resultTypes;
    private builtinsRegistered;
    check(module: ModuleDecl): Diagnostic[];
    /**
     * Check a module with optional imported symbols and types.
     * Used for multi-file compilation where imports are pre-resolved.
     */
    checkModule(module: ModuleDecl, importedSymbols?: {
        name: string;
        type: ClarityType;
        span: Span;
    }[], importedTypes?: {
        name: string;
        type: ClarityType;
    }[]): Diagnostic[];
    /** Register variant constructors for an imported union type */
    private registerVariantConstructor;
    /** Look up a symbol by name (for export collection) */
    lookupSymbol(name: string): import("./environment.js").Symbol | undefined;
    /** Look up a type by name (for export collection) */
    lookupType(name: string): ClarityType | undefined;
    private registerBuiltins;
    private registerTypeDecl;
    findRecordType(fieldNames: Set<string>, fieldTypes?: Map<string, ClarityType>): (ClarityType & {
        kind: "Record";
    }) | null;
    private resolveTypeExpr;
    resolveTypeRef(node: TypeNode): ClarityType | null;
    makeOptionType(inner: ClarityType): ClarityType;
    getOptionTypes(): Map<string, ClarityType>;
    makeResultType(okType: ClarityType, errType: ClarityType): ClarityType;
    resultToUnion(resultType: Extract<ClarityType, {
        kind: "Result";
    }>): ClarityType & {
        kind: "Union";
    };
    getResultTypes(): Map<string, ClarityType>;
    private registerFunctionSignature;
    private checkFunctionBody;
    private checkConstDecl;
    checkExpr(expr: Expr): ClarityType;
    checkPattern(pattern: Pattern, expectedType: ClarityType): void;
}
