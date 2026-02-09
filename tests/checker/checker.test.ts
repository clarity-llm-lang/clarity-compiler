import { describe, it, expect } from "vitest";
import { Lexer } from "../../src/lexer/lexer.js";
import { Parser } from "../../src/parser/parser.js";
import { Checker } from "../../src/checker/checker.js";

function check(source: string) {
  const lexer = new Lexer(source, "test.clarity");
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, "test.clarity");
  const { module, errors: parseErrors } = parser.parse();
  if (parseErrors.length > 0) return { errors: parseErrors };
  const checker = new Checker();
  const errors = checker.check(module);
  return { errors };
}

describe("Checker", () => {
  describe("basic type checking", () => {
    it("accepts valid Int64 arithmetic", () => {
      const { errors } = check(`
        module Test
        function add(a: Int64, b: Int64) -> Int64 { a + b }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts valid Float64 arithmetic", () => {
      const { errors } = check(`
        module Test
        function add(a: Float64, b: Float64) -> Float64 { a + b }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects mixing Int64 and Float64", () => {
      const { errors } = check(`
        module Test
        function bad(a: Int64, b: Float64) -> Int64 { a + b }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Int64");
      expect(errors[0].message).toContain("Float64");
    });

    it("rejects wrong return type", () => {
      const { errors } = check(`
        module Test
        function bad(a: Int64) -> Bool { a + 1 }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("return");
    });

    it("rejects undefined variables", () => {
      const { errors } = check(`
        module Test
        function bad() -> Int64 { x + 1 }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Undefined");
    });
  });

  describe("boolean operations", () => {
    it("accepts comparison operators returning Bool", () => {
      const { errors } = check(`
        module Test
        function cmp(a: Int64, b: Int64) -> Bool { a >= b }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts logical operators", () => {
      const { errors } = check(`
        module Test
        function logic(a: Bool, b: Bool) -> Bool { a and b }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects logical op on non-bool", () => {
      const { errors } = check(`
        module Test
        function bad(a: Int64, b: Int64) -> Bool { a and b }
      `);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("match expressions", () => {
    it("checks all arms return same type", () => {
      const { errors } = check(`
        module Test
        function f(n: Int64) -> Int64 {
          match n >= 0 {
            True -> n,
            False -> 0 - n
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("reports non-exhaustive bool match", () => {
      const { errors } = check(`
        module Test
        function f(n: Int64) -> Int64 {
          match n >= 0 {
            True -> n
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("exhaustive");
    });
  });

  describe("let bindings", () => {
    it("accepts let bindings in blocks", () => {
      const { errors } = check(`
        module Test
        function f(x: Int64) -> Int64 {
          let a = x + 1;
          let b = a * 2;
          a + b
        }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("mutable assignment", () => {
    it("accepts assignment to mutable variable", () => {
      const { errors } = check(`
        module Test
        function f() -> Int64 {
          let mut x = 1;
          x = 2;
          x
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects assignment to immutable variable", () => {
      const { errors } = check(`
        module Test
        function f() -> Int64 {
          let x = 1;
          x = 2;
          x
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("immutable");
    });

    it("rejects assignment with wrong type", () => {
      const { errors } = check(`
        module Test
        function f() -> Int64 {
          let mut x = 1;
          x = True;
          x
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Cannot assign");
    });

    it("rejects assignment to undefined variable", () => {
      const { errors } = check(`
        module Test
        function f() -> Int64 {
          y = 1;
          1
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Undefined");
    });

    it("rejects assignment to function parameter", () => {
      const { errors } = check(`
        module Test
        function f(x: Int64) -> Int64 {
          x = 2;
          x
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("immutable");
    });
  });

  describe("function calls", () => {
    it("checks argument count", () => {
      const { errors } = check(`
        module Test
        function add(a: Int64, b: Int64) -> Int64 { a + b }
        function bad() -> Int64 { add(1) }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("argument");
    });

    it("checks argument types", () => {
      const { errors } = check(`
        module Test
        function add(a: Int64, b: Int64) -> Int64 { a + b }
        function bad() -> Int64 { add(True, 1) }
      `);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("effect system", () => {
    it("rejects calling effectful function from pure function", () => {
      const { errors } = check(`
        module Test
        effect[DB] function save(x: Int64) -> Int64 { x }
        function bad() -> Int64 { save(42) }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("effect");
    });

    it("accepts matching effects", () => {
      const { errors } = check(`
        module Test
        effect[DB] function save(x: Int64) -> Int64 { x }
        effect[DB] function wrapper() -> Int64 { save(42) }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("union types", () => {
    it("checks exhaustiveness on union match", () => {
      const { errors } = check(`
        module Test
        type Shape = | Circle(r: Float64) | Rect(w: Float64, h: Float64)
        function name(s: Shape) -> Float64 {
          match s {
            Circle(r) -> r
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("exhaustive");
    });
  });

  describe("higher-order functions", () => {
    it("accepts function type parameter", () => {
      const { errors } = check(`
        module Test
        function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts passing function as argument", () => {
      const { errors } = check(`
        module Test
        function double(x: Int64) -> Int64 { x * 2 }
        function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
        function test() -> Int64 { apply(double, 5) }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects wrong function signature", () => {
      const { errors } = check(`
        module Test
        function greet(s: String) -> String { s }
        function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
        function bad() -> Int64 { apply(greet, 5) }
      `);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts multi-param function type", () => {
      const { errors } = check(`
        module Test
        function add(a: Int64, b: Int64) -> Int64 { a + b }
        function combine(f: (Int64, Int64) -> Int64, x: Int64, y: Int64) -> Int64 { f(x, y) }
        function test() -> Int64 { combine(add, 3, 4) }
      `);
      expect(errors).toHaveLength(0);
    });
  });
});
