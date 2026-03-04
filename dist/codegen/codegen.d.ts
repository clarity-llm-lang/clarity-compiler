import type { ModuleDecl } from "../ast/nodes.js";
import { Checker } from "../checker/checker.js";
export declare class CodeGenerator {
    private mod;
    private locals;
    private localIndex;
    private additionalLocals;
    private checker;
    private currentFunction;
    private stringLiterals;
    private dataSegmentOffset;
    private dataSegments;
    private allFunctions;
    private allTypeDecls;
    private functionTableNames;
    private functionTableIndices;
    private currentModuleWasmNames;
    private functionDeclWasmNames;
    private lambdaCounter;
    private pendingLambdas;
    private generatedMonomorphs;
    private typeVarSubst;
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
    private scanExprForStrings;
    private fieldSize;
    private fieldAlign;
    private recordLayout;
    private recordSize;
    private unionSize;
    private storeField;
    private loadField;
    private allocStringLiteral;
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
