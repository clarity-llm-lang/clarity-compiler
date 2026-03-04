export class Environment {
    scopes = [new Map()];
    typeScopes = [new Map()];
    enterScope() {
        this.scopes.push(new Map());
        this.typeScopes.push(new Map());
    }
    exitScope() {
        this.scopes.pop();
        this.typeScopes.pop();
    }
    define(name, sym) {
        const current = this.scopes[this.scopes.length - 1];
        if (current.has(name))
            return false; // already defined in this scope
        current.set(name, sym);
        return true;
    }
    /** Like define, but overwrites if already defined in the current scope. */
    redefine(name, sym) {
        const current = this.scopes[this.scopes.length - 1];
        current.set(name, sym);
    }
    lookup(name) {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const sym = this.scopes[i].get(name);
            if (sym)
                return sym;
        }
        return undefined;
    }
    defineType(name, type) {
        const current = this.typeScopes[this.typeScopes.length - 1];
        if (current.has(name))
            return false;
        current.set(name, type);
        return true;
    }
    lookupType(name) {
        for (let i = this.typeScopes.length - 1; i >= 0; i--) {
            const t = this.typeScopes[i].get(name);
            if (t)
                return t;
        }
        return undefined;
    }
    /** Returns names visible in non-global scopes (locals, function params, let-bindings). */
    getNonGlobalNames() {
        const names = new Set();
        for (let i = 1; i < this.scopes.length; i++) {
            for (const name of this.scopes[i].keys())
                names.add(name);
        }
        return names;
    }
    allTypes() {
        const merged = new Map();
        for (const scope of this.typeScopes) {
            for (const [name, type] of scope) {
                merged.set(name, type);
            }
        }
        return merged.entries();
    }
}
//# sourceMappingURL=environment.js.map