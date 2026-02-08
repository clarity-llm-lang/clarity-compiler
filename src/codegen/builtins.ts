// Built-in functions that will be provided by the runtime
// For MVP, this is mostly a placeholder

export interface BuiltinDef {
  name: string;
  importModule: string;
  importName: string;
  paramTypes: string[];
  returnType: string;
}

export const BUILTINS: BuiltinDef[] = [
  // Future built-ins:
  // { name: "print", importModule: "env", importName: "print", paramTypes: ["i32"], returnType: "none" },
];
