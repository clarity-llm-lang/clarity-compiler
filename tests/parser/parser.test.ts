import { describe, it, expect } from "vitest";
import { Lexer } from "../../src/lexer/lexer.js";
import { Parser } from "../../src/parser/parser.js";

function parse(source: string) {
  const lexer = new Lexer(source, "test.clarity");
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, "test.clarity");
  return parser.parse();
}

describe("Parser", () => {
  describe("module declaration", () => {
    it("parses empty module", () => {
      const { module, errors } = parse("module Test");
      expect(errors).toHaveLength(0);
      expect(module.kind).toBe("ModuleDecl");
      expect(module.name).toBe("Test");
      expect(module.declarations).toHaveLength(0);
    });
  });

  describe("function declarations", () => {
    it("parses simple function", () => {
      const { module, errors } = parse(`
        module Test
        function add(a: Int64, b: Int64) -> Int64 { a + b }
      `);
      expect(errors).toHaveLength(0);
      expect(module.declarations).toHaveLength(1);
      const fn = module.declarations[0];
      expect(fn.kind).toBe("FunctionDecl");
      if (fn.kind === "FunctionDecl") {
        expect(fn.name).toBe("add");
        expect(fn.params).toHaveLength(2);
        expect(fn.params[0].name).toBe("a");
        expect(fn.params[1].name).toBe("b");
        expect(fn.returnType.name).toBe("Int64");
        expect(fn.effects).toHaveLength(0);
      }
    });

    it("parses function with effects", () => {
      const { module, errors } = parse(`
        module Test
        effect[DB, Log] function save(x: Int64) -> Int64 { x }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        expect(fn.effects).toEqual(["DB", "Log"]);
      }
    });

    it("parses function with no params", () => {
      const { module, errors } = parse(`
        module Test
        function zero() -> Int64 { 0 }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        expect(fn.params).toHaveLength(0);
      }
    });
  });

  describe("type declarations", () => {
    it("parses record type", () => {
      const { module, errors } = parse(`
        module Test
        type User = { id: Int64, email: String }
      `);
      expect(errors).toHaveLength(0);
      const td = module.declarations[0];
      expect(td.kind).toBe("TypeDecl");
      if (td.kind === "TypeDecl") {
        expect(td.name).toBe("User");
        expect(td.typeExpr.kind).toBe("RecordType");
      }
    });

    it("parses union type", () => {
      const { module, errors } = parse(`
        module Test
        type Result = | Ok(value: Int64) | Error(reason: String)
      `);
      expect(errors).toHaveLength(0);
      const td = module.declarations[0];
      if (td.kind === "TypeDecl" && td.typeExpr.kind === "UnionType") {
        expect(td.typeExpr.variants).toHaveLength(2);
        expect(td.typeExpr.variants[0].name).toBe("Ok");
        expect(td.typeExpr.variants[1].name).toBe("Error");
      }
    });

    it("parses unit variant", () => {
      const { module, errors } = parse(`
        module Test
        type Option = | Some(value: Int64) | None
      `);
      expect(errors).toHaveLength(0);
      const td = module.declarations[0];
      if (td.kind === "TypeDecl" && td.typeExpr.kind === "UnionType") {
        expect(td.typeExpr.variants[1].name).toBe("None");
        expect(td.typeExpr.variants[1].fields).toHaveLength(0);
      }
    });
  });

  describe("expressions", () => {
    it("parses binary expressions with precedence", () => {
      const { module, errors } = parse(`
        module Test
        function f(a: Int64, b: Int64, c: Int64) -> Int64 { a + b * c }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        const body = fn.body;
        expect(body.result?.kind).toBe("BinaryExpr");
        if (body.result?.kind === "BinaryExpr") {
          expect(body.result.op).toBe("+");
          expect(body.result.right.kind).toBe("BinaryExpr");
          if (body.result.right.kind === "BinaryExpr") {
            expect(body.result.right.op).toBe("*");
          }
        }
      }
    });

    it("parses match expression on bool", () => {
      const { module, errors } = parse(`
        module Test
        function abs(n: Int64) -> Int64 {
          match n >= 0 {
            True -> n,
            False -> 0 - n
          }
        }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        expect(fn.body.result?.kind).toBe("MatchExpr");
      }
    });

    it("parses let expressions in blocks", () => {
      const { module, errors } = parse(`
        module Test
        function f(x: Int64) -> Int64 {
          let a = x + 1;
          let b = a * 2;
          a + b
        }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        expect(fn.body.statements).toHaveLength(2);
        expect(fn.body.result?.kind).toBe("BinaryExpr");
      }
    });

    it("parses function calls", () => {
      const { module, errors } = parse(`
        module Test
        function f(x: Int64) -> Int64 { g(x, 42) }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl" && fn.body.result?.kind === "CallExpr") {
        expect(fn.body.result.args).toHaveLength(2);
      }
    });

    it("parses nested blocks", () => {
      const { module, errors } = parse(`
        module Test
        function f(n: Int64) -> Int64 {
          match n >= 0 {
            True -> n,
            False -> {
              let neg = 0 - n;
              neg
            }
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("patterns", () => {
    it("parses constructor patterns", () => {
      const { module, errors } = parse(`
        module Test
        type Shape = | Circle(r: Float64) | Rect(w: Float64, h: Float64)
        function f(s: Shape) -> Float64 {
          match s {
            Circle(r) -> r,
            Rect(w, h) -> w
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("parses wildcard pattern", () => {
      const { module, errors } = parse(`
        module Test
        function f(n: Int64) -> Int64 {
          match n {
            _ -> 0
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("mutable assignment", () => {
    it("parses let mut declaration", () => {
      const { module, errors } = parse(`
        module Test
        function f() -> Int64 {
          let mut x = 1;
          x
        }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        expect(fn.body.statements).toHaveLength(1);
        const letExpr = fn.body.statements[0];
        expect(letExpr.kind).toBe("LetExpr");
        if (letExpr.kind === "LetExpr") {
          expect(letExpr.mutable).toBe(true);
          expect(letExpr.name).toBe("x");
        }
      }
    });

    it("parses assignment expression", () => {
      const { module, errors } = parse(`
        module Test
        function f() -> Int64 {
          let mut x = 1;
          x = 2;
          x
        }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        expect(fn.body.statements).toHaveLength(2);
        const assign = fn.body.statements[1];
        expect(assign.kind).toBe("AssignmentExpr");
        if (assign.kind === "AssignmentExpr") {
          expect(assign.name).toBe("x");
        }
      }
    });

    it("parses assignment with complex rhs expression", () => {
      const { module, errors } = parse(`
        module Test
        function f() -> Int64 {
          let mut x = 1;
          x = x + 10;
          x
        }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        const assign = fn.body.statements[1];
        expect(assign.kind).toBe("AssignmentExpr");
        if (assign.kind === "AssignmentExpr") {
          expect(assign.value.kind).toBe("BinaryExpr");
        }
      }
    });
  });

  describe("function types", () => {
    it("parses function type in parameter position", () => {
      const { module, errors } = parse(`
        module Test
        function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        expect(fn.params[0].typeAnnotation.kind).toBe("FunctionType");
        if (fn.params[0].typeAnnotation.kind === "FunctionType") {
          expect(fn.params[0].typeAnnotation.paramTypes).toHaveLength(1);
          expect(fn.params[0].typeAnnotation.returnType.kind).toBe("TypeRef");
        }
      }
    });

    it("parses multi-param function type", () => {
      const { module, errors } = parse(`
        module Test
        function fold(xs: List<Int64>, acc: Int64, f: (Int64, Int64) -> Int64) -> Int64 { acc }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        const fParam = fn.params[2].typeAnnotation;
        expect(fParam.kind).toBe("FunctionType");
        if (fParam.kind === "FunctionType") {
          expect(fParam.paramTypes).toHaveLength(2);
        }
      }
    });

    it("parses zero-param function type", () => {
      const { module, errors } = parse(`
        module Test
        function run(f: () -> Int64) -> Int64 { f() }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0];
      if (fn.kind === "FunctionDecl") {
        const fParam = fn.params[0].typeAnnotation;
        expect(fParam.kind).toBe("FunctionType");
        if (fParam.kind === "FunctionType") {
          expect(fParam.paramTypes).toHaveLength(0);
        }
      }
    });
  });

  describe("error recovery", () => {
    it("provides helpful hint for if/else", () => {
      const { errors } = parse(`
        module Test
        if True { 1 }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].help).toContain("match");
    });

    it("provides helpful hint for return", () => {
      const { errors } = parse(`
        module Test
        return 42
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].help).toContain("last expression");
    });
  });

  describe("generic type parameters", () => {
    it("parses generic function with single type param", () => {
      const { module, errors } = parse(`
        module Test
        function identity<T>(x: T) -> T { x }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0] as any;
      expect(fn.kind).toBe("FunctionDecl");
      expect(fn.typeParams).toEqual(["T"]);
    });

    it("parses generic function with multiple type params", () => {
      const { module, errors } = parse(`
        module Test
        function pair<A, B>(a: A, b: B) -> A { a }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0] as any;
      expect(fn.typeParams).toEqual(["A", "B"]);
    });

    it("parses non-generic function with empty type params", () => {
      const { module, errors } = parse(`
        module Test
        function add(a: Int64, b: Int64) -> Int64 { a + b }
      `);
      expect(errors).toHaveLength(0);
      const fn = module.declarations[0] as any;
      expect(fn.typeParams).toEqual([]);
    });

    it("parses generic type declaration", () => {
      const { module, errors } = parse(`
        module Test
        type Wrapper<T> = { value: T }
      `);
      expect(errors).toHaveLength(0);
      const td = module.declarations[0] as any;
      expect(td.kind).toBe("TypeDecl");
      expect(td.typeParams).toEqual(["T"]);
    });
  });
});
