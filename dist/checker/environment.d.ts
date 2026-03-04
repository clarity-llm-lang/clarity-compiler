import type { ClarityType } from "./types.js";
import type { Span } from "../errors/diagnostic.js";
export interface Symbol {
    name: string;
    type: ClarityType;
    mutable: boolean;
    defined: Span;
}
export declare class Environment {
    private scopes;
    private typeScopes;
    enterScope(): void;
    exitScope(): void;
    define(name: string, sym: Symbol): boolean;
    /** Like define, but overwrites if already defined in the current scope. */
    redefine(name: string, sym: Symbol): void;
    lookup(name: string): Symbol | undefined;
    defineType(name: string, type: ClarityType): boolean;
    lookupType(name: string): ClarityType | undefined;
    allTypes(): IterableIterator<[string, ClarityType]>;
}
