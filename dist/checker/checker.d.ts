import type { Diagnostic, Span } from "../errors/diagnostic.js";
import type { ModuleDecl, Expr, TypeNode } from "../ast/nodes.js";
import { type ClarityType } from "./types.js";
export declare class Checker {
    private env;
    private diagnostics;
    private currentEffects;
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
    private findRecordType;
    private resolveTypeExpr;
    resolveTypeRef(node: TypeNode): ClarityType | null;
    makeOptionType(inner: ClarityType): ClarityType;
    private resolveSomeCall;
    private resolveNoneType;
    getOptionTypes(): Map<string, ClarityType>;
    makeResultType(okType: ClarityType, errType: ClarityType): ClarityType;
    private resolveOkCall;
    private resolveErrCall;
    resultToUnion(resultType: Extract<ClarityType, {
        kind: "Result";
    }>): ClarityType & {
        kind: "Union";
    };
    getResultTypes(): Map<string, ClarityType>;
    private registerFunctionSignature;
    private checkFunctionBody;
    private checkConstDecl;
    private tailCallees;
    private warnMutualTailRecursion;
    checkExpr(expr: Expr): ClarityType;
    private checkExprInner;
    private checkPattern;
    private checkBinaryOp;
    private checkUnaryOp;
}
