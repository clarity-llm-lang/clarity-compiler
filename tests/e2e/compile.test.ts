import { describe, it, expect } from "vitest";
import { compile, compileFile } from "../../src/compiler.js";
import { createRuntime, type RuntimeConfig } from "../../src/codegen/runtime.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function makeRuntime(config?: RuntimeConfig) {
  return createRuntime(config);
}

async function instantiate(wasm: Uint8Array, config?: RuntimeConfig) {
  const runtime = makeRuntime(config);
  const { instance } = await WebAssembly.instantiate(wasm, runtime.imports);
  // Bind to the WASM module's exported memory
  const exportedMemory = instance.exports.memory as WebAssembly.Memory;
  if (exportedMemory) {
    runtime.bindMemory(exportedMemory);
  }
  const heapBase = instance.exports.__heap_base;
  if (heapBase && typeof (heapBase as WebAssembly.Global).value === "number") {
    runtime.setHeapBase((heapBase as WebAssembly.Global).value);
  }
  return { instance, runtime };
}

describe("end-to-end compilation", () => {
  it("compiles and runs simple addition", async () => {
    const source = `
      module Test
      function add(a: Int64, b: Int64) -> Int64 { a + b }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const add = instance.exports.add as (a: bigint, b: bigint) => bigint;
    expect(add(2n, 3n)).toBe(5n);
  });

  it("compiles and runs subtraction", async () => {
    const source = `
      module Test
      function sub(a: Int64, b: Int64) -> Int64 { a - b }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);

    const { instance } = await instantiate(result.wasm!);
    const sub = instance.exports.sub as (a: bigint, b: bigint) => bigint;
    expect(sub(10n, 3n)).toBe(7n);
  });

  it("compiles and runs multiplication", async () => {
    const source = `
      module Test
      function mul(a: Int64, b: Int64) -> Int64 { a * b }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);

    const { instance } = await instantiate(result.wasm!);
    const mul = instance.exports.mul as (a: bigint, b: bigint) => bigint;
    expect(mul(6n, 7n)).toBe(42n);
  });

  it("compiles and runs division", async () => {
    const source = `
      module Test
      function div(a: Int64, b: Int64) -> Int64 { a / b }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);

    const { instance } = await instantiate(result.wasm!);
    const div = instance.exports.div as (a: bigint, b: bigint) => bigint;
    expect(div(42n, 6n)).toBe(7n);
  });

  it("compiles and runs boolean match (abs function)", async () => {
    const source = `
      module Test
      function abs(n: Int64) -> Int64 {
        match n >= 0 {
          True -> n,
          False -> 0 - n
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const abs = instance.exports.abs as (n: bigint) => bigint;
    expect(abs(5n)).toBe(5n);
    expect(abs(-3n)).toBe(3n);
    expect(abs(0n)).toBe(0n);
  });

  it("compiles and runs let bindings in blocks", async () => {
    const source = `
      module Test
      function calc(x: Int64) -> Int64 {
        let a = x + 1;
        let b = a * 2;
        a + b
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const calc = instance.exports.calc as (x: bigint) => bigint;
    expect(calc(5n)).toBe(18n);
  });

  it("compiles and runs recursive fibonacci", async () => {
    const source = `
      module Test
      function fibonacci(n: Int64) -> Int64 {
        match n <= 1 {
          True -> n,
          False -> {
            let a = fibonacci(n - 1);
            let b = fibonacci(n - 2);
            a + b
          }
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const fib = instance.exports.fibonacci as (n: bigint) => bigint;
    expect(fib(0n)).toBe(0n);
    expect(fib(1n)).toBe(1n);
    expect(fib(5n)).toBe(5n);
    expect(fib(10n)).toBe(55n);
  });

  it("compiles multiple functions in one module", async () => {
    const source = `
      module Test
      function add(a: Int64, b: Int64) -> Int64 { a + b }
      function square(n: Int64) -> Int64 { n * n }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);

    const { instance } = await instantiate(result.wasm!);
    const add = instance.exports.add as (a: bigint, b: bigint) => bigint;
    const square = instance.exports.square as (n: bigint) => bigint;
    expect(add(2n, 3n)).toBe(5n);
    expect(square(7n)).toBe(49n);
  });

  it("compiles Float64 arithmetic", async () => {
    const source = `
      module Test
      function add_f(a: Float64, b: Float64) -> Float64 { a + b }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);

    const { instance } = await instantiate(result.wasm!);
    const add_f = instance.exports.add_f as (a: number, b: number) => number;
    expect(add_f(1.5, 2.5)).toBeCloseTo(4.0);
  });

  // === String tests ===

  it("compiles string literals and returns pointers", async () => {
    const source = `
      module Test
      function greeting() -> String { "hello world" }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const greeting = instance.exports.greeting as () => number;
    const ptr = greeting();
    expect(ptr).toBeGreaterThanOrEqual(0);
    expect(runtime.readString(ptr)).toBe("hello world");
  });

  it("compiles string concatenation", async () => {
    const source = `
      module Test
      function greet(name: String) -> String {
        "hello " ++ name
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const greet = instance.exports.greet as (ptr: number) => number;
    const namePtr = runtime.writeString("world");
    const resultPtr = greet(namePtr);
    expect(runtime.readString(resultPtr)).toBe("hello world");
  });

  it("compiles string equality", async () => {
    const source = `
      module Test
      function is_hello(s: String) -> Bool {
        s == "hello"
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const is_hello = instance.exports.is_hello as (ptr: number) => number;
    expect(is_hello(runtime.writeString("hello"))).toBe(1);
    expect(is_hello(runtime.writeString("world"))).toBe(0);
  });

  it("deduplicates string literals", async () => {
    const source = `
      module Test
      function same() -> Bool {
        let a = "test";
        let b = "test";
        a == b
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const same = instance.exports.same as () => number;
    expect(same()).toBe(1);
  });

  it("compiles function returning string from match", async () => {
    const source = `
      module Test
      function describe(n: Int64) -> String {
        match n >= 0 {
          True -> "positive",
          False -> "negative"
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const describe = instance.exports.describe as (n: bigint) => number;
    expect(runtime.readString(describe(5n))).toBe("positive");
    expect(runtime.readString(describe(-3n))).toBe("negative");
  });

  // === Built-in function tests ===

  it("compiles print_string with Log effect", async () => {
    const source = `
      module Test
      effect[Log] function greet() -> Unit {
        print_string("hello")
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
  });

  it("rejects print_string without Log effect", () => {
    const source = `
      module Test
      function greet() -> Unit {
        print_string("hello")
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Log");
  });

  it("compiles int_to_float conversion", async () => {
    const source = `
      module Test
      function convert(n: Int64) -> Float64 {
        int_to_float(n)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const convert = instance.exports.convert as (n: bigint) => number;
    expect(convert(42n)).toBe(42.0);
  });

  it("compiles float_to_int conversion", async () => {
    const source = `
      module Test
      function convert(f: Float64) -> Int64 {
        float_to_int(f)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const convert = instance.exports.convert as (f: number) => bigint;
    expect(convert(3.7)).toBe(3n);
  });

  it("compiles int_to_string conversion", async () => {
    const source = `
      module Test
      function convert(n: Int64) -> String {
        int_to_string(n)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const convert = instance.exports.convert as (n: bigint) => number;
    expect(runtime.readString(convert(42n))).toBe("42");
  });

  it("compiles string_length", async () => {
    const source = `
      module Test
      function len(s: String) -> Int64 {
        string_length(s)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const len = instance.exports.len as (ptr: number) => bigint;
    const ptr = runtime.writeString("hello");
    expect(len(ptr)).toBe(5n);
  });

  it("compiles math builtins (abs_int, min_int, max_int)", async () => {
    const source = `
      module Test
      function test_abs(n: Int64) -> Int64 { abs_int(n) }
      function test_min(a: Int64, b: Int64) -> Int64 { min_int(a, b) }
      function test_max(a: Int64, b: Int64) -> Int64 { max_int(a, b) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_abs = instance.exports.test_abs as (n: bigint) => bigint;
    const test_min = instance.exports.test_min as (a: bigint, b: bigint) => bigint;
    const test_max = instance.exports.test_max as (a: bigint, b: bigint) => bigint;
    expect(test_abs(-5n)).toBe(5n);
    expect(test_abs(3n)).toBe(3n);
    expect(test_min(3n, 7n)).toBe(3n);
    expect(test_max(3n, 7n)).toBe(7n);
  });

  it("compiles float math builtins (sqrt, pow, floor, ceil)", async () => {
    const source = `
      module Test
      function test_sqrt(f: Float64) -> Float64 { sqrt(f) }
      function test_pow(b: Float64, e: Float64) -> Float64 { pow(b, e) }
      function test_floor(f: Float64) -> Float64 { floor(f) }
      function test_ceil(f: Float64) -> Float64 { ceil(f) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_sqrt = instance.exports.test_sqrt as (f: number) => number;
    const test_pow = instance.exports.test_pow as (b: number, e: number) => number;
    const test_floor = instance.exports.test_floor as (f: number) => number;
    const test_ceil = instance.exports.test_ceil as (f: number) => number;
    expect(test_sqrt(9.0)).toBe(3.0);
    expect(test_pow(2.0, 3.0)).toBe(8.0);
    expect(test_floor(3.7)).toBe(3.0);
    expect(test_ceil(3.2)).toBe(4.0);
  });

  it("compiles substring and char_at", async () => {
    const source = `
      module Test
      function test_sub(s: String) -> String { substring(s, 0, 5) }
      function test_char(s: String) -> String { char_at(s, 1) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const test_sub = instance.exports.test_sub as (ptr: number) => number;
    const test_char = instance.exports.test_char as (ptr: number) => number;
    const ptr = runtime.writeString("hello world");
    expect(runtime.readString(test_sub(ptr))).toBe("hello");
    expect(runtime.readString(test_char(ptr))).toBe("e");
  });

  // === Record & Union codegen tests ===

  it("compiles union constructor and match destructuring", async () => {
    const source = `
      module Test
      type Result =
        | Ok(value: Int64)
        | Err(code: Int64)

      function make_ok(n: Int64) -> Result {
        Ok(n)
      }

      function get_value(r: Result) -> Int64 {
        match r {
          Ok(value) -> value,
          Err(code) -> 0 - code
        }
      }
    `;
    const watResult = compile(source, "test.clarity", { emitWat: true });
    if (watResult.errors.length > 0) console.log("WAT ERRORS:", JSON.stringify(watResult.errors));
    else console.log("WAT:", watResult.wat);
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const make_ok = instance.exports.make_ok as (n: bigint) => number;
    const get_value = instance.exports.get_value as (ptr: number) => bigint;
    const ptr = make_ok(42n);
    expect(get_value(ptr)).toBe(42n);
  });

  it("compiles union with string fields", async () => {
    const source = `
      module Test
      type Response =
        | Success(message: String)
        | Failure(reason: String)

      function describe(r: Response) -> String {
        match r {
          Success(message) -> message,
          Failure(reason) -> reason
        }
      }

      function make_success(msg: String) -> Response {
        Success(msg)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const make_success = instance.exports.make_success as (ptr: number) => number;
    const describe = instance.exports.describe as (ptr: number) => number;
    const msgPtr = runtime.writeString("it worked");
    const respPtr = make_success(msgPtr);
    expect(runtime.readString(describe(respPtr))).toBe("it worked");
  });

  it("compiles union with no-field variant (like None)", async () => {
    const source = `
      module Test
      type MaybeInt =
        | SomeVal(n: Int64)
        | NoneVal

      function unwrap_or(m: MaybeInt, default_val: Int64) -> Int64 {
        match m {
          SomeVal(n) -> n,
          NoneVal -> default_val
        }
      }

      function make_some(n: Int64) -> MaybeInt {
        SomeVal(n)
      }

      function make_none() -> MaybeInt {
        NoneVal
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const make_some = instance.exports.make_some as (n: bigint) => number;
    const make_none = instance.exports.make_none as () => number;
    const unwrap_or = instance.exports.unwrap_or as (ptr: number, d: bigint) => bigint;

    expect(unwrap_or(make_some(99n), 0n)).toBe(99n);
    expect(unwrap_or(make_none(), 0n)).toBe(0n);
  });

  it("compiles list literal and list_length", async () => {
    const source = `
      module Test
      function make_list() -> List<Int64> {
        [1, 2, 3]
      }

      function get_len(lst: List<Int64>) -> Int64 {
        list_length(lst)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const make_list = instance.exports.make_list as () => number;
    const get_len = instance.exports.get_len as (ptr: number) => bigint;
    const listPtr = make_list();
    expect(get_len(listPtr)).toBe(3n);
  });

  // === Error reporting tests ===

  it("reports type errors without crashing", () => {
    const source = `
      module Test
      function bad(a: Int64) -> Bool { a + 1 }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.wasm).toBeUndefined();
  });

  it("reports parse errors without crashing", () => {
    const source = `
      module Test
      function bad( { }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("emits WAT text format", () => {
    const source = `
      module Test
      function add(a: Int64, b: Int64) -> Int64 { a + b }
    `;
    const result = compile(source, "test.clarity", { emitWat: true });
    expect(result.errors).toHaveLength(0);
    expect(result.wat).toBeDefined();
    expect(result.wat).toContain("func");
    expect(result.wat).toContain("i64.add");
  });

  // === v0.2 fixes ===

  it("compiles Float64 modulo operator", async () => {
    const source = `
      module Test
      function fmod(a: Float64, b: Float64) -> Float64 { a % b }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const fmod = instance.exports.fmod as (a: number, b: number) => number;
    expect(fmod(10.5, 3.0)).toBeCloseTo(1.5);
    expect(fmod(7.0, 2.0)).toBeCloseTo(1.0);
  });

  it("compiles Option<Int64> with polymorphic Some/None", async () => {
    const source = `
      module Test
      type MaybeInt =
        | SomeVal(n: Int64)
        | NoneVal

      type MaybeStr =
        | SomeStr(s: String)
        | NoneStr

      function unwrap_int(m: MaybeInt) -> Int64 {
        match m {
          SomeVal(n) -> n,
          NoneVal -> 0
        }
      }

      function unwrap_str(m: MaybeStr) -> String {
        match m {
          SomeStr(s) -> s,
          NoneStr -> "empty"
        }
      }

      function make_int() -> MaybeInt { SomeVal(42) }
      function make_str(s: String) -> MaybeStr { SomeStr(s) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const make_int = instance.exports.make_int as () => number;
    const make_str = instance.exports.make_str as (ptr: number) => number;
    const unwrap_int = instance.exports.unwrap_int as (ptr: number) => bigint;
    const unwrap_str = instance.exports.unwrap_str as (ptr: number) => number;

    expect(unwrap_int(make_int())).toBe(42n);
    const strPtr = runtime.writeString("hello");
    expect(runtime.readString(unwrap_str(make_str(strPtr)))).toBe("hello");
  });

  it("compiles record field access correctly", async () => {
    const source = `
      module Test
      type Point = { x: Int64, y: Int64 }

      function get_x(p: Point) -> Int64 { p.x }
      function get_y(p: Point) -> Int64 { p.y }
      function make_point(x: Int64, y: Int64) -> Point {
        { x: x, y: y }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const make_point = instance.exports.make_point as (x: bigint, y: bigint) => number;
    const get_x = instance.exports.get_x as (ptr: number) => bigint;
    const get_y = instance.exports.get_y as (ptr: number) => bigint;

    const p = make_point(10n, 20n);
    expect(get_x(p)).toBe(10n);
    expect(get_y(p)).toBe(20n);
  });

  it("compiles string_to_int returning Option<Int64>", async () => {
    const source = `
      module Test
      function parse_valid(s: String) -> Int64 {
        match string_to_int(s) {
          Some(value) -> value,
          None -> 0 - 1
        }
      }
      function parse_invalid(s: String) -> Int64 {
        match string_to_int(s) {
          Some(value) -> value,
          None -> 0 - 1
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const parse_valid = instance.exports.parse_valid as (ptr: number) => bigint;
    const parse_invalid = instance.exports.parse_invalid as (ptr: number) => bigint;
    expect(parse_valid(runtime.writeString("42"))).toBe(42n);
    expect(parse_invalid(runtime.writeString("not_a_number"))).toBe(-1n);
  });

  it("compiles string_to_float returning Option<Float64>", async () => {
    const source = `
      module Test
      function parse_float_valid(s: String) -> Float64 {
        match string_to_float(s) {
          Some(value) -> value,
          None -> 0.0 - 1.0
        }
      }
      function parse_float_invalid(s: String) -> Float64 {
        match string_to_float(s) {
          Some(value) -> value,
          None -> 0.0 - 1.0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const parse_valid = instance.exports.parse_float_valid as (ptr: number) => number;
    const parse_invalid = instance.exports.parse_float_invalid as (ptr: number) => number;
    expect(parse_valid(runtime.writeString("3.14"))).toBeCloseTo(3.14, 5);
    expect(parse_invalid(runtime.writeString("xyz"))).toBeCloseTo(-1.0, 5);
  });

  it("checker annotates resolved types on AST nodes", () => {
    const source = `
      module Test
      function add(a: Int64, b: Int64) -> Int64 {
        let x = a + b;
        x
      }
    `;
    const result = compile(source, "test.clarity", { checkOnly: true });
    expect(result.errors).toHaveLength(0);
    expect(result.ast).toBeDefined();
    // The function body should have a resolved type
    const fn = result.ast!.declarations[0];
    expect(fn.kind).toBe("FunctionDecl");
    if (fn.kind === "FunctionDecl") {
      expect(fn.body.resolvedType).toBeDefined();
      expect(fn.body.resolvedType!.kind).toBe("Int64");
    }
  });

  // ============================================================
  // Phase 1.5: I/O Primitives
  // ============================================================

  it("string_replace replaces all occurrences", async () => {
    const source = `
      module Test
      function rewrite(s: String) -> String {
        string_replace(s, "-", ":")
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const rewrite = instance.exports.rewrite as (ptr: number) => number;
    const ptr = rewrite(runtime.writeString("a-b-c"));
    expect(runtime.readString(ptr)).toBe("a:b:c");
  });

  it("random_int and random_float require Random effect and run", async () => {
    const source = `
      module Test
      effect[Random] function roll() -> Bool {
        let r = random_int(1, 6);
        let f = random_float();
        r >= 1 and r <= 6 and f >= 0.0 and f < 1.0
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const roll = instance.exports.roll as () => number;
    expect(roll()).toBe(1);
  });

  it("rejects random_int without Random effect", () => {
    const source = `
      module Test
      function bad() -> Int64 {
        random_int(1, 10)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Random");
  });

  it("timestamp_parse_iso returns Some for valid and None for invalid input", async () => {
    const source = `
      module Test
      function parse_ok() -> Bool {
        match timestamp_parse_iso("2026-02-20T00:00:00.000Z") {
          Some(_) -> True,
          None -> False
        }
      }

      function parse_bad() -> Bool {
        match timestamp_parse_iso("not-a-date") {
          Some(_) -> False,
          None -> True
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const parse_ok = instance.exports.parse_ok as () => number;
    const parse_bad = instance.exports.parse_bad as () => number;
    expect(parse_ok()).toBe(1);
    expect(parse_bad()).toBe(1);
  });

  it("regex builtins match and capture", async () => {
    const source = `
      module Test
      function has_digits(s: String) -> Bool {
        regex_match("[0-9]+", s)
      }

      function first_capture(s: String) -> String {
        match regex_captures("([0-9]+)", s) {
          None -> "none",
          Some(groups) -> nth(groups, 1)
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const has_digits = instance.exports.has_digits as (ptr: number) => number;
    const first_capture = instance.exports.first_capture as (ptr: number) => number;
    expect(has_digits(runtime.writeString("abc123"))).toBe(1);
    expect(has_digits(runtime.writeString("abc"))).toBe(0);
    expect(runtime.readString(first_capture(runtime.writeString("id=42")))).toBe("42");
  });

  it("read_line reads from stdin config", async () => {
    const source = `
      module Test
      effect[FileSystem] function get_input() -> String {
        read_line()
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!, { stdin: "hello world\nsecond line" });
    const get_input = instance.exports.get_input as () => number;
    const ptr = get_input();
    expect(runtime.readString(ptr)).toBe("hello world");
  });

  it("read_line requires FileSystem effect", () => {
    const source = `
      module Test
      function bad() -> String {
        read_line()
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("effect");
  });

  it("get_args returns command-line arguments as list", async () => {
    const source = `
      module Test
      effect[FileSystem] function arg_count() -> Int64 {
        let args = get_args();
        list_length(args)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!, { argv: ["hello", "world", "foo"] });
    const arg_count = instance.exports.arg_count as () => bigint;
    expect(arg_count()).toBe(3n);
  });


  it("http_get works with Network effect", async () => {
    const source = `
      module Test
      effect[Network] function fetch(url: String) -> String {
        match http_get(url) {
          Ok(body) -> body,
          Err(message) -> message
        }
      }
    `;

    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-http-get-"));
    const filePath = path.join(tmpDir, "payload.txt");
    fs.writeFileSync(filePath, "pong", "utf-8");

    const { instance, runtime } = await instantiate(result.wasm!);
    const fetchFn = instance.exports.fetch as (urlPtr: number) => number;
    const urlPtr = runtime.writeString(`file://${filePath}`);
    const bodyPtr = fetchFn(urlPtr);
    expect(runtime.readString(bodyPtr)).toBe("pong");
  });

  it("rejects http_get without Network effect", () => {
    const source = `
      module Test
      function fetch(url: String) -> String {
        match http_get(url) {
          Ok(body) -> body,
          Err(message) -> message
        }
      }
    `;

    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Network");
  });

  it("read_file reads file content via config fs", async () => {
    const source = `
      module Test
      effect[FileSystem] function load(path: String) -> String {
        read_file(path)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const mockFs = {
      readFileSync: (path: string, _encoding: string) => {
        if (path === "test.txt") return "file content here";
        return "";
      },
      writeFileSync: () => {},
    };
    const { instance, runtime } = await instantiate(result.wasm!, { fs: mockFs });
    const load = instance.exports.load as (ptr: number) => number;
    const pathPtr = runtime.writeString("test.txt");
    const resultPtr = load(pathPtr);
    expect(runtime.readString(resultPtr)).toBe("file content here");
  });

  it("write_file writes content via config fs", async () => {
    const source = `
      module Test
      effect[FileSystem] function save(path: String, content: String) -> Unit {
        write_file(path, content)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const written: Record<string, string> = {};
    const mockFs = {
      readFileSync: () => "",
      writeFileSync: (path: string, content: string) => { written[path] = content; },
    };
    const { instance, runtime } = await instantiate(result.wasm!, { fs: mockFs });
    const save = instance.exports.save as (pathPtr: number, contentPtr: number) => void;
    const pathPtr = runtime.writeString("out.txt");
    const contentPtr = runtime.writeString("hello from clarity");
    save(pathPtr, contentPtr);
    expect(written["out.txt"]).toBe("hello from clarity");
  });

  it("compiles and runs mutable variable reassignment", async () => {
    const source = `
      module Test
      function counter() -> Int64 {
        let mut x = 0;
        x = x + 1;
        x = x + 1;
        x = x + 1;
        x
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const counter = instance.exports.counter as () => bigint;
    expect(counter()).toBe(3n);
  });

  it("compiles mutable string reassignment", async () => {
    const source = `
      module Test
      function greet(name: String) -> String {
        let mut msg = "hello";
        msg = msg ++ " " ++ name;
        msg
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const greet = instance.exports.greet as (ptr: number) => number;
    const namePtr = runtime.writeString("world");
    const resultPtr = greet(namePtr);
    expect(runtime.readString(resultPtr)).toBe("hello world");
  });

  it("rejects assignment to immutable variable at compile time", () => {
    const source = `
      module Test
      function f() -> Int64 {
        let x = 1;
        x = 2;
        x
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("immutable");
  });

  it("read_all_stdin reads entire stdin", async () => {
    const source = `
      module Test
      effect[FileSystem] function slurp() -> String {
        read_all_stdin()
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!, { stdin: "line1\nline2\nline3" });
    const slurp = instance.exports.slurp as () => number;
    const ptr = slurp();
    expect(runtime.readString(ptr)).toBe("line1\nline2\nline3");
  });

  it("passes and calls a function reference (higher-order)", async () => {
    const source = `
      module Test
      function double(x: Int64) -> Int64 { x * 2 }
      function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
      function test_it() -> Int64 { apply(double, 5) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_it = instance.exports.test_it as () => bigint;
    expect(test_it()).toBe(10n);
  });

  it("passes multi-arg function reference", async () => {
    const source = `
      module Test
      function add(a: Int64, b: Int64) -> Int64 { a + b }
      function mul(a: Int64, b: Int64) -> Int64 { a * b }
      function combine(f: (Int64, Int64) -> Int64, x: Int64, y: Int64) -> Int64 { f(x, y) }
      function test_add() -> Int64 { combine(add, 3, 4) }
      function test_mul() -> Int64 { combine(mul, 3, 4) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_add = instance.exports.test_add as () => bigint;
    const test_mul = instance.exports.test_mul as () => bigint;
    expect(test_add()).toBe(7n);
    expect(test_mul()).toBe(12n);
  });

  it("higher-order function with string return type", async () => {
    const source = `
      module Test
      function greet(name: String) -> String { "Hello " ++ name }
      function apply_str(f: (String) -> String, s: String) -> String { f(s) }
      function test_it() -> String { apply_str(greet, "World") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const test_it = instance.exports.test_it as () => number;
    const ptr = test_it();
    expect(runtime.readString(ptr)).toBe("Hello World");
  });

  it("rejects wrong function signature at compile time", () => {
    const source = `
      module Test
      function greet(s: String) -> String { s }
      function apply(f: (Int64) -> Int64, x: Int64) -> Int64 { f(x) }
      function bad() -> Int64 { apply(greet, 5) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // --- Generic functions ---
  it("compiles and runs generic identity function with Int64", async () => {
    const source = `
      module Test
      function identity<T>(x: T) -> T { x }
      function test_int() -> Int64 { identity(42) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    const { instance } = await instantiate(result.wasm!);
    const test_int = instance.exports.test_int as () => bigint;
    expect(test_int()).toBe(42n);
  });

  it("compiles and runs generic identity function with String", async () => {
    const source = `
      module Test
      function identity<T>(x: T) -> T { x }
      function test_str() -> String { identity("hello") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const test_str = instance.exports.test_str as () => number;
    expect(runtime.readString(test_str())).toBe("hello");
  });

  it("compiles generic function with two type params", async () => {
    const source = `
      module Test
      function first<A, B>(a: A, b: B) -> A { a }
      function test() -> Int64 { first(99, "ignored") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(99n);
  });

  it("head of string list returns correct string", async () => {
    const source = `
      module Test
      function test() -> String {
        let xs = ["alpha", "beta"];
        head(xs)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => number;
    expect(runtime.readString(test())).toBe("alpha");
  });

  it("rejects generic function return type mismatch", () => {
    const source = `
      module Test
      function identity<T>(x: T) -> T { x }
      function bad() -> String { identity(42) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // --- Result<T, E> built-in type ---
  it("compiles Result<Int64, String> with Ok and Err constructors", async () => {
    const source = `
      module Test
      function try_divide(a: Int64, b: Int64) -> Result<Int64, String> {
        match b == 0 {
          True -> Err("division by zero"),
          False -> Ok(a / b)
        }
      }
      function unwrap_or(r: Result<Int64, String>, default_val: Int64) -> Int64 {
        match r {
          Ok(value) -> value,
          Err(error) -> default_val
        }
      }
      function test_ok() -> Int64 {
        unwrap_or(try_divide(10, 2), 0)
      }
      function test_err() -> Int64 {
        unwrap_or(try_divide(10, 0), -1)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_ok = instance.exports.test_ok as () => bigint;
    const test_err = instance.exports.test_err as () => bigint;
    expect(test_ok()).toBe(5n);
    expect(test_err()).toBe(-1n);
  });

  it("compiles Result<String, String> with string payload", async () => {
    const source = `
      module Test
      function validate(name: String) -> Result<String, String> {
        match string_length(name) > 0 {
          True -> Ok(name),
          False -> Err("name is empty")
        }
      }
      function get_or_default(r: Result<String, String>) -> String {
        match r {
          Ok(value) -> value,
          Err(error) -> error
        }
      }
      function test_valid() -> String { get_or_default(validate("Alice")) }
      function test_invalid() -> String { get_or_default(validate("")) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const test_valid = instance.exports.test_valid as () => number;
    const test_invalid = instance.exports.test_invalid as () => number;
    expect(runtime.readString(test_valid())).toBe("Alice");
    expect(runtime.readString(test_invalid())).toBe("name is empty");
  });

  it("type-checks Result type annotation in function signatures", () => {
    const source = `
      module Test
      function bad() -> Result<Int64, String> {
        42
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // --- Type aliases ---
  it("compiles and runs with transparent type alias", async () => {
    const source = `
      module Test
      type UserId = Int64
      function make_id(n: Int64) -> UserId { n }
      function add_ids(a: UserId, b: UserId) -> UserId { a + b }
      function test() -> Int64 { add_ids(make_id(10), make_id(32)) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(42n);
  });

  // --- Tail call optimization ---
  it("optimizes tail-recursive sum to a loop (TCO)", async () => {
    // This function would overflow the stack without TCO for large n
    const source = `
      module Test
      function sum_tail(n: Int64, acc: Int64) -> Int64 {
        match n <= 0 {
          True -> acc,
          False -> sum_tail(n - 1, acc + n)
        }
      }
      function test() -> Int64 { sum_tail(100000, 0) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    // sum of 1..100000 = 100000 * 100001 / 2 = 5000050000
    expect(test()).toBe(5000050000n);
  });

  it("optimizes tail-recursive countdown to a loop (TCO)", async () => {
    const source = `
      module Test
      function countdown(n: Int64) -> Int64 {
        match n <= 0 {
          True -> 0,
          False -> countdown(n - 1)
        }
      }
      function test() -> Int64 { countdown(1000000) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(0n);
  });

  it("non-tail-recursive functions still work correctly", async () => {
    // fibonacci is NOT tail-recursive, should still compile and work
    const source = `
      module Test
      function fib(n: Int64) -> Int64 {
        match n <= 1 {
          True -> n,
          False -> {
            let a = fib(n - 1);
            let b = fib(n - 2);
            a + b
          }
        }
      }
      function test() -> Int64 { fib(10) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(55n);
  });

  it("named arguments reorder correctly at runtime", async () => {
    const source = `
      module Test
      function sub(a: Int64, b: Int64) -> Int64 { a - b }
      function test() -> Int64 { sub(b: 3, a: 10) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    // sub(a: 10, b: 3) = 10 - 3 = 7 (not -7 from positional ordering)
    expect(test()).toBe(7n);
  });

  it("named arguments work with mixed types", async () => {
    const source = `
      module Test
      function pick(flag: Bool, x: Int64, y: Int64) -> Int64 {
        match flag {
          True -> x,
          False -> y
        }
      }
      function test() -> Int64 { pick(y: 20, x: 10, flag: True) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(10n);
  });

  it("is_empty returns True for empty list and False for non-empty", async () => {
    const source = `
      module Test
      function test_empty() -> Bool { is_empty([]) }
      function test_nonempty() -> Bool { is_empty([1, 2, 3]) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const testEmpty = instance.exports.test_empty as () => number;
    const testNonempty = instance.exports.test_nonempty as () => number;
    expect(testEmpty()).toBe(1); // True
    expect(testNonempty()).toBe(0); // False
  });

  it("nth returns element at given index", async () => {
    const source = `
      module Test
      function test() -> Int64 { nth([10, 20, 30], 1) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(20n);
  });

  it("contains checks for substring presence", async () => {
    const source = `
      module Test
      function test_yes() -> Bool { contains("hello world", "world") }
      function test_no() -> Bool { contains("hello world", "xyz") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const testYes = instance.exports.test_yes as () => number;
    const testNo = instance.exports.test_no as () => number;
    expect(testYes()).toBe(1);
    expect(testNo()).toBe(0);
  });

  it("index_of finds substring position", async () => {
    const source = `
      module Test
      function test_found() -> Int64 { index_of("hello world", "world") }
      function test_missing() -> Int64 { index_of("hello world", "xyz") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const testFound = instance.exports.test_found as () => bigint;
    const testMissing = instance.exports.test_missing as () => bigint;
    expect(testFound()).toBe(6n);
    expect(testMissing()).toBe(-1n);
  });

  it("trim removes whitespace", async () => {
    const source = `
      module Test
      function test() -> Int64 { string_length(trim("  hello  ")) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(5n); // "hello" has length 5
  });

  it("split divides string by delimiter", async () => {
    const source = `
      module Test
      function test() -> Int64 { length(split("a,b,c", ",")) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(3n); // ["a", "b", "c"] has 3 elements
  });

  it("multi-line string literals work end-to-end", async () => {
    // Use triple-quotes inside a Clarity program
    const source = `
      module Test
      function test() -> Int64 {
        let s = ${'"""'}
hello
world${'"""'};
        string_length(s)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(11n); // "hello\nworld" = 11 chars
  });

  it("append works with List<String>", async () => {
    const source = `
      module Test
      function test() -> Int64 {
        let xs = ["hello", "world"];
        let ys = append(xs, "!");
        length(ys)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(3n);
  });

  it("head works with List<String>", async () => {
    const source = `
      module Test
      function test() -> Int64 {
        let xs = ["hello", "world"];
        string_length(head(xs))
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(5n); // "hello" = 5 chars
  });

  it("pattern guards work on Bool match", async () => {
    const source = `
      module Test
      function classify(n: Int64) -> Int64 {
        match n > 0 {
          True if n < 10 -> 1,
          True -> 2,
          False -> 0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const classify = instance.exports.classify as (n: bigint) => bigint;
    expect(classify(5n)).toBe(1n);   // positive and < 10
    expect(classify(50n)).toBe(2n);  // positive and >= 10
    expect(classify(0n)).toBe(0n);   // non-positive
    expect(classify(-5n)).toBe(0n);  // non-positive
  });

  it("pattern guards work on Int64 match", async () => {
    const source = `
      module Test
      function classify(n: Int64) -> String {
        match n {
          x if x > 100 -> "large",
          x if x > 0 -> "small",
          _ -> "non-positive"
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const classify = instance.exports.classify as (n: bigint) => number;
    expect(runtime.readString(classify(200n))).toBe("large");
    expect(runtime.readString(classify(50n))).toBe("small");
    expect(runtime.readString(classify(0n))).toBe("non-positive");
    expect(runtime.readString(classify(-10n))).toBe("non-positive");
  });

  it("pattern guards work with wildcard on union", async () => {
    const source = `
      module Test
      type Status = | Active(count: Int64) | Inactive
      function is_high_activity(s: Status) -> Bool {
        match s {
          Active(n) if n > 10 -> True,
          _ -> False
        }
      }
      function test_high() -> Bool { is_high_activity(Active(20)) }
      function test_low() -> Bool { is_high_activity(Active(5)) }
      function test_inactive() -> Bool { is_high_activity(Inactive) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_high = instance.exports.test_high as () => number;
    const test_low = instance.exports.test_low as () => number;
    const test_inactive = instance.exports.test_inactive as () => number;

    expect(test_high()).toBe(1);  // True
    expect(test_low()).toBe(0);   // False
    expect(test_inactive()).toBe(0);  // False
  });

  it("pattern guards work with multiple arms for same variant", async () => {
    const source = `
      module Test
      type MyResult = | Success(value: Int64) | Failure | Pending
      function describe(res: MyResult) -> Int64 {
        match res {
          Success(x) if x > 100 -> 1,
          Failure -> 2,
          _ -> 0
        }
      }
      function test_big() -> Int64 { describe(Success(200)) }
      function test_small() -> Int64 { describe(Success(50)) }
      function test_fail() -> Int64 { describe(Failure) }
      function test_pend() -> Int64 { describe(Pending) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_big = instance.exports.test_big as () => bigint;
    const test_small = instance.exports.test_small as () => bigint;
    const test_fail = instance.exports.test_fail as () => bigint;
    const test_pend = instance.exports.test_pend as () => bigint;

    expect(test_big()).toBe(1n);   // Success(200), guard passes
    expect(test_small()).toBe(0n); // Success(50), guard fails -> wildcard
    expect(test_fail()).toBe(2n);  // Failure arm (was broken before fix)
    expect(test_pend()).toBe(0n);  // Pending -> wildcard
  });

  it("pattern guards work with string return on union match", async () => {
    const source = `
      module Test
      type MyResult = | Success(value: Int64) | Failure | Pending
      function describe(res: MyResult) -> String {
        match res {
          Success(x) if x > 100 -> "big win",
          Failure -> "failure",
          _ -> "other"
        }
      }
      function test_big() -> String { describe(Success(200)) }
      function test_fail() -> String { describe(Failure) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const test_big = instance.exports.test_big as () => number;
    const test_fail = instance.exports.test_fail as () => number;

    expect(runtime.readString(test_big())).toBe("big win");
    expect(runtime.readString(test_fail())).toBe("failure");
  });
});

describe("Range patterns", () => {
  it("range patterns on Int64 match", async () => {
    const source = `
      module Test
      function classify(n: Int64) -> Int64 {
        match n {
          1..10 -> 1,
          11..100 -> 2,
          _ -> 0
        }
      }
      function test_small() -> Int64 { classify(5) }
      function test_medium() -> Int64 { classify(50) }
      function test_boundary_low() -> Int64 { classify(1) }
      function test_boundary_high() -> Int64 { classify(100) }
      function test_outside() -> Int64 { classify(200) }
      function test_zero() -> Int64 { classify(0) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_small = instance.exports.test_small as () => bigint;
    const test_medium = instance.exports.test_medium as () => bigint;
    const test_boundary_low = instance.exports.test_boundary_low as () => bigint;
    const test_boundary_high = instance.exports.test_boundary_high as () => bigint;
    const test_outside = instance.exports.test_outside as () => bigint;
    const test_zero = instance.exports.test_zero as () => bigint;

    expect(test_small()).toBe(1n);          // 5 in 1..10
    expect(test_medium()).toBe(2n);         // 50 in 11..100
    expect(test_boundary_low()).toBe(1n);   // 1 in 1..10 (inclusive)
    expect(test_boundary_high()).toBe(2n);  // 100 in 11..100 (inclusive)
    expect(test_outside()).toBe(0n);        // 200 -> wildcard
    expect(test_zero()).toBe(0n);           // 0 -> wildcard
  });

  it("range patterns with string return", async () => {
    const source = `
      module Test
      function grade(score: Int64) -> String {
        match score {
          90..100 -> "A",
          80..89 -> "B",
          70..79 -> "C",
          _ -> "F"
        }
      }
      function test_a() -> String { grade(95) }
      function test_b() -> String { grade(85) }
      function test_c() -> String { grade(75) }
      function test_f() -> String { grade(50) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const test_a = instance.exports.test_a as () => number;
    const test_b = instance.exports.test_b as () => number;
    const test_c = instance.exports.test_c as () => number;
    const test_f = instance.exports.test_f as () => number;

    expect(runtime.readString(test_a())).toBe("A");
    expect(runtime.readString(test_b())).toBe("B");
    expect(runtime.readString(test_c())).toBe("C");
    expect(runtime.readString(test_f())).toBe("F");
  });

  it("range patterns with guards", async () => {
    const source = `
      module Test
      function check(n: Int64) -> Int64 {
        match n {
          1..10 if n > 5 -> 1,
          1..10 -> 2,
          _ -> 0
        }
      }
      function test_high() -> Int64 { check(8) }
      function test_low() -> Int64 { check(3) }
      function test_out() -> Int64 { check(20) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_high = instance.exports.test_high as () => bigint;
    const test_low = instance.exports.test_low as () => bigint;
    const test_out = instance.exports.test_out as () => bigint;

    expect(test_high()).toBe(1n);  // 8 in 1..10 and > 5
    expect(test_low()).toBe(2n);   // 3 in 1..10 but not > 5
    expect(test_out()).toBe(0n);   // 20 -> wildcard
  });
});

describe("Module system (import/export)", () => {
  function setupModuleTest(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-test-"));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  it("imports exported functions from another module", async () => {
    const dir = setupModuleTest({
      "math.clarity": `
        module Math
        export function add(a: Int64, b: Int64) -> Int64 { a + b }
        export function mul(a: Int64, b: Int64) -> Int64 { a * b }
      `,
      "main.clarity": `
        module Main
        import { add, mul } from "math"
        function compute() -> Int64 { add(mul(3, 4), 5) }
      `,
    });

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const compute = instance.exports.compute as () => bigint;
    expect(compute()).toBe(17n);
  });

  it("imports exported union types and constructors", async () => {
    const dir = setupModuleTest({
      "types.clarity": `
        module Types
        export type Color = | Red | Green | Blue
        export function color_value(c: Color) -> Int64 {
          match c { Red -> 1, Green -> 2, Blue -> 3 }
        }
      `,
      "main.clarity": `
        module Main
        import { Color, Red, Blue, color_value } from "types"
        function test_red() -> Int64 { color_value(Red) }
        function test_blue() -> Int64 { color_value(Blue) }
      `,
    });

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test_red = instance.exports.test_red as () => bigint;
    const test_blue = instance.exports.test_blue as () => bigint;
    expect(test_red()).toBe(1n);
    expect(test_blue()).toBe(3n);
  });

  it("supports transitive imports (A imports B imports C)", async () => {
    const dir = setupModuleTest({
      "base.clarity": `
        module Base
        export function double(x: Int64) -> Int64 { x * 2 }
      `,
      "mid.clarity": `
        module Mid
        import { double } from "base"
        export function quadruple(x: Int64) -> Int64 { double(double(x)) }
      `,
      "top.clarity": `
        module Top
        import { quadruple } from "mid"
        function test() -> Int64 { quadruple(5) }
      `,
    });

    const result = compileFile(path.join(dir, "top.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const test = instance.exports.test as () => bigint;
    expect(test()).toBe(20n);
  });

  it("rejects importing non-exported symbols", () => {
    const dir = setupModuleTest({
      "lib.clarity": `
        module Lib
        function secret(x: Int64) -> Int64 { x }
        export function public_fn(x: Int64) -> Int64 { x + 1 }
      `,
      "main.clarity": `
        module Main
        import { secret } from "lib"
        function test() -> Int64 { secret(5) }
      `,
    });

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("not exported");
  });

  it("rejects importing from non-existent module", () => {
    const dir = setupModuleTest({
      "main.clarity": `
        module Main
        import { foo } from "nonexistent"
        function test() -> Int64 { foo(5) }
      `,
    });

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Cannot find module");
  });

  it("only exports entry module functions as WASM exports", async () => {
    const dir = setupModuleTest({
      "lib.clarity": `
        module Lib
        export function helper(x: Int64) -> Int64 { x + 10 }
      `,
      "main.clarity": `
        module Main
        import { helper } from "lib"
        function use_helper() -> Int64 { helper(5) }
      `,
    });

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    // Entry module function is exported
    expect(instance.exports.use_helper).toBeDefined();
    // Library function is NOT a WASM export (it's internal)
    expect(instance.exports.helper).toBeUndefined();

    const use_helper = instance.exports.use_helper as () => bigint;
    expect(use_helper()).toBe(15n);
  });
});

describe("Standard library (std/)", () => {
  function setupStdTest(mainSource: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-std-test-"));
    fs.writeFileSync(path.join(dir, "main.clarity"), mainSource);
    return dir;
  }

  it("imports std/math functions", async () => {
    const dir = setupStdTest(`
      module Main
      import { abs, clamp, sign, is_even } from "std/math"
      function test_abs() -> Int64 { abs(0 - 5) }
      function test_clamp() -> Int64 { clamp(15, 0, 10) }
      function test_sign() -> Int64 { sign(0 - 42) }
      function test_even() -> Bool { is_even(4) }
    `);

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_abs as () => bigint)()).toBe(5n);
    expect((instance.exports.test_clamp as () => bigint)()).toBe(10n);
    expect((instance.exports.test_sign as () => bigint)()).toBe(-1n);
    expect((instance.exports.test_even as () => number)()).toBe(1);
  });

  it("imports std/string functions", async () => {
    const dir = setupStdTest(`
      module Main
      import { length, repeat, is_blank, to_int } from "std/string"
      function test_length() -> Int64 { length("hello") }
      function test_repeat() -> String { repeat("ab", 3) }
      function test_blank() -> Bool { is_blank("") }
      function test_to_int() -> Int64 {
        match to_int("99") {
          Some(v) -> v,
          None -> 0
        }
      }
    `);

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_length as () => bigint)()).toBe(5n);
    const repeatResult = (instance.exports.test_repeat as () => number)();
    expect(runtime.readString(repeatResult)).toBe("ababab");
    expect((instance.exports.test_blank as () => number)()).toBe(1);
    expect((instance.exports.test_to_int as () => bigint)()).toBe(99n);
  });
});

describe("String interning", () => {
  it("deduplicates identical runtime strings (int_to_string)", async () => {
    const source = `
      module Test
      function make_str_a() -> String { int_to_string(42) }
      function make_str_b() -> String { int_to_string(42) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const a = (instance.exports.make_str_a as () => number)();
    const b = (instance.exports.make_str_b as () => number)();
    // Same value → same interned pointer
    expect(a).toBe(b);
  });

  it("deduplicates identical concat results", async () => {
    const source = `
      module Test
      function greet_a() -> String { "hello" ++ " world" }
      function greet_b() -> String { "hello" ++ " world" }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const a = (instance.exports.greet_a as () => number)();
    const b = (instance.exports.greet_b as () => number)();
    expect(runtime.readString(a)).toBe("hello world");
    // Same concat result → same interned pointer
    expect(a).toBe(b);
  });

  it("different strings get different pointers", async () => {
    const source = `
      module Test
      function str_a() -> String { int_to_string(1) }
      function str_b() -> String { int_to_string(2) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    const a = (instance.exports.str_a as () => number)();
    const b = (instance.exports.str_b as () => number)();
    expect(a).not.toBe(b);
  });
});

describe("Bytes and Timestamp builtins", () => {
  it("creates, reads, and modifies Bytes buffers", async () => {
    const source = `
      module Test
      function test_new_length() -> Int64 {
        bytes_length(bytes_new(5))
      }
      function test_set_get() -> Int64 {
        let b = bytes_set(bytes_new(3), 0, 65);
        bytes_get(b, 0)
      }
      function test_roundtrip() -> String {
        bytes_to_string(bytes_from_string("hello"))
      }
      function test_concat_length() -> Int64 {
        let c = bytes_concat(bytes_from_string("hi"), bytes_from_string("bye"));
        bytes_length(c)
      }
      function test_slice() -> String {
        bytes_to_string(bytes_slice(bytes_from_string("hello world"), 6, 5))
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_new_length as () => bigint)()).toBe(5n);
    expect((instance.exports.test_set_get as () => bigint)()).toBe(65n);
    const roundtrip = (instance.exports.test_roundtrip as () => number)();
    expect(runtime.readString(roundtrip)).toBe("hello");
    expect((instance.exports.test_concat_length as () => bigint)()).toBe(5n);
    const slice = (instance.exports.test_slice as () => number)();
    expect(runtime.readString(slice)).toBe("world");
  });

  it("performs Timestamp arithmetic and conversion", async () => {
    const source = `
      module Test
      function test_add() -> Int64 {
        timestamp_to_int(timestamp_add(timestamp_from_int(1000), 500))
      }
      function test_diff() -> Int64 {
        timestamp_diff(timestamp_from_int(5000), timestamp_from_int(3000))
      }
      function test_to_string() -> String {
        timestamp_to_string(timestamp_from_int(0))
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_add as () => bigint)()).toBe(1500n);
    expect((instance.exports.test_diff as () => bigint)()).toBe(2000n);
    const ts = (instance.exports.test_to_string as () => number)();
    expect(runtime.readString(ts)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("char_code returns Unicode code point of first character", async () => {
    const source = `
      module Test
      function test_a() -> Int64 { char_code("A") }
      function test_zero() -> Int64 { char_code("0") }
      function test_empty() -> Int64 { char_code("") }
      function test_hello() -> Int64 { char_code("hello") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_a as () => bigint)()).toBe(65n);
    expect((instance.exports.test_zero as () => bigint)()).toBe(48n);
    expect((instance.exports.test_empty as () => bigint)()).toBe(0n);
    expect((instance.exports.test_hello as () => bigint)()).toBe(104n); // 'h'
  });

  it("char_from_code returns string from Unicode code point", async () => {
    const source = `
      module Test
      function test_a() -> String { char_from_code(65) }
      function test_zero() -> String { char_from_code(48) }
      function test_space() -> String { char_from_code(32) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    expect(runtime.readString((instance.exports.test_a as () => number)())).toBe("A");
    expect(runtime.readString((instance.exports.test_zero as () => number)())).toBe("0");
    expect(runtime.readString((instance.exports.test_space as () => number)())).toBe(" ");
  });

  it("char_code and char_from_code round-trip", async () => {
    const source = `
      module Test
      function test() -> String {
        let code = char_code("Z");
        char_from_code(code)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    expect(runtime.readString((instance.exports.test as () => number)())).toBe("Z");
  });
});

describe("Crypto builtins", () => {
  it("sha256 returns correct hex digest for known inputs", async () => {
    const source = `
      module Test
      function hash_empty() -> String { sha256("") }
      function hash_hello() -> String { sha256("hello") }
      function hash_abc() -> String { sha256("abc") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    // Known SHA-256 values
    expect(runtime.readString((instance.exports.hash_empty as () => number)()))
      .toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(runtime.readString((instance.exports.hash_hello as () => number)()))
      .toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(runtime.readString((instance.exports.hash_abc as () => number)()))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("sha256 output is always 64 hex characters", async () => {
    const source = `
      module Test
      function hash_len() -> Int64 { string_length(sha256("test")) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.hash_len as () => bigint)()).toBe(64n);
  });

  it("sha256 is deterministic — same input gives same output", async () => {
    const source = `
      module Test
      function both_equal() -> Bool {
        let h1 = sha256("clarity");
        let h2 = sha256("clarity");
        string_eq(h1, h2)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.both_equal as () => number)()).toBe(1);
  });
});

describe("Map builtins", () => {
  it("map_new creates an empty map with size 0", async () => {
    const source = `
      module Test
      function test() -> Int64 {
        let m: Map<String, Int64> = map_new();
        map_size(m)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test as () => bigint)()).toBe(0n);
  });

  it("map_set and map_get with Int64 values", async () => {
    const source = `
      module Test
      function test_hit() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "answer", 42);
        match map_get(m2, "answer") { None -> 0, Some(v) -> v }
      }
      function test_miss() -> Int64 {
        let m: Map<String, Int64> = map_new();
        match map_get(m, "missing") { None -> 99, Some(v) -> v }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_hit as () => bigint)()).toBe(42n);
    expect((instance.exports.test_miss as () => bigint)()).toBe(99n);
  });

  it("map_set and map_get with String values", async () => {
    const source = `
      module Test
      function test_hit() -> String {
        let m: Map<String, String> = map_new();
        let m2 = map_set(m, "greeting", "hello");
        match map_get(m2, "greeting") { None -> "MISSING", Some(v) -> v }
      }
      function test_miss() -> String {
        let m: Map<String, String> = map_new();
        match map_get(m, "absent") { None -> "NONE", Some(v) -> v }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect(runtime.readString((instance.exports.test_hit as () => number)())).toBe("hello");
    expect(runtime.readString((instance.exports.test_miss as () => number)())).toBe("NONE");
  });

  it("map_size returns accurate count after multiple sets", async () => {
    const source = `
      module Test
      function test() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "a", 1);
        let m3 = map_set(m2, "b", 2);
        let m4 = map_set(m3, "c", 3);
        map_size(m4)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test as () => bigint)()).toBe(3n);
  });

  it("map_set overwrites an existing key", async () => {
    const source = `
      module Test
      function test() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "x", 10);
        let m3 = map_set(m2, "x", 99);
        match map_get(m3, "x") { None -> 0, Some(v) -> v }
      }
      function test_size() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "x", 10);
        let m3 = map_set(m2, "x", 99);
        map_size(m3)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test as () => bigint)()).toBe(99n);
    expect((instance.exports.test_size as () => bigint)()).toBe(1n);
  });

  it("map_has returns True/False correctly", async () => {
    const source = `
      module Test
      function test_present() -> Bool {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "key", 1);
        map_has(m2, "key")
      }
      function test_absent() -> Bool {
        let m: Map<String, Int64> = map_new();
        map_has(m, "key")
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_present as () => number)()).toBe(1);
    expect((instance.exports.test_absent as () => number)()).toBe(0);
  });

  it("map_remove removes a key and leaves others intact", async () => {
    const source = `
      module Test
      function test_size() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "a", 1);
        let m3 = map_set(m2, "b", 2);
        let m4 = map_remove(m3, "a");
        map_size(m4)
      }
      function test_removed() -> Bool {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "a", 1);
        let m3 = map_set(m2, "b", 2);
        let m4 = map_remove(m3, "a");
        map_has(m4, "a")
      }
      function test_kept() -> Bool {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "a", 1);
        let m3 = map_set(m2, "b", 2);
        let m4 = map_remove(m3, "a");
        map_has(m4, "b")
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_size as () => bigint)()).toBe(1n);
    expect((instance.exports.test_removed as () => number)()).toBe(0);
    expect((instance.exports.test_kept as () => number)()).toBe(1);
  });

  it("map_keys returns all keys as a list", async () => {
    const source = `
      module Test
      function test() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "x", 1);
        let m3 = map_set(m2, "y", 2);
        length(map_keys(m3))
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test as () => bigint)()).toBe(2n);
  });

  it("map_values returns all values as a list", async () => {
    const source = `
      module Test
      function test() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "x", 10);
        let m3 = map_set(m2, "y", 20);
        length(map_values(m3))
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test as () => bigint)()).toBe(2n);
  });

  it("map is immutable — set returns a new handle, original unchanged", async () => {
    const source = `
      module Test
      function test_original_unchanged() -> Int64 {
        let m: Map<String, Int64> = map_new();
        let m2 = map_set(m, "k", 42);
        map_size(m)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_original_unchanged as () => bigint)()).toBe(0n);
  });
});

// Helper: run all effect[Test] functions exported from a compiled WASM module.
// Returns the number of assertion failures across all test functions.
async function runExampleTests(wasmBytes: Uint8Array): Promise<{ passed: number; failed: number; failures: string[] }> {
  const { instance, runtime } = await instantiate(wasmBytes);
  const testFns = Object.keys(instance.exports)
    .filter(name => name.startsWith("test_") && typeof instance.exports[name] === "function");
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  for (const name of testFns) {
    runtime.resetTestState();
    runtime.setCurrentTest(name);
    try {
      (instance.exports[name] as () => void)();
      const { failures: assertFails } = runtime.getTestResults();
      if (assertFails.length === 0) {
        passed++;
      } else {
        failed++;
        for (const f of assertFails) {
          failures.push(`${name}: ${f.kind} actual=${f.actual} expected=${f.expected}`);
        }
      }
    } catch (e) {
      failed++;
      failures.push(`${name}: threw ${e}`);
    }
  }
  return { passed, failed, failures };
}

describe("Example: Template Engine (13)", () => {
  it("compiles without errors", () => {
    const result = compileFile(path.resolve("examples/13-template-engine/template.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
  });

  it("all 12 test functions pass", async () => {
    const result = compileFile(path.resolve("examples/13-template-engine/template.clarity"));
    expect(result.errors).toHaveLength(0);
    const { passed, failed, failures } = await runExampleTests(result.wasm!);
    expect(passed).toBe(12);
    expect(failures).toHaveLength(0);
    expect(failed).toBe(0);
  });
});

describe("Example: JSON Parser (19)", () => {
  it("compiles without errors", () => {
    const result = compileFile(path.resolve("examples/19-json-parser/json.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
  });

  it("all 17 test functions pass", async () => {
    const result = compileFile(path.resolve("examples/19-json-parser/json.clarity"));
    expect(result.errors).toHaveLength(0);
    const { passed, failed, failures } = await runExampleTests(result.wasm!);
    expect(passed).toBe(17);
    expect(failures).toHaveLength(0);
    expect(failed).toBe(0);
  });
});

describe("Example: Todo CLI (11)", () => {
  it("compiles without errors", () => {
    const result = compileFile(path.resolve("examples/11-todo-cli/todo.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
  });

  it("all 21 test functions pass", async () => {
    const result = compileFile(path.resolve("examples/11-todo-cli/todo.clarity"));
    expect(result.errors).toHaveLength(0);
    const { passed, failed, failures } = await runExampleTests(result.wasm!);
    expect(passed).toBe(21);
    expect(failures).toHaveLength(0);
    expect(failed).toBe(0);
  });
});

describe("Example: Log Analyzer (12)", () => {
  it("compiles without errors", () => {
    const result = compileFile(path.resolve("examples/12-log-analyzer/log_analyzer.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
  });

  it("all 22 test functions pass", async () => {
    const result = compileFile(path.resolve("examples/12-log-analyzer/log_analyzer.clarity"));
    expect(result.errors).toHaveLength(0);
    const { passed, failed, failures } = await runExampleTests(result.wasm!);
    expect(passed).toBe(22);
    expect(failures).toHaveLength(0);
    expect(failed).toBe(0);
  });
});
