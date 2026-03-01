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
        effect[Network] function fetch(x: Int64) -> Int64 { x }
        effect[Network] function wrapper() -> Int64 { fetch(42) }
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

  describe("generic functions", () => {
    it("accepts generic identity function", () => {
      const { errors } = check(`
        module Test
        function identity<T>(x: T) -> T { x }
        function test() -> Int64 { identity(42) }
      `);
      expect(errors).toHaveLength(0);
    });

    it("infers return type from generic function", () => {
      const { errors } = check(`
        module Test
        function identity<T>(x: T) -> T { x }
        function test() -> String { identity("hello") }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects wrong return type usage of generic function", () => {
      const { errors } = check(`
        module Test
        function identity<T>(x: T) -> T { x }
        function test() -> String { identity(42) }
      `);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts generic function with multiple type params", () => {
      const { errors } = check(`
        module Test
        function first<A, B>(a: A, b: B) -> A { a }
        function test() -> Int64 { first(42, "hello") }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts generic list operations with string lists", () => {
      const { errors } = check(`
        module Test
        effect[FileSystem] function test() -> Int64 {
          let args = get_args();
          list_length(args)
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("head infers correct element type", () => {
      const { errors } = check(`
        module Test
        function test() -> Int64 {
          let xs = [1, 2, 3];
          head(xs)
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("head of string list returns String", () => {
      const { errors } = check(`
        module Test
        function test() -> String {
          let xs = ["a", "b"];
          head(xs)
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects head of string list used as Int64", () => {
      const { errors } = check(`
        module Test
        function test() -> Int64 {
          let xs = ["a", "b"];
          head(xs)
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts generic type declaration", () => {
      const { errors } = check(`
        module Test
        type Wrapper<T> = { value: T }
      `);
      expect(errors).toHaveLength(0);
    });

    it("tail preserves list element type", () => {
      const { errors } = check(`
        module Test
        function test() -> Int64 {
          let xs = [1, 2, 3];
          head(tail(xs))
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("append with matching element type", () => {
      const { errors } = check(`
        module Test
        function test() -> Int64 {
          let xs = [1, 2];
          let ys = append(xs, 3);
          head(ys)
        }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("Result<T, E> built-in type", () => {
    it("accepts Result<Int64, String> type in function signature", () => {
      const { errors } = check(`
        module Test
        function test() -> Result<Int64, String> {
          Ok(42)
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts Err constructor", () => {
      const { errors } = check(`
        module Test
        function test() -> Result<Int64, String> {
          Err("something went wrong")
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts match on Result type", () => {
      const { errors } = check(`
        module Test
        function unwrap(r: Result<Int64, String>) -> Int64 {
          match r {
            Ok(value) -> value,
            Err(error) -> 0
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects returning raw Int64 when Result expected", () => {
      const { errors } = check(`
        module Test
        function test() -> Result<Int64, String> {
          42
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("requires exhaustive match on Result", () => {
      const { errors } = check(`
        module Test
        function test(r: Result<Int64, String>) -> Int64 {
          match r {
            Ok(value) -> value
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("type aliases", () => {
    it("accepts transparent type alias for built-in type", () => {
      const { errors } = check(`
        module Test
        type UserId = Int64
        function get_id() -> UserId { 42 }
      `);
      expect(errors).toHaveLength(0);
    });

    it("allows alias type to be used interchangeably with base type", () => {
      const { errors } = check(`
        module Test
        type UserId = Int64
        function add_one(id: UserId) -> Int64 { id + 1 }
      `);
      expect(errors).toHaveLength(0);
    });

    it("supports alias for String type", () => {
      const { errors } = check(`
        module Test
        type Email = String
        function greet(email: Email) -> String { "Hello " ++ email }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("named argument checking", () => {
    it("accepts correct named arguments", () => {
      const { errors } = check(`
        module Test
        function sub(a: Int64, b: Int64) -> Int64 { a - b }
        function main() -> Int64 { sub(a: 10, b: 3) }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts named arguments in different order", () => {
      const { errors } = check(`
        module Test
        function sub(a: Int64, b: Int64) -> Int64 { a - b }
        function main() -> Int64 { sub(b: 3, a: 10) }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects unknown parameter name", () => {
      const { errors } = check(`
        module Test
        function sub(a: Int64, b: Int64) -> Int64 { a - b }
        function main() -> Int64 { sub(x: 10, b: 3) }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Unknown parameter name 'x'");
    });

    it("rejects mixed named and positional arguments", () => {
      const { errors } = check(`
        module Test
        function sub(a: Int64, b: Int64) -> Int64 { a - b }
        function main() -> Int64 { sub(10, b: 3) }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Cannot mix named and positional");
    });

    it("rejects duplicate named argument", () => {
      const { errors } = check(`
        module Test
        function sub(a: Int64, b: Int64) -> Int64 { a - b }
        function main() -> Int64 { sub(a: 10, a: 3) }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Duplicate named argument");
    });

    it("validates named argument types after reordering", () => {
      const { errors } = check(`
        module Test
        function greet(name: String, times: Int64) -> String { name }
        function main() -> String { greet(times: 5, name: "hi") }
      `);
      expect(errors).toHaveLength(0);
    });

    it("catches type errors with named arguments", () => {
      const { errors } = check(`
        module Test
        function greet(name: String, times: Int64) -> String { name }
        function main() -> String { greet(times: "oops", name: "hi") }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("expected Int64");
    });

    it("supports named arguments on union variant constructors", () => {
      const { errors } = check(`
        module Test
        type Result = | Ok(value: Int64) | Error(reason: String)
        function main() -> Result { Ok(value: 42) }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("Pattern Guards", () => {
    it("accepts Bool guard on Bool match", () => {
      const { errors } = check(`
        module Test
        function sign(n: Int64) -> String {
          match n > 0 {
            True if n < 100 -> "small positive",
            True -> "large positive",
            False -> "non-positive"
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts guard on wildcard pattern", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> String {
          match n {
            _ if n > 0 -> "positive",
            _ -> "non-positive"
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts guard on binding pattern", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> String {
          match n {
            x if x > 0 -> "positive",
            x -> "non-positive"
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts guard on union constructor pattern", () => {
      const { errors } = check(`
        module Test
        type Option = | Some(value: Int64) | None
        function filter_large(opt: Option) -> String {
          match opt {
            Some(x) if x > 100 -> "large",
            Some(x) -> "small",
            None -> "none"
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects non-Bool guard", () => {
      const { errors } = check(`
        module Test
        function bad(n: Int64) -> String {
          match n {
            x if x -> "oops",
            _ -> "other"
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Pattern guard must be Bool");
    });
  });

  describe("range patterns", () => {
    it("accepts range pattern on Int64", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> Int64 {
          match n {
            1..10 -> 1,
            _ -> 0
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects range pattern on non-Int64 type", () => {
      const { errors } = check(`
        module Test
        function classify(s: String) -> Int64 {
          match s {
            1..10 -> 1,
            _ -> 0
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Range patterns only work on Int64");
    });

    it("rejects range pattern with start >= end", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> Int64 {
          match n {
            10..1 -> 1,
            _ -> 0
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("start (10) must be less than end (1)");
    });
  });

  // ---------------------------------------------------------------------------
  // Int64 exhaustiveness checking (#2, #3)
  // ---------------------------------------------------------------------------

  describe("Int64 match exhaustiveness", () => {
    it("accepts Int64 match with wildcard arm", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> String {
          match n {
            1 -> "one",
            2 -> "two",
            _ -> "other"
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("accepts Int64 match with binding arm", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> String {
          match n {
            1 -> "one",
            x -> "other"
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects Int64 match with only literal arms and no wildcard", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> String {
          match n {
            1 -> "one",
            2 -> "two"
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes("Non-exhaustive") && e.message.includes("Int64"))).toBe(true);
    });

    it("accepts Int64 range match with wildcard arm", () => {
      const { errors } = check(`
        module Test
        function grade(score: Int64) -> String {
          match score {
            90..100 -> "A",
            80..89  -> "B",
            _       -> "F"
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects Int64 range match with no wildcard arm", () => {
      const { errors } = check(`
        module Test
        function grade(score: Int64) -> String {
          match score {
            90..100 -> "A",
            80..89  -> "B"
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes("Non-exhaustive") && e.message.includes("Int64"))).toBe(true);
    });

    it("warns on overlapping range patterns", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> String {
          match n {
            1..10 -> "a",
            5..15 -> "b",
            _     -> "c"
          }
        }
      `);
      // Should produce an overlap warning (severity: warning, not error)
      expect(errors.some(e => e.message.includes("Overlapping range"))).toBe(true);
    });

    it("does not warn on non-overlapping adjacent ranges", () => {
      const { errors } = check(`
        module Test
        function classify(n: Int64) -> String {
          match n {
            1..5  -> "low",
            6..10 -> "mid",
            _     -> "other"
          }
        }
      `);
      expect(errors.filter(e => e.message.includes("Overlapping")).length).toBe(0);
    });
  });

  describe("open type exhaustiveness (String, Float64)", () => {
    it("rejects String match with only literal arms and no wildcard", () => {
      const { errors } = check(`
        module Test
        function classify(s: String) -> Int64 {
          match s {
            "hello" -> 1,
            "world" -> 2
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes("Non-exhaustive") && e.message.includes("String"))).toBe(true);
    });

    it("accepts String match with wildcard arm", () => {
      const { errors } = check(`
        module Test
        function classify(s: String) -> Int64 {
          match s {
            "hello" -> 1,
            _       -> 0
          }
        }
      `);
      expect(errors).toHaveLength(0);
    });

    it("rejects Float64 match with only literal arms and no wildcard", () => {
      const { errors } = check(`
        module Test
        function classify(x: Float64) -> Int64 {
          match x {
            1.0 -> 1,
            2.0 -> 2
          }
        }
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes("Non-exhaustive") && e.message.includes("Float64"))).toBe(true);
    });
  });
});
