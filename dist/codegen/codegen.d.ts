import binaryen from "binaryen";
import type { ModuleDecl, FunctionDecl } from "../ast/nodes.js";
import type { ClarityType } from "../checker/types.js";
import { Checker } from "../checker/checker.js";
export interface LocalVar {
    index: number;
    wasmType: binaryen.Type;
    clarityType: ClarityType;
}
export declare function assertResolvedType(type: ClarityType | null | undefined, context: string): ClarityType;
export declare class CodeGenerator {
    mod: binaryen.Module;
    locals: Map<string, LocalVar>;
    localIndex: number;
    additionalLocals: binaryen.Type[];
    checker: Checker;
    currentFunction: FunctionDecl;
    stringLiterals: Map<string, number>;
    dataSegmentOffset: number;
    dataSegments: {
        offset: number;
        data: Uint8Array;
    }[];
    allFunctions: Map<string, FunctionDecl>;
    allTypeDecls: Map<string, ClarityType>;
    functionTableNames: string[];
    functionTableIndices: Map<string, number>;
    currentModuleWasmNames: Map<string, string>;
    functionDeclWasmNames: Map<FunctionDecl, string>;
    lambdaCounter: number;
    pendingLambdas: Array<{
        name: string;
        expr: import("../ast/nodes.js").LambdaExpr;
    }>;
    lambdaWrappers: Map<string, number>;
    generatedMonomorphs: Set<string>;
    typeVarSubst: Map<string, ClarityType>;
    get _inferCtx(): {
        locals: Map<string, LocalVar>;
        allFunctions: Map<string, FunctionDecl>;
        allTypeDecls: Map<string, ClarityType>;
        functionTableIndices: Map<string, number>;
        typeVarSubst: Map<string, ClarityType>;
        currentFunction: FunctionDecl;
        checker: Checker;
        builtinReturnTypeMap: Map<string, ClarityType>;
    };
    generate(module: ModuleDecl, checker: Checker): Uint8Array;
    generateText(module: ModuleDecl, checker: Checker): string;
    /** Generate WASM binary from multiple modules merged into one */
    generateMulti(allModules: ModuleDecl[], entryModule: ModuleDecl, checker: Checker): Uint8Array;
    /** Generate WAT text from multiple modules merged into one */
    generateTextMulti(allModules: ModuleDecl[], entryModule: ModuleDecl, checker: Checker): string;
    private setupModule;
    /**
     * Set up WASM module from multiple Clarity modules merged into one.
     * All modules' declarations are compiled. Only the entry module's exported
     * functions are WASM-exported.
     */
    private setupModuleMulti;
    private resolveResultToUnion;
    /**
     * Recursively walk a ClarityType and ensure every Result<T,E> found at any
     * nesting depth is converted to its Union representation via resultToUnion()
     * and registered in allTypeDecls.  This is needed because the checker only
     * calls resultToUnion() at match-expression scrutiny sites, so Result types
     * that appear only in function signatures (e.g. List<Result<String,String>>)
     * never reach allTypeDecls and Ok/Err constructors cannot be found.
     */
    private registerNestedResultTypes;
    private prescanStringLiterals;
    private fieldSize;
    private fieldAlign;
    private recordLayout;
    private recordSize;
    private unionSize;
    private storeField;
    private loadField;
    private allocStringLiteral;
    /** Allocate `size` bytes on the runtime heap. */
    private callAlloc;
    /** Add a temporary (non-param) local to the current function frame and return its index. */
    private addTempLocal;
    /**
     * Allocate an 8-byte closure struct [func_table_idx: i32, env_ptr: i32] on the heap.
     * Returns an i32 expression that evaluates to the pointer to the closure struct.
     * `envPtrExpr` must be an i32 expression; pass `i32.const(0)` for non-capturing closures.
     */
    private buildClosureStruct;
    /**
     * Returns the function table index of the wrapper for a named function.
     * The wrapper has signature (env_ptr: i32, params...) -> ret so it can be
     * called via call_indirect with a uniform closure calling convention.
     * Wrappers are generated on demand and cached in `lambdaWrappers`.
     */
    private getOrCreateWrapper;
    private liftLambda;
    private generateFunction;
    /**
     * Generate a function for multi-module compilation.
     * Only WASM-exports functions that belong to the entry module.
     */
    private generateFunctionMulti;
    private isTailRecursive;
    private generateTailRecursiveBody;
    private generateExprTCO;
    private generateTailCallUpdate;
    private generateMatchTCO;
    private generateBoolMatchTCO;
    private generateUnionMatchTCO;
    private generateGenericMatchTCO;
    private generateExpr;
    private generateCall;
    private resolveTypeRefWithTypeParams;
    private generateMonomorphizedCall;
    private generateIndirectCall;
    private tryGenerateListCall;
    private tryGenerateMapCall;
    private findConstructorType;
    private generateConstructorCall;
    private generateRecordLiteral;
    private generateMemberAccess;
    private generateListLiteral;
    private generateBinary;
    private generateUnary;
    private generateMatch;
    private generateBoolMatch;
    private generateGuardedBoolMatch;
    private generateUnionMatch;
    private generateGenericMatch;
    private generatePatternCondition;
    private generateRangePatternCondition;
    private inferExprType;
    private inferFunctionType;
    private inferFunctionReturnType;
    private inferWasmReturnType;
}
