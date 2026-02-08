import { Lexer } from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
import { Checker } from "./checker/checker.js";
import { CodeGenerator } from "./codegen/codegen.js";
import type { Token } from "./lexer/tokens.js";
import type { ModuleDecl } from "./ast/nodes.js";
import type { Diagnostic } from "./errors/diagnostic.js";

export interface CompileOptions {
  checkOnly?: boolean;
  emitAst?: boolean;
  emitTokens?: boolean;
  emitWat?: boolean;
}

export interface CompileResult {
  tokens?: Token[];
  ast?: ModuleDecl;
  errors: Diagnostic[];
  wasm?: Uint8Array;
  wat?: string;
}

export function compile(
  source: string,
  filename: string,
  options: CompileOptions = {},
): CompileResult {
  // 1. Lex
  const lexer = new Lexer(source, filename);
  const tokens = lexer.tokenize();

  if (options.emitTokens) {
    return { tokens, errors: [] };
  }

  // 2. Parse
  const parser = new Parser(tokens, filename);
  const { module: ast, errors: parseErrors } = parser.parse();

  if (parseErrors.length > 0) {
    return { tokens, ast, errors: parseErrors };
  }

  if (options.emitAst) {
    return { tokens, ast, errors: [] };
  }

  // 3. Type Check
  const checker = new Checker();
  const checkErrors = checker.check(ast);

  if (checkErrors.length > 0) {
    return { tokens, ast, errors: checkErrors };
  }

  if (options.checkOnly) {
    return { tokens, ast, errors: [] };
  }

  // 4. Code Generation
  try {
    const codegen = new CodeGenerator();

    if (options.emitWat) {
      const wat = codegen.generateText(ast, checker);
      return { tokens, ast, errors: [], wat };
    }

    const wasm = codegen.generate(ast, checker);
    return { tokens, ast, errors: [], wasm };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      tokens,
      ast,
      errors: [{
        severity: "error",
        message: `Code generation failed: ${msg}`,
        span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 }, source: filename },
      }],
    };
  }
}
