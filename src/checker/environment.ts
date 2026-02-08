import type { ClarityType } from "./types.js";
import type { Span } from "../errors/diagnostic.js";

export interface Symbol {
  name: string;
  type: ClarityType;
  mutable: boolean;
  defined: Span;
}

export class Environment {
  private scopes: Map<string, Symbol>[] = [new Map()];
  private typeScopes: Map<string, ClarityType>[] = [new Map()];

  enterScope(): void {
    this.scopes.push(new Map());
    this.typeScopes.push(new Map());
  }

  exitScope(): void {
    this.scopes.pop();
    this.typeScopes.pop();
  }

  define(name: string, sym: Symbol): boolean {
    const current = this.scopes[this.scopes.length - 1];
    if (current.has(name)) return false; // already defined in this scope
    current.set(name, sym);
    return true;
  }

  lookup(name: string): Symbol | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const sym = this.scopes[i].get(name);
      if (sym) return sym;
    }
    return undefined;
  }

  defineType(name: string, type: ClarityType): boolean {
    const current = this.typeScopes[this.typeScopes.length - 1];
    if (current.has(name)) return false;
    current.set(name, type);
    return true;
  }

  lookupType(name: string): ClarityType | undefined {
    for (let i = this.typeScopes.length - 1; i >= 0; i--) {
      const t = this.typeScopes[i].get(name);
      if (t) return t;
    }
    return undefined;
  }
}
