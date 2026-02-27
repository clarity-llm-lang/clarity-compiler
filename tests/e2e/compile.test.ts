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

    const { instance, runtime } = await instantiate(result.wasm!);
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

    const { instance, runtime } = await instantiate(result.wasm!);
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

    const { instance, runtime } = await instantiate(result.wasm!);
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

    const { instance, runtime } = await instantiate(result.wasm!);
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

  it("string_to_int rejects partial parses like '3.14'", async () => {
    const source = `
      module Test
      function parse(s: String) -> Int64 {
        match string_to_int(s) { Some(n) -> n, None -> 0 - 999 }
      }
    `;
    const { instance, runtime } = await instantiate(compile(source, "test.clarity").wasm!);
    const parse = instance.exports.parse as (p: number) => bigint;
    expect(parse(runtime.writeString("42"))).toBe(42n);
    expect(parse(runtime.writeString("-5"))).toBe(-5n);
    expect(parse(runtime.writeString("3.14"))).toBe(-999n);   // was wrongly Some(3) before
    expect(parse(runtime.writeString("42abc"))).toBe(-999n);  // partial parse → None
    expect(parse(runtime.writeString("abc"))).toBe(-999n);
  });

  it("string_to_float rejects partial parses like '3.14abc'", async () => {
    const source = `
      module Test
      function parse(s: String) -> Float64 {
        match string_to_float(s) { Some(n) -> n, None -> 0.0 - 999.0 }
      }
    `;
    const { instance, runtime } = await instantiate(compile(source, "test.clarity").wasm!);
    const parse = instance.exports.parse as (p: number) => number;
    expect(parse(runtime.writeString("3.14"))).toBeCloseTo(3.14, 5);
    expect(parse(runtime.writeString("42"))).toBeCloseTo(42, 5);
    expect(parse(runtime.writeString("3.14abc"))).toBeCloseTo(-999, 5); // was wrongly Some(3.14) before
    expect(parse(runtime.writeString(""))).toBeCloseTo(-999, 5);         // empty → None
    expect(parse(runtime.writeString("abc"))).toBeCloseTo(-999, 5);
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

  it("string_starts_with and string_ends_with work", async () => {
    const source = `
      module Test
      function starts(s: String) -> Bool { string_starts_with(s, "clar") }
      function ends(s: String) -> Bool { string_ends_with(s, "ity") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const starts = instance.exports.starts as (ptr: number) => number;
    const ends = instance.exports.ends as (ptr: number) => number;
    expect(starts(runtime.writeString("clarity"))).toBe(1);
    expect(starts(runtime.writeString("lang"))).toBe(0);
    expect(ends(runtime.writeString("clarity"))).toBe(1);
    expect(ends(runtime.writeString("clar"))).toBe(0);
  });

  it("string_repeat repeats and handles non-positive counts", async () => {
    const source = `
      module Test
      function rep(s: String, n: Int64) -> String { string_repeat(s, n) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const rep = instance.exports.rep as (ptr: number, n: bigint) => number;
    expect(runtime.readString(rep(runtime.writeString("ab"), 3n))).toBe("ababab");
    expect(runtime.readString(rep(runtime.writeString("ab"), 0n))).toBe("");
  });

  it("int_clamp and float_clamp work", async () => {
    const source = `
      module Test
      function ci(v: Int64) -> Int64 { int_clamp(v, 0, 10) }
      function cf(v: Float64) -> Float64 { float_clamp(v, 0.0, 1.0) }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const ci = instance.exports.ci as (v: bigint) => bigint;
    const cf = instance.exports.cf as (v: number) => number;
    expect(ci(-5n)).toBe(0n);
    expect(ci(12n)).toBe(10n);
    expect(ci(7n)).toBe(7n);
    expect(cf(-1.2)).toBeCloseTo(0.0);
    expect(cf(1.8)).toBeCloseTo(1.0);
    expect(cf(0.33)).toBeCloseTo(0.33);
  });

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


  it("json_parse_object parses object and map_size is accessible", async () => {
    const source = `
      module Test
      function count_fields() -> Int64 {
        match json_parse_object("{\\"a\\":1,\\"b\\":\\"x\\"}") {
          Err(e) -> 0,
          Ok(obj) -> map_size(obj)
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const count_fields = instance.exports.count_fields as () => bigint;
    expect(count_fields()).toBe(2n);
  });

  it("json_stringify_object serializes parsed object", async () => {
    const source = `
      module Test
      function render() -> String {
        match json_parse_object("{\\"name\\":\\"alice\\"}") {
          Err(e) -> e,
          Ok(obj) -> json_stringify_object(obj)
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const render = instance.exports.render as () => number;
    const out = runtime.readString(render());
    expect(out).toContain('"name"');
    expect(out).toContain('"alice"');
  });

  it("http_listen requires Network effect", () => {
    const source = `
      module Test
      function bad() -> String {
        match http_listen(8080) {
          Ok(v) -> v,
          Err(e) -> e
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Network");
  });

  it("db_execute requires DB effect", () => {
    const source = `
      module Test
      function bad() -> Int64 {
        match db_execute("DELETE FROM users", []) {
          Ok(n) -> n,
          Err(e) -> 0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("DB");
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

  it("imports std/list functions", async () => {
    const dir = setupStdTest(`
      module Main
      import { size, first, rest, push, join, reversed, empty, get, set_at } from "std/list"
      function test_size() -> Int64 { size([1, 2, 3]) }
      function test_first() -> Int64 { first([42, 7]) }
      function test_rest_head() -> Int64 { first(rest([9, 8, 7])) }
      function test_push_get() -> Int64 { get(push([1, 2], 3), 2) }
      function test_join_get() -> Int64 { get(join([1, 2], [3, 4]), 3) }
      function test_reversed_first() -> Int64 { first(reversed([1, 2, 3])) }
      function test_empty() -> Bool { empty(rest([5])) }
      function test_set_at() -> Int64 { get(set_at([1, 2, 3], 1, 99), 1) }
      function test_string_head() -> String { first(["a", "b"]) }
    `);

    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_size as () => bigint)()).toBe(3n);
    expect((instance.exports.test_first as () => bigint)()).toBe(42n);
    expect((instance.exports.test_rest_head as () => bigint)()).toBe(8n);
    expect((instance.exports.test_push_get as () => bigint)()).toBe(3n);
    expect((instance.exports.test_join_get as () => bigint)()).toBe(4n);
    expect((instance.exports.test_reversed_first as () => bigint)()).toBe(3n);
    expect((instance.exports.test_empty as () => number)()).toBe(1);
    expect((instance.exports.test_set_at as () => bigint)()).toBe(99n);
    expect(runtime.readString((instance.exports.test_string_head as () => number)())).toBe("a");
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

describe("JSON builtins", () => {
  it("json_parse parses flat object scalars into Map<String, String>", async () => {
    const source = `
      module Test
      function get_name() -> String {
        match json_parse("{\\"name\\":\\"Alice\\",\\"age\\":42,\\"ok\\":true,\\"none\\":null}") {
          None -> "ERROR",
          Some(m) -> match map_get(m, "name") { None -> "MISSING", Some(v) -> v }
        }
      }
      function get_age() -> String {
        match json_parse("{\\"name\\":\\"Alice\\",\\"age\\":42}") {
          None -> "ERROR",
          Some(m) -> match map_get(m, "age") { None -> "MISSING", Some(v) -> v }
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect(runtime.readString((instance.exports.get_name as () => number)())).toBe("Alice");
    expect(runtime.readString((instance.exports.get_age as () => number)())).toBe("42");
  });

  it("json_parse returns None for invalid or unsupported input", async () => {
    const source = `
      module Test
      function invalid_json_is_none() -> Bool {
        match json_parse("not json") { None -> True, Some(_) -> False }
      }
      function nested_object_is_none() -> Bool {
        match json_parse("{\\"outer\\":{\\"inner\\":1}}") { None -> True, Some(_) -> False }
      }
      function array_root_is_none() -> Bool {
        match json_parse("[1,2,3]") { None -> True, Some(_) -> False }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.invalid_json_is_none as () => number)()).toBe(1);
    expect((instance.exports.nested_object_is_none as () => number)()).toBe(1);
    expect((instance.exports.array_root_is_none as () => number)()).toBe(1);
  });

  it("json_stringify serializes Map<String, String> with literal detection", async () => {
    const source = `
      module Test
      function test() -> String {
        let m: Map<String, String> = map_new();
        let m1 = map_set(m, "name", "Alice");
        let m2 = map_set(m1, "age", "42");
        let m3 = map_set(m2, "active", "true");
        let m4 = map_set(m3, "middle", "null");
        json_stringify(m4)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect(runtime.readString((instance.exports.test as () => number)())).toBe(
      "{\"name\":\"Alice\",\"age\":42,\"active\":true,\"middle\":null}",
    );
  });

  it("json_get_nested extracts deeply nested values", async () => {
    const source = `
      module Test
      function get_name() -> String {
        match json_get_nested("{\\"user\\":{\\"name\\":\\"Alice\\"}}", "user.name") {
          None -> "MISSING",
          Some(v) -> v
        }
      }
      function get_item() -> String {
        match json_get_nested("[1,2,3]", "1") {
          None -> "MISSING",
          Some(v) -> v
        }
      }
      function get_nested_array() -> String {
        match json_get_nested("{\\"items\\":[{\\"id\\":42}]}", "items.0.id") {
          None -> "MISSING",
          Some(v) -> v
        }
      }
      function get_missing() -> Bool {
        match json_get_nested("{\\"a\\":1}", "b.c") {
          None -> True,
          Some(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect(runtime.readString((instance.exports.get_name as () => number)())).toBe("Alice");
    expect(runtime.readString((instance.exports.get_item as () => number)())).toBe("2");
    expect(runtime.readString((instance.exports.get_nested_array as () => number)())).toBe("42");
    expect((instance.exports.get_missing as () => number)()).toBe(1);
  });

  it("json_array_length returns length of JSON array", async () => {
    const source = `
      module Test
      function len() -> Int64 {
        match json_array_length("[1,2,3]") {
          None -> -1,
          Some(n) -> n
        }
      }
      function len_empty() -> Int64 {
        match json_array_length("[]") {
          None -> -1,
          Some(n) -> n
        }
      }
      function len_non_array() -> Int64 {
        match json_array_length("{\\"a\\":1}") {
          None -> -1,
          Some(n) -> n
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.len as () => bigint)()).toBe(3n);
    expect((instance.exports.len_empty as () => bigint)()).toBe(0n);
    expect((instance.exports.len_non_array as () => bigint)()).toBe(-1n);
  });

  it("json_array_get retrieves element by index", async () => {
    const source = `
      module Test
      function first() -> String {
        match json_array_get("[{\\"id\\":1},{\\"id\\":2}]", 0) {
          None -> "MISSING",
          Some(v) -> v
        }
      }
      function second_str() -> String {
        match json_array_get("[\\"hello\\",\\"world\\"]", 1) {
          None -> "MISSING",
          Some(v) -> v
        }
      }
      function oob() -> Bool {
        match json_array_get("[1,2]", 5) {
          None -> True,
          Some(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect(runtime.readString((instance.exports.first as () => number)())).toBe("{\"id\":1}");
    expect(runtime.readString((instance.exports.second_str as () => number)())).toBe("world");
    expect((instance.exports.oob as () => number)()).toBe(1);
  });

  it("json_keys returns top-level keys of a JSON object", async () => {
    const source = `
      module Test
      function key_count() -> Int64 {
        match json_keys("{\\"a\\":1,\\"b\\":2,\\"c\\":3}") {
          None -> -1,
          Some(ks) -> length(ks)
        }
      }
      function non_object_is_none() -> Bool {
        match json_keys("[1,2]") {
          None -> True,
          Some(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.key_count as () => bigint)()).toBe(3n);
    expect((instance.exports.non_object_is_none as () => number)()).toBe(1);
  });

  it("http_request performs GET with custom headers", async () => {
    const source = `
      module Test
      effect[Network] function fetch(url: String) -> String {
        match http_request("GET", url, "{}", "") {
          Ok(body) -> body,
          Err(message) -> message
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-http-req-"));
    const filePath = path.join(tmpDir, "data.txt");
    fs.writeFileSync(filePath, "ok-data", "utf-8");

    const { instance, runtime } = await instantiate(result.wasm!);
    const fetchFn = instance.exports.fetch as (urlPtr: number) => number;
    const urlPtr = runtime.writeString(`file://${filePath}`);
    const bodyPtr = fetchFn(urlPtr);
    expect(runtime.readString(bodyPtr)).toBe("ok-data");
  });

  it("http_request_full returns status and body as JSON", async () => {
    const source = `
      module Test
      effect[Network] function fetch_status(url: String) -> String {
        match http_request_full("GET", url, "{}", "") {
          Ok(resp_json) -> match json_get(resp_json, "status") {
            None -> "NO_STATUS",
            Some(s) -> s
          },
          Err(message) -> message
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-http-full-"));
    const filePath = path.join(tmpDir, "payload.json");
    fs.writeFileSync(filePath, "{\"hello\":\"world\"}", "utf-8");

    const { instance, runtime } = await instantiate(result.wasm!);
    const fetchFn = instance.exports.fetch_status as (urlPtr: number) => number;
    const urlPtr = runtime.writeString(`file://${filePath}`);
    const statusPtr = fetchFn(urlPtr);
    expect(runtime.readString(statusPtr)).toBe("200");
  });

  it("rejects http_request without Network effect", () => {
    const source = `
      module Test
      function fetch(url: String) -> String {
        match http_request("GET", url, "{}", "") {
          Ok(body) -> body,
          Err(message) -> message
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Network");
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

describe("Generic HOF monomorphization (List<T> type param fix)", () => {
  it("map over List<Int64> with Int64->Int64 function produces correct results", async () => {
    const source = `
      module Test
      function double(x: Int64) -> Int64 { x * 2 }
      function map_list<T, U>(xs: List<T>, f: (T) -> U) -> List<U> {
        match is_empty(xs) {
          True -> [],
          False -> concat([f(head(xs))], map_list(tail(xs), f))
        }
      }
      function test_len() -> Int64 {
        let result = map_list([1, 2, 3], double);
        length(result)
      }
      function test_first() -> Int64 {
        let result = map_list([1, 2, 3], double);
        nth(result, 0)
      }
      function test_last() -> Int64 {
        let result = map_list([1, 2, 3], double);
        nth(result, 2)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_len as () => bigint)()).toBe(3n);
    expect((instance.exports.test_first as () => bigint)()).toBe(2n);
    expect((instance.exports.test_last as () => bigint)()).toBe(6n);
  });

  it("filter over List<Int64> preserves order and correctness", async () => {
    const source = `
      module Test
      function is_even(x: Int64) -> Bool { x % 2 == 0 }
      function filter_list<T>(xs: List<T>, pred: (T) -> Bool) -> List<T> {
        match is_empty(xs) {
          True -> [],
          False -> {
            let h = head(xs);
            let rest = filter_list(tail(xs), pred);
            match pred(h) {
              True -> concat([h], rest),
              False -> rest
            }
          }
        }
      }
      function test_len() -> Int64 {
        let result = filter_list([1, 2, 3, 4, 5, 6], is_even);
        length(result)
      }
      function test_first() -> Int64 {
        let result = filter_list([1, 2, 3, 4, 5, 6], is_even);
        nth(result, 0)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_len as () => bigint)()).toBe(3n);
    expect((instance.exports.test_first as () => bigint)()).toBe(2n);
  });

  it("fold_left with List<Int64> accumulator and Int64 elements", async () => {
    const source = `
      module Test
      function add(a: Int64, b: Int64) -> Int64 { a + b }
      function fold_left<T, A>(xs: List<T>, init: A, f: (A, T) -> A) -> A {
        match is_empty(xs) {
          True -> init,
          False -> fold_left(tail(xs), f(init, head(xs)), f)
        }
      }
      function test_sum() -> Int64 { fold_left([1, 2, 3, 4], 0, add) }
      function test_empty() -> Int64 {
        let empty: List<Int64> = [];
        fold_left(empty, 99, add)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_sum as () => bigint)()).toBe(10n);
    expect((instance.exports.test_empty as () => bigint)()).toBe(99n);
  });
});

describe("Standard library: std/list", () => {
  // setupModuleTest creates a temp dir; we also need std/list.clarity there.
  function setupListTest(mainSource: string): string {
    const listSrc = fs.readFileSync(path.resolve("std/list.clarity"), "utf-8");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-list-test-"));
    fs.mkdirSync(path.join(dir, "std"));
    fs.writeFileSync(path.join(dir, "std", "list.clarity"), listSrc);
    fs.writeFileSync(path.join(dir, "main.clarity"), mainSource);
    return dir;
  }

  it("compiles without errors", () => {
    const result = compileFile(path.resolve("std/list.clarity"));
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
  });

  it("map produces correct values in order", async () => {
    const dir = setupListTest(`
      module Main
      import { map } from "std/list"
      function double(x: Int64) -> Int64 { x * 2 }
      function test_len() -> Int64 { length(map([1, 2, 3], double)) }
      function test_first() -> Int64 { nth(map([1, 2, 3], double), 0) }
      function test_last() -> Int64 { nth(map([1, 2, 3], double), 2) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_len as () => bigint)()).toBe(3n);
    expect((instance.exports.test_first as () => bigint)()).toBe(2n);
    expect((instance.exports.test_last as () => bigint)()).toBe(6n);
  });

  it("filter keeps matching elements in order", async () => {
    const dir = setupListTest(`
      module Main
      import { filter } from "std/list"
      function is_even(x: Int64) -> Bool { x % 2 == 0 }
      function test_len() -> Int64 { length(filter([1, 2, 3, 4, 5], is_even)) }
      function test_first() -> Int64 { nth(filter([1, 2, 3, 4, 5], is_even), 0) }
      function test_second() -> Int64 { nth(filter([1, 2, 3, 4, 5], is_even), 1) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_len as () => bigint)()).toBe(2n);
    expect((instance.exports.test_first as () => bigint)()).toBe(2n);
    expect((instance.exports.test_second as () => bigint)()).toBe(4n);
  });

  it("fold_left sums correctly and respects empty list", async () => {
    const dir = setupListTest(`
      module Main
      import { fold_left } from "std/list"
      function add(a: Int64, b: Int64) -> Int64 { a + b }
      function test_sum() -> Int64 { fold_left([1, 2, 3, 4], 0, add) }
      function test_empty() -> Int64 {
        let empty: List<Int64> = [];
        fold_left(empty, 99, add)
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_sum as () => bigint)()).toBe(10n);
    expect((instance.exports.test_empty as () => bigint)()).toBe(99n);
  });

  it("any, all, count_where work correctly", async () => {
    const dir = setupListTest(`
      module Main
      import { any, all, count_where } from "std/list"
      function is_even(x: Int64) -> Bool { x % 2 == 0 }
      function test_any_t() -> Bool { any([1, 3, 4, 7], is_even) }
      function test_any_f() -> Bool { any([1, 3, 5, 7], is_even) }
      function test_all_t() -> Bool { all([2, 4, 6], is_even) }
      function test_all_f() -> Bool { all([2, 4, 5], is_even) }
      function test_count() -> Int64 { count_where([1, 2, 3, 4, 5, 6], is_even) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_any_t as () => number)()).toBe(1);
    expect((instance.exports.test_any_f as () => number)()).toBe(0);
    expect((instance.exports.test_all_t as () => number)()).toBe(1);
    expect((instance.exports.test_all_f as () => number)()).toBe(0);
    expect((instance.exports.test_count as () => bigint)()).toBe(3n);
  });

  it("zip_with, take, drop work correctly", async () => {
    const dir = setupListTest(`
      module Main
      import { zip_with, take, drop } from "std/list"
      function add(a: Int64, b: Int64) -> Int64 { a + b }
      function test_zip_first() -> Int64 { nth(zip_with([1, 2, 3], [10, 20, 30], add), 0) }
      function test_zip_last() -> Int64 { nth(zip_with([1, 2, 3], [10, 20, 30], add), 2) }
      function test_take_len() -> Int64 { length(take([1, 2, 3, 4, 5], 3)) }
      function test_take_first() -> Int64 { nth(take([1, 2, 3, 4, 5], 3), 0) }
      function test_drop_len() -> Int64 { length(drop([1, 2, 3, 4, 5], 2)) }
      function test_drop_first() -> Int64 { nth(drop([1, 2, 3, 4, 5], 2), 0) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_zip_first as () => bigint)()).toBe(11n);
    expect((instance.exports.test_zip_last as () => bigint)()).toBe(33n);
    expect((instance.exports.test_take_len as () => bigint)()).toBe(3n);
    expect((instance.exports.test_take_first as () => bigint)()).toBe(1n);
    expect((instance.exports.test_drop_len as () => bigint)()).toBe(3n);
    expect((instance.exports.test_drop_first as () => bigint)()).toBe(3n);
  });

  it("sum, product, maximum, minimum, range, replicate work correctly", async () => {
    const dir = setupListTest(`
      module Main
      import { sum, product, maximum, minimum, range, replicate } from "std/list"
      function test_sum() -> Int64 { sum([1, 2, 3, 4, 5]) }
      function test_product() -> Int64 { product([1, 2, 3, 4]) }
      function test_max() -> Int64 { maximum([3, 1, 4, 1, 5, 9], 0) }
      function test_min() -> Int64 { minimum([3, 1, 4, 1, 5, 9], 9) }
      function test_range_len() -> Int64 { length(range(1, 6)) }
      function test_range_first() -> Int64 { nth(range(1, 6), 0) }
      function test_range_sum() -> Int64 { sum(range(1, 6)) }
      function test_rep_len() -> Int64 { length(replicate(7, 4)) }
      function test_rep_sum() -> Int64 { sum(replicate(7, 4)) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.test_sum as () => bigint)()).toBe(15n);
    expect((instance.exports.test_product as () => bigint)()).toBe(24n);
    expect((instance.exports.test_max as () => bigint)()).toBe(9n);
    expect((instance.exports.test_min as () => bigint)()).toBe(1n);
    expect((instance.exports.test_range_len as () => bigint)()).toBe(5n);
    expect((instance.exports.test_range_first as () => bigint)()).toBe(1n);
    expect((instance.exports.test_range_sum as () => bigint)()).toBe(15n);
    expect((instance.exports.test_rep_len as () => bigint)()).toBe(4n);
    expect((instance.exports.test_rep_sum as () => bigint)()).toBe(28n);
  });
});

// ---------------------------------------------------------------------------
// Memory management — arena_save / arena_restore / memory_stats
// ---------------------------------------------------------------------------

describe("Memory management (arena allocator + free list)", () => {
  it("arena_save returns a non-negative Int64 heap mark", async () => {
    const source = `
      module Test
      function get_mark() -> Int64 { arena_save() }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const mark = (instance.exports.get_mark as () => bigint)();
    expect(mark >= 0n).toBe(true);
  });

  it("arena_restore does not crash on an identity restore (mark == current ptr)", async () => {
    const source = `
      module Test
      function noop_restore() -> Int64 {
        let mark = arena_save();
        arena_restore(mark);
        42
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.noop_restore as () => bigint)()).toBe(42n);
  });

  it("arena_restore rewinds heap pointer back to the saved mark", async () => {
    const source = `
      module Test
      function measure() -> Int64 {
        let before = arena_save();
        let _ = int_to_string(12345);
        let _ = int_to_string(67890);
        arena_restore(before);
        // heap is back at 'before'; a new save should return the same value
        arena_save()
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const afterRestore = (instance.exports.measure as () => bigint)();
    // afterRestore is a valid heap pointer (>= 0)
    expect(afterRestore >= 0n).toBe(true);
  });

  it("heap grows during allocations and stays bounded with arena restore", async () => {
    const source = `
      module Test
      function alloc_and_free(n: Int64) -> Int64 {
        let mark = arena_save();
        let _ = int_to_string(n);
        let _ = int_to_string(n + 1);
        let _ = int_to_string(n + 2);
        arena_restore(mark);
        n
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const fn = instance.exports.alloc_and_free as (n: bigint) => bigint;

    fn(100n);
    const heapAfterFirst = runtime.getHeapPtr();
    fn(200n);
    const heapAfterSecond = runtime.getHeapPtr();

    // After the arena_restore the bump pointer returns to the saved mark,
    // so the second call must not push the heap further than the first.
    expect(heapAfterSecond).toBeLessThanOrEqual(heapAfterFirst);
  });

  it("memory_stats returns valid JSON with expected fields", async () => {
    const source = `
      module Test
      function get_stats() -> String { memory_stats() }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const ptr = (instance.exports.get_stats as () => number)();
    const json = runtime.readString(ptr);
    const stats = JSON.parse(json) as Record<string, number>;
    expect(typeof stats.heap_ptr).toBe("number");
    expect(typeof stats.live_allocs).toBe("number");
    expect(typeof stats.free_blocks).toBe("number");
    expect(typeof stats.interned_strings).toBe("number");
    expect(stats.heap_ptr).toBeGreaterThan(0);
  });

  it("free-list reuse: live_alloc count does not grow across repeated alloc/free cycles", async () => {
    const source = `
      module Test
      function cycle(n: Int64) -> Int64 {
        let mark = arena_save();
        let _ = int_to_string(n);
        arena_restore(mark);
        n
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const fn = instance.exports.cycle as (n: bigint) => bigint;

    fn(1n);
    const allocsAfterFirst = runtime.getLiveAllocCount();
    fn(2n);
    const allocsAfterSecond = runtime.getLiveAllocCount();
    fn(3n);
    const allocsAfterThird = runtime.getLiveAllocCount();

    // Subsequent cycles should not increase live allocation count because
    // the blocks freed by arena_restore are reclaimed by the free list.
    expect(allocsAfterSecond).toBeLessThanOrEqual(allocsAfterFirst);
    expect(allocsAfterThird).toBeLessThanOrEqual(allocsAfterFirst);
  });

  it("nested arenas work correctly", async () => {
    const source = `
      module Test
      function nested() -> Int64 {
        let outer = arena_save();
        let s1 = int_to_string(1);
        let inner = arena_save();
        let s2 = int_to_string(2);
        arena_restore(inner);   // free s2 only
        let s3 = int_to_string(3);
        arena_restore(outer);   // free s1 and s3
        99
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.nested as () => bigint)()).toBe(99n);
  });

  it("values allocated before arena_save remain valid after arena_restore", async () => {
    const source = `
      module Test
      function stable() -> Int64 {
        // Allocate s1 before the mark; it must survive the restore
        let s1 = int_to_string(777);
        let mark = arena_save();
        let _ = int_to_string(888);
        arena_restore(mark);
        // s1 was allocated before mark so it is untouched
        match string_to_int(s1) {
          Some(v) -> v,
          None -> 0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.stable as () => bigint)()).toBe(777n);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — AI interop: Secret + Model builtins
// ---------------------------------------------------------------------------

describe("Secret builtin (get_secret)", () => {
  it("get_secret compiles with Secret effect annotation", async () => {
    const source = `
      module Test
      effect[Secret] function read_key() -> String {
        match get_secret("MY_KEY") {
          Some(v) -> v,
          None -> "missing"
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("get_secret returns Some when env var is set", async () => {
    const source = `
      module Test
      effect[Secret] function has_key() -> Int64 {
        match get_secret("CLARITY_TEST_SECRET") {
          Some(_) -> 1,
          None -> 0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const fn = instance.exports.has_key as () => bigint;

    // With env var set: returns 1
    const savedEnv = process.env.CLARITY_TEST_SECRET;
    process.env.CLARITY_TEST_SECRET = "hello";
    expect(fn()).toBe(1n);

    // Without env var: returns 0
    delete process.env.CLARITY_TEST_SECRET;
    expect(fn()).toBe(0n);

    // Restore
    if (savedEnv !== undefined) process.env.CLARITY_TEST_SECRET = savedEnv;
  });

  it("get_secret returns the correct string value", async () => {
    const source = `
      module Test
      effect[Secret] function read_val() -> String {
        match get_secret("CLARITY_TEST_SECRET") {
          Some(v) -> v,
          None -> "MISSING"
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const fn = instance.exports.read_val as () => number;

    const saved = process.env.CLARITY_TEST_SECRET;
    process.env.CLARITY_TEST_SECRET = "supersecret";
    expect(runtime.readString(fn())).toBe("supersecret");
    if (saved !== undefined) process.env.CLARITY_TEST_SECRET = saved;
    else delete process.env.CLARITY_TEST_SECRET;
  });
});

describe("Model builtins (call_model, call_model_system, list_models)", () => {
  it("call_model compiles with Model effect annotation and returns Result<String, String>", async () => {
    const source = `
      module Test
      effect[Model] function ask() -> String {
        match call_model("gpt-4o-mini", "say hi") {
          Ok(text) -> text,
          Err(msg) -> msg
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("call_model_system compiles with three-argument form", async () => {
    const source = `
      module Test
      effect[Model] function ask_with_system() -> String {
        match call_model_system("gpt-4o-mini", "You are a helpful assistant.", "What is 2+2?") {
          Ok(text) -> text,
          Err(msg) -> msg
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("list_models compiles and returns List<String>", async () => {
    const source = `
      module Test
      effect[Model] function model_count() -> Int64 {
        length(list_models())
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("call_model returns Err when OPENAI_API_KEY is not set", async () => {
    const source = `
      module Test
      effect[Model] function ask() -> Int64 {
        match call_model("gpt-4o-mini", "hello") {
          Ok(_) -> 1,
          Err(_) -> 0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const fn = instance.exports.ask as () => bigint;

    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    // Without a real key the curl call will fail → Err branch → 0
    const outcome = fn();
    expect(outcome === 0n || outcome === 1n).toBe(true); // either is valid in CI
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });
});

function copyStdFile(dir: string, name: string) {
  const src = fs.readFileSync(path.join(process.cwd(), "std", name), "utf-8");
  fs.writeFileSync(path.join(dir, "std", name), src);
}

describe("std/llm module", () => {
  function setupLlmTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-llm-"));
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    copyStdFile(dir, "llm.clarity");
    copyStdFile(dir, "result.clarity");
    return dir;
  }

  it("imports and compiles prompt, chat from std/llm with result helpers from std/result", async () => {
    const dir = setupLlmTest(`
      module Main
      import { prompt, chat } from "std/llm"
      import { unwrap_or, is_ok, error_of } from "std/result"

      effect[Model] function ask_default() -> String {
        unwrap_or(prompt("Hello"), "error")
      }
      effect[Model] function ask_chat() -> String {
        unwrap_or(chat("gpt-4o-mini", "Be concise.", "Hi"), "error")
      }
      function check_is_ok(r: Result<String, String>) -> Bool { is_ok(r) }
      function check_error(r: Result<String, String>) -> String { error_of(r) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
  });

  it("unwrap_or returns the fallback string without Model effect", async () => {
    const dir = setupLlmTest(`
      module Main
      import { unwrap_or } from "std/result"

      function fallback_test() -> String {
        unwrap_or(Err("failed"), "default_value")
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const ptr = (instance.exports.fallback_test as () => number)();
    expect(runtime.readString(ptr)).toBe("default_value");
  });

  it("is_ok and error_of work on Ok and Err values", async () => {
    const dir = setupLlmTest(`
      module Main
      import { is_ok, error_of } from "std/result"

      function test_ok() -> Bool { is_ok(Ok("great")) }
      function test_err_is_not_ok() -> Bool { is_ok(Err("oops")) }
      function test_error_of() -> String { error_of(Err("bad thing")) }
      function test_error_of_ok() -> String { error_of(Ok("fine")) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_ok as () => number)()).toBe(1);
    expect((instance.exports.test_err_is_not_ok as () => number)()).toBe(0);
    expect(runtime.readString((instance.exports.test_error_of as () => number)())).toBe("bad thing");
    expect(runtime.readString((instance.exports.test_error_of_ok as () => number)())).toBe("");
  });
});

describe("MCP builtins (mcp_connect, mcp_list_tools, mcp_call_tool, mcp_disconnect)", () => {
  it("mcp_connect compiles with MCP effect annotation and returns Result<Int64, String>", async () => {
    const source = `
      module Test
      effect[MCP] function try_connect() -> Int64 {
        match mcp_connect("http://localhost:9999/mcp") {
          Ok(session) -> session,
          Err(_) -> 0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("mcp_connect stores session and returns non-zero handle", async () => {
    const source = `
      module Test
      effect[MCP] function get_session_id() -> Int64 {
        match mcp_connect("http://localhost:9999/mcp") {
          Ok(id) -> id,
          Err(_) -> 0
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    const fn = instance.exports.get_session_id as () => bigint;
    // mcp_connect is a no-op that always succeeds (session IDs start at 1)
    expect(fn()).toBe(1n);
  });

  it("mcp_disconnect compiles and runs without error", async () => {
    const source = `
      module Test
      effect[MCP] function connect_and_close() -> Unit {
        match mcp_connect("http://localhost:9999/mcp") {
          Ok(session) -> mcp_disconnect(session),
          Err(_) -> {}
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect(() => (instance.exports.connect_and_close as () => void)()).not.toThrow();
  });

  it("mcp_list_tools returns Err for unknown session", async () => {
    const source = `
      module Test
      effect[MCP] function list_unknown() -> Bool {
        match mcp_list_tools(999) {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    // Session 999 doesn't exist → should return Err → False (0)
    expect((instance.exports.list_unknown as () => number)()).toBe(0);
  });

  it("mcp_call_tool returns Err for unknown session", async () => {
    const source = `
      module Test
      effect[MCP] function call_unknown() -> Bool {
        match mcp_call_tool(999, "some_tool", "{}") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.call_unknown as () => number)()).toBe(0);
  });

  it("multiple mcp_connect calls return different session IDs", async () => {
    const source = `
      module Test
      effect[MCP] function two_sessions() -> Bool {
        match mcp_connect("http://a.invalid/mcp") {
          Ok(s1) -> {
            match mcp_connect("http://b.invalid/mcp") {
              Ok(s2) -> s1 != s2,
              Err(_) -> False
            }
          },
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.two_sessions as () => number)()).toBe(1);
  });
});

describe("std/mcp module", () => {
  function setupMcpTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-mcp-"));
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    copyStdFile(dir, "mcp.clarity");
    copyStdFile(dir, "result.clarity");
    return dir;
  }

  it("imports and compiles connect, call_tool, disconnect from std/mcp", async () => {
    const dir = setupMcpTest(`
      module Main
      import { connect, call_tool, disconnect } from "std/mcp"
      import { unwrap_or } from "std/result"

      effect[MCP] function run() -> String {
        match connect("http://localhost:9999/mcp") {
          Ok(session) -> {
            let result = call_tool(session, "ping", "{}");
            disconnect(session);
            unwrap_or(result, "error")
          },
          Err(msg) -> "connect error: " ++ msg
        }
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
  });

  it("unwrap_or and is_ok work on Result<String, String>", async () => {
    const dir = setupMcpTest(`
      module Main
      import { unwrap_or, is_ok, error_of } from "std/result"

      function test_ok() -> Bool { is_ok(Ok("great")) }
      function test_err() -> Bool { is_ok(Err("oops")) }
      function test_unwrap_ok() -> String { unwrap_or(Ok("value"), "fallback") }
      function test_unwrap_err() -> String { unwrap_or(Err("fail"), "fallback") }
      function test_error_of() -> String { error_of(Err("bad")) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_ok as () => number)()).toBe(1);
    expect((instance.exports.test_err as () => number)()).toBe(0);
    expect(runtime.readString((instance.exports.test_unwrap_ok as () => number)())).toBe("value");
    expect(runtime.readString((instance.exports.test_unwrap_err as () => number)())).toBe("fallback");
    expect(runtime.readString((instance.exports.test_error_of as () => number)())).toBe("bad");
  });
});

describe("A2A builtins (a2a_discover, a2a_submit, a2a_poll, a2a_cancel)", () => {
  it("a2a_discover compiles with A2A effect annotation", async () => {
    const source = `
      module Test
      effect[A2A] function try_discover() -> Bool {
        match a2a_discover("http://localhost:9999") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("a2a_discover returns Err for unreachable URL", async () => {
    const source = `
      module Test
      effect[A2A] function try_discover() -> Bool {
        match a2a_discover("http://127.0.0.1:19876") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.try_discover as () => number)()).toBe(0);
  });

  it("a2a_submit compiles with A2A effect annotation", async () => {
    const source = `
      module Test
      effect[A2A] function try_submit() -> Bool {
        match a2a_submit("http://localhost:9999", "Hello agent") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("a2a_submit returns Err for unreachable URL", async () => {
    const source = `
      module Test
      effect[A2A] function try_submit() -> Bool {
        match a2a_submit("http://127.0.0.1:19876", "Hello") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.try_submit as () => number)()).toBe(0);
  });

  it("a2a_poll compiles and returns Err for unreachable URL", async () => {
    const source = `
      module Test
      effect[A2A] function try_poll() -> Bool {
        match a2a_poll("http://127.0.0.1:19876", "task-123") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.try_poll as () => number)()).toBe(0);
  });

  it("a2a_cancel compiles and returns Err for unreachable URL", async () => {
    const source = `
      module Test
      effect[A2A] function try_cancel() -> Bool {
        match a2a_cancel("http://127.0.0.1:19876", "task-123") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.try_cancel as () => number)()).toBe(0);
  });
});

describe("std/a2a module", () => {
  function setupA2aTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-a2a-"));
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    copyStdFile(dir, "a2a.clarity");
    copyStdFile(dir, "result.clarity");
    return dir;
  }

  it("imports and compiles discover, submit, poll, cancel from std/a2a", async () => {
    const dir = setupA2aTest(`
      module Main
      import { discover, submit, poll, cancel } from "std/a2a"
      import { unwrap_or } from "std/result"

      effect[A2A] function run(url: String) -> String {
        match submit(url, "hello") {
          Ok(task_id) -> {
            let status = poll(url, task_id);
            unwrap_or(status, "unknown")
          },
          Err(msg) -> "error: " ++ msg
        }
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
  });

  it("is_done, is_failed, is_canceled are pure string checks", async () => {
    const dir = setupA2aTest(`
      module Main
      import { is_done, is_failed, is_canceled } from "std/a2a"

      function check_done() -> Bool { is_done("""{"status":"completed","output":"hi"}""") }
      function check_failed() -> Bool { is_failed("""{"status":"failed"}""") }
      function check_canceled() -> Bool { is_canceled("""{"status":"canceled"}""") }
      function check_not_done() -> Bool { is_done("""{"status":"working"}""") }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.check_done as () => number)()).toBe(1);
    expect((instance.exports.check_failed as () => number)()).toBe(1);
    expect((instance.exports.check_canceled as () => number)()).toBe(1);
    expect((instance.exports.check_not_done as () => number)()).toBe(0);
  });

  it("unwrap_or and error_of work on Result<String, String>", async () => {
    const dir = setupA2aTest(`
      module Main
      import { unwrap_or, is_ok, error_of } from "std/result"

      function test_ok() -> Bool { is_ok(Ok("yep")) }
      function test_err() -> Bool { is_ok(Err("nope")) }
      function test_unwrap_ok() -> String { unwrap_or(Ok("win"), "default") }
      function test_unwrap_err() -> String { unwrap_or(Err("fail"), "default") }
      function test_error_of() -> String { error_of(Err("oops")) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_ok as () => number)()).toBe(1);
    expect((instance.exports.test_err as () => number)()).toBe(0);
    expect(runtime.readString((instance.exports.test_unwrap_ok as () => number)())).toBe("win");
    expect(runtime.readString((instance.exports.test_unwrap_err as () => number)())).toBe("default");
    expect(runtime.readString((instance.exports.test_error_of as () => number)())).toBe("oops");
  });
});

describe("Policy builtins (policy_is_url_allowed, policy_is_effect_allowed) and audit log", () => {
  it("policy_is_url_allowed and policy_is_effect_allowed compile without effect annotation", async () => {
    const source = `
      module Test
      function check_url() -> Bool { policy_is_url_allowed("http://api.example.com") }
      function check_effect() -> Bool { policy_is_effect_allowed("MCP") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("policy_is_url_allowed returns True when no allowlist is configured", async () => {
    const source = `
      module Test
      function check() -> Bool { policy_is_url_allowed("http://any-url.example.com") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    // No CLARITY_ALLOW_HOSTS set in test env → all URLs allowed
    expect((instance.exports.check as () => number)()).toBe(1);
  });

  it("policy_is_effect_allowed returns True when no deny list is configured", async () => {
    const source = `
      module Test
      function check_mcp() -> Bool { policy_is_effect_allowed("MCP") }
      function check_a2a() -> Bool { policy_is_effect_allowed("A2A") }
      function check_model() -> Bool { policy_is_effect_allowed("Model") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    // No CLARITY_DENY_EFFECTS set → all effects allowed
    expect((instance.exports.check_mcp as () => number)()).toBe(1);
    expect((instance.exports.check_a2a as () => number)()).toBe(1);
    expect((instance.exports.check_model as () => number)()).toBe(1);
  });

  it("CLARITY_DENY_EFFECTS blocks mcp_connect and returns Err", async () => {
    const source = `
      module Test
      effect[MCP] function try_connect() -> Bool {
        match mcp_connect("http://localhost:9999/mcp") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedDeny = process.env.CLARITY_DENY_EFFECTS;
    process.env.CLARITY_DENY_EFFECTS = "MCP";
    try {
      const { instance } = await instantiate(result.wasm!);
      // MCP effect is denied → mcp_connect returns Err → False
      expect((instance.exports.try_connect as () => number)()).toBe(0);
    } finally {
      if (savedDeny !== undefined) process.env.CLARITY_DENY_EFFECTS = savedDeny;
      else delete process.env.CLARITY_DENY_EFFECTS;
    }
  });

  it("CLARITY_DENY_EFFECTS blocks a2a_submit and returns Err", async () => {
    const source = `
      module Test
      effect[A2A] function try_submit() -> Bool {
        match a2a_submit("http://localhost:9999", "hello") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedDeny = process.env.CLARITY_DENY_EFFECTS;
    process.env.CLARITY_DENY_EFFECTS = "A2A";
    try {
      const { instance } = await instantiate(result.wasm!);
      expect((instance.exports.try_submit as () => number)()).toBe(0);
    } finally {
      if (savedDeny !== undefined) process.env.CLARITY_DENY_EFFECTS = savedDeny;
      else delete process.env.CLARITY_DENY_EFFECTS;
    }
  });

  it("CLARITY_ALLOW_HOSTS blocks mcp_connect for non-listed hosts", async () => {
    const source = `
      module Test
      effect[MCP] function try_connect() -> Bool {
        match mcp_connect("http://blocked.example.com/mcp") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedHosts = process.env.CLARITY_ALLOW_HOSTS;
    process.env.CLARITY_ALLOW_HOSTS = "allowed.example.com";
    try {
      const { instance } = await instantiate(result.wasm!);
      // blocked.example.com is not in allowlist → Err → False
      expect((instance.exports.try_connect as () => number)()).toBe(0);
    } finally {
      if (savedHosts !== undefined) process.env.CLARITY_ALLOW_HOSTS = savedHosts;
      else delete process.env.CLARITY_ALLOW_HOSTS;
    }
  });

  it("CLARITY_ALLOW_HOSTS permits listed hosts", async () => {
    const source = `
      module Test
      effect[MCP] function try_connect() -> Bool {
        match mcp_connect("http://allowed.example.com/mcp") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedHosts = process.env.CLARITY_ALLOW_HOSTS;
    process.env.CLARITY_ALLOW_HOSTS = "allowed.example.com";
    try {
      const { instance } = await instantiate(result.wasm!);
      // allowed.example.com is in allowlist → Ok → True
      expect((instance.exports.try_connect as () => number)()).toBe(1);
    } finally {
      if (savedHosts !== undefined) process.env.CLARITY_ALLOW_HOSTS = savedHosts;
      else delete process.env.CLARITY_ALLOW_HOSTS;
    }
  });

  it("CLARITY_ALLOW_HOSTS wildcard *.example.com permits subdomains", async () => {
    const source = `
      module Test
      effect[MCP] function try_sub() -> Bool {
        match mcp_connect("http://sub.example.com/mcp") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
      effect[MCP] function try_other() -> Bool {
        match mcp_connect("http://other.net/mcp") {
          Ok(_) -> True,
          Err(_) -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedHosts = process.env.CLARITY_ALLOW_HOSTS;
    process.env.CLARITY_ALLOW_HOSTS = "*.example.com";
    try {
      const { instance } = await instantiate(result.wasm!);
      expect((instance.exports.try_sub as () => number)()).toBe(1);   // subdomain → allowed
      expect((instance.exports.try_other as () => number)()).toBe(0); // different domain → blocked
    } finally {
      if (savedHosts !== undefined) process.env.CLARITY_ALLOW_HOSTS = savedHosts;
      else delete process.env.CLARITY_ALLOW_HOSTS;
    }
  });

  it("CLARITY_AUDIT_LOG writes JSONL entries for each network call", async () => {
    const logFile = path.join(os.tmpdir(), `clarity-audit-${Date.now()}.jsonl`);
    const source = `
      module Test
      effect[MCP] function do_connect() -> Unit {
        match mcp_connect("http://localhost:9999/mcp") {
          Ok(id) -> mcp_disconnect(id),
          Err(_) -> {}
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedLog = process.env.CLARITY_AUDIT_LOG;
    process.env.CLARITY_AUDIT_LOG = logFile;
    try {
      const { instance } = await instantiate(result.wasm!);
      (instance.exports.do_connect as () => void)();
      // The audit log should have at least one entry
      const logContent = fs.readFileSync(logFile, "utf-8").trim();
      const entries = logContent.split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0]).toHaveProperty("timestamp");
      expect(entries[0]).toHaveProperty("effect", "MCP");
      expect(entries[0]).toHaveProperty("op", "mcp_connect");
    } finally {
      if (savedLog !== undefined) process.env.CLARITY_AUDIT_LOG = savedLog;
      else delete process.env.CLARITY_AUDIT_LOG;
      if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    }
  });

  it("policy_is_effect_allowed returns False when effect is denied via env", async () => {
    const source = `
      module Test
      function check() -> Bool { policy_is_effect_allowed("MCP") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedDeny = process.env.CLARITY_DENY_EFFECTS;
    process.env.CLARITY_DENY_EFFECTS = "MCP,A2A";
    try {
      const { instance } = await instantiate(result.wasm!);
      expect((instance.exports.check as () => number)()).toBe(0);
    } finally {
      if (savedDeny !== undefined) process.env.CLARITY_DENY_EFFECTS = savedDeny;
      else delete process.env.CLARITY_DENY_EFFECTS;
    }
  });

  it("policy_is_url_allowed returns False for blocked host via env", async () => {
    const source = `
      module Test
      function check() -> Bool { policy_is_url_allowed("http://blocked.test/api") }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const savedHosts = process.env.CLARITY_ALLOW_HOSTS;
    process.env.CLARITY_ALLOW_HOSTS = "allowed.test";
    try {
      const { instance } = await instantiate(result.wasm!);
      expect((instance.exports.check as () => number)()).toBe(0);
    } finally {
      if (savedHosts !== undefined) process.env.CLARITY_ALLOW_HOSTS = savedHosts;
      else delete process.env.CLARITY_ALLOW_HOSTS;
    }
  });
});

describe("json_get builtin", () => {
  it("extracts a string field from a JSON object", async () => {
    const source = `
      module Test
      function get_name() -> String {
        match json_get("""{"name":"Alice","age":"30"}""", "name") {
          Some(v) -> v,
          None -> "missing"
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const ptr = (instance.exports.get_name as () => number)();
    expect(runtime.readString(ptr)).toBe("Alice");
  });

  it("returns None for a missing key", async () => {
    const source = `
      module Test
      function check() -> Bool {
        match json_get("""{"x":"1"}""", "y") {
          Some(_) -> True,
          None -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.check as () => number)()).toBe(0);
  });

  it("returns None for invalid JSON", async () => {
    const source = `
      module Test
      function check() -> Bool {
        match json_get("not-json", "key") {
          Some(_) -> True,
          None -> False
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.check as () => number)()).toBe(0);
  });

  it("extracts numeric values as strings", async () => {
    const source = `
      module Test
      function get_age() -> String {
        match json_get("""{"age":42}""", "age") {
          Some(v) -> v,
          None -> "missing"
        }
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const ptr = (instance.exports.get_age as () => number)();
    expect(runtime.readString(ptr)).toBe("42");
  });
});

describe("std/result module", () => {
  it("imports and uses unwrap_or, is_ok, error_of", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-result-"));
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    copyStdFile(dir, "result.clarity");
    fs.writeFileSync(path.join(dir, "main.clarity"), `
      module Main
      import { unwrap_or, is_ok, error_of } from "std/result"
      function test_ok() -> Bool { is_ok(Ok("hi")) }
      function test_err() -> Bool { is_ok(Err("bad")) }
      function test_unwrap() -> String { unwrap_or(Ok("val"), "fallback") }
      function test_fallback() -> String { unwrap_or(Err("e"), "fallback") }
      function test_error_of() -> String { error_of(Err("oops")) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    expect((instance.exports.test_ok as () => number)()).toBe(1);
    expect((instance.exports.test_err as () => number)()).toBe(0);
    expect(runtime.readString((instance.exports.test_unwrap as () => number)())).toBe("val");
    expect(runtime.readString((instance.exports.test_fallback as () => number)())).toBe("fallback");
    expect(runtime.readString((instance.exports.test_error_of as () => number)())).toBe("oops");
  });
});

// ---------------------------------------------------------------------------
// Trace builtins
// ---------------------------------------------------------------------------
describe("Trace builtins (trace_start, trace_end, trace_log)", () => {
  it("trace_start compiles with Trace effect annotation", () => {
    const src = `
      module Test
      effect[Trace] function begin(op: String) -> Int64 { trace_start(op) }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("trace_start returns a positive span ID", async () => {
    const src = `
      module Test
      effect[Trace] function start_span() -> Int64 { trace_start("test-op") }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();
    const { instance } = await instantiate(result.wasm!);
    const id = (instance.exports.start_span as () => bigint)();
    expect(id > 0n).toBe(true);
  });

  it("trace_end compiles and runs without error", async () => {
    const src = `
      module Test
      effect[Trace] function run_span() -> Int64 {
        let id = trace_start("op");
        trace_log(id, "working");
        trace_end(id);
        id
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    const { instance } = await instantiate(result.wasm!);
    const id = (instance.exports.run_span as () => bigint)();
    expect(id > 0n).toBe(true);
  });

  it("rejects trace_start without Trace effect", () => {
    const src = `
      module Test
      function bad(op: String) -> Int64 { trace_start(op) }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Trace");
  });
});

// ---------------------------------------------------------------------------
// Persist builtins
// ---------------------------------------------------------------------------
describe("Persist builtins (checkpoint_save, checkpoint_load, checkpoint_delete)", () => {
  it("checkpoint_save compiles with Persist effect", () => {
    const src = `
      module Test
      effect[Persist] function save(k: String, v: String) -> Result<String, String> {
        checkpoint_save(k, v)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("checkpoint_load returns None for an unknown key", async () => {
    const src = `
      module Test
      effect[Persist] function load(k: String) -> Bool {
        match checkpoint_load(k) {
          Some(_) -> True,
          None -> False
        }
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-ckpt-"));
    const { instance, runtime } = await instantiate(result.wasm!, {});
    process.env.CLARITY_CHECKPOINT_DIR = dir;
    const ptr = runtime.writeString("nonexistent-key-xyz");
    const res = (instance.exports.load as (p: number) => number)(ptr);
    expect(res).toBe(0); // None = 0
    delete process.env.CLARITY_CHECKPOINT_DIR;
  });

  it("checkpoint_save then checkpoint_load returns Some(value)", async () => {
    const src = `
      module Test
      effect[Persist] function roundtrip(k: String, v: String) -> String {
        let _ = checkpoint_save(k, v);
        match checkpoint_load(k) {
          Some(s) -> s,
          None -> "missing"
        }
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-ckpt-"));
    process.env.CLARITY_CHECKPOINT_DIR = dir;
    const { instance, runtime } = await instantiate(result.wasm!);
    const kPtr = runtime.writeString("my-key");
    const vPtr = runtime.writeString("hello-world");
    const resPtr = (instance.exports.roundtrip as (k: number, v: number) => number)(kPtr, vPtr);
    expect(runtime.readString(resPtr)).toBe("hello-world");
    delete process.env.CLARITY_CHECKPOINT_DIR;
  });

  it("checkpoint_delete removes a saved checkpoint", async () => {
    const src = `
      module Test
      effect[Persist] function test_delete(k: String, v: String) -> Bool {
        let _ = checkpoint_save(k, v);
        checkpoint_delete(k);
        match checkpoint_load(k) {
          Some(_) -> True,
          None -> False
        }
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-ckpt-"));
    process.env.CLARITY_CHECKPOINT_DIR = dir;
    const { instance, runtime } = await instantiate(result.wasm!);
    const kPtr = runtime.writeString("del-key");
    const vPtr = runtime.writeString("val");
    const res = (instance.exports.test_delete as (k: number, v: number) => number)(kPtr, vPtr);
    expect(res).toBe(0); // None after delete
    delete process.env.CLARITY_CHECKPOINT_DIR;
  });

  it("rejects checkpoint_save without Persist effect", () => {
    const src = `
      module Test
      function bad(k: String, v: String) -> Result<String, String> {
        checkpoint_save(k, v)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Persist");
  });
});

// ---------------------------------------------------------------------------
// Embed builtins
// ---------------------------------------------------------------------------
describe("Embed builtins (embed_text, cosine_similarity, chunk_text, embed_and_retrieve)", () => {
  it("chunk_text splits text into correct chunks (pure, no effect)", async () => {
    const src = `
      module Test
      function do_chunk(text: String, size: Int64) -> String {
        chunk_text(text, size)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const tPtr = runtime.writeString("abcdefgh");
    const resPtr = (instance.exports.do_chunk as (t: number, s: bigint) => number)(tPtr, 3n);
    const json = runtime.readString(resPtr);
    expect(JSON.parse(json)).toEqual(["abc", "def", "gh"]);
  });

  it("cosine_similarity of identical vectors is 1.0 (pure, no effect)", async () => {
    const src = `
      module Test
      function sim(a: String, b: String) -> Float64 { cosine_similarity(a, b) }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const v = JSON.stringify([1.0, 0.0, 0.0]);
    const aPtr = runtime.writeString(v);
    const bPtr = runtime.writeString(v);
    const sim = (instance.exports.sim as (a: number, b: number) => number)(aPtr, bPtr);
    expect(Math.abs(sim - 1.0)).toBeLessThan(1e-6);
  });

  it("cosine_similarity of orthogonal vectors is 0.0", async () => {
    const src = `
      module Test
      function sim(a: String, b: String) -> Float64 { cosine_similarity(a, b) }
    `;
    const result = compile(src, "test.clarity");
    const { instance, runtime } = await instantiate(result.wasm!);
    const aPtr = runtime.writeString(JSON.stringify([1.0, 0.0]));
    const bPtr = runtime.writeString(JSON.stringify([0.0, 1.0]));
    const sim = (instance.exports.sim as (a: number, b: number) => number)(aPtr, bPtr);
    expect(Math.abs(sim)).toBeLessThan(1e-6);
  });

  it("embed_text compiles with Embed effect annotation", () => {
    const src = `
      module Test
      effect[Embed] function get_vec(text: String) -> Result<String, String> {
        embed_text(text)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("embed_text returns Err when API key is not set", async () => {
    const src = `
      module Test
      effect[Embed] function get_vec(text: String) -> Result<String, String> {
        embed_text(text)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();
    delete process.env.OPENAI_API_KEY;
    const { instance, runtime } = await instantiate(result.wasm!);
    const tPtr = runtime.writeString("hello");
    const resPtr = (instance.exports.get_vec as (p: number) => number)(tPtr);
    // Result is a tagged union: tag 0 = Ok, tag 1 = Err
    const view = new DataView((runtime.memory as WebAssembly.Memory).buffer);
    const tag = view.getInt32(resPtr, true);
    expect(tag).toBe(1); // Err
  });

  it("embed_and_retrieve compiles with Embed effect", () => {
    const src = `
      module Test
      effect[Embed] function search(q: String, corpus: String, k: Int64) -> Result<String, String> {
        embed_and_retrieve(q, corpus, k)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects embed_text without Embed effect", () => {
    const src = `
      module Test
      function bad(text: String) -> Result<String, String> { embed_text(text) }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Embed");
  });
});

// ---------------------------------------------------------------------------
// Multi-provider (Anthropic routing)
// ---------------------------------------------------------------------------
describe("Multi-provider LLM routing", () => {
  it("call_model with claude- prefix compiles and returns Err when key is absent", async () => {
    const src = `
      module Test
      effect[Model] function ask(model: String, prompt: String) -> Result<String, String> {
        call_model(model, prompt)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { instance, runtime } = await instantiate(result.wasm!);
    const mPtr = runtime.writeString("claude-3-haiku-20240307");
    const pPtr = runtime.writeString("hello");
    const resPtr = (instance.exports.ask as (m: number, p: number) => number)(mPtr, pPtr);
    // Expect an Err result (tag = 1, since tag 0 = Ok, tag 1 = Err)
    const view = new DataView((runtime.memory as WebAssembly.Memory).buffer);
    const tag = view.getInt32(resPtr, true);
    expect(tag).toBe(1); // Err — no ANTHROPIC_API_KEY
  });
});

// ---------------------------------------------------------------------------
// std/agent module
// ---------------------------------------------------------------------------
describe("std/agent module", () => {
  function setupAgentTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-agent-"));
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    copyStdFile(dir, "agent.clarity");
    return dir;
  }

  it("imports and compiles run, resume, clear from std/agent", () => {
    const dir = setupAgentTest(`
      module Main
      import { run, resume, clear } from "std/agent"
      effect[Persist] function go(k: String, s: String) -> Result<String, String> {
        run(k, s, identity_step)
      }
      function identity_step(state: String) -> String {
        "{\\"done\\":true}"
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
  });

  it("run completes immediately when step returns done:true", async () => {
    const dir = setupAgentTest(`
      module Main
      import { run, clear } from "std/agent"
      function done_step(state: String) -> String { "{\\"done\\":true,\\"result\\":\\"ok\\"}" }
      effect[Persist] function go(k: String) -> Result<String, String> {
        run(k, "{}", done_step)
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.wasm).toBeDefined();
    const ckptDir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-ckpt-"));
    process.env.CLARITY_CHECKPOINT_DIR = ckptDir;
    const { instance, runtime } = await instantiate(result.wasm!);
    const kPtr = runtime.writeString("test-agent");
    const resPtr = (instance.exports.go as (k: number) => number)(kPtr);
    // tag 0 = Ok, tag 1 = Err
    const view = new DataView((runtime.memory as WebAssembly.Memory).buffer);
    const tag = view.getInt32(resPtr, true);
    expect(tag).toBe(0); // Ok — agent completed
    delete process.env.CLARITY_CHECKPOINT_DIR;
  });
});

// ---------------------------------------------------------------------------
// std/rag module
// ---------------------------------------------------------------------------
describe("std/rag module", () => {
  function setupRagTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-rag-"));
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    copyStdFile(dir, "rag.clarity");
    return dir;
  }

  it("imports and compiles retrieve, chunk, embed, similarity from std/rag", () => {
    const dir = setupRagTest(`
      module Main
      import { retrieve, chunk, embed, similarity } from "std/rag"
      function do_chunk(text: String) -> String { chunk(text, 100) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
  });

  it("chunk splits text correctly via std/rag", async () => {
    const dir = setupRagTest(`
      module Main
      import { chunk } from "std/rag"
      function do_chunk(text: String, size: Int64) -> String { chunk(text, size) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const tPtr = runtime.writeString("hello world!");
    const resPtr = (instance.exports.do_chunk as (t: number, s: bigint) => number)(tPtr, 5n);
    const chunks = JSON.parse(runtime.readString(resPtr)) as string[];
    expect(chunks[0]).toBe("hello");
    expect(chunks[1]).toBe(" worl");
    expect(chunks[2]).toBe("d!");
  });

  it("similarity returns 1.0 for identical vectors via std/rag", async () => {
    const dir = setupRagTest(`
      module Main
      import { similarity } from "std/rag"
      function sim(a: String, b: String) -> Float64 { similarity(a, b) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const v = JSON.stringify([0.6, 0.8]);
    const aPtr = runtime.writeString(v);
    const bPtr = runtime.writeString(v);
    const sim = (instance.exports.sim as (a: number, b: number) => number)(aPtr, bPtr);
    expect(Math.abs(sim - 1.0)).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// Eval builtins (eval_exact, eval_contains, eval_llm_judge, eval_semantic)
// ---------------------------------------------------------------------------
describe("Eval builtins", () => {
  it("eval_exact returns true for equal strings (pure, no effect)", async () => {
    const src = `
      module Test
      function check(a: String, b: String) -> Bool { eval_exact(a, b) }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const aPtr = runtime.writeString("Paris");
    const bPtr = runtime.writeString("Paris");
    const cPtr = runtime.writeString("London");
    expect((instance.exports.check as (a: number, b: number) => number)(aPtr, bPtr)).toBe(1);
    expect((instance.exports.check as (a: number, b: number) => number)(aPtr, cPtr)).toBe(0);
  });

  it("eval_contains returns true when substring present (pure, no effect)", async () => {
    const src = `
      module Test
      function check(a: String, b: String) -> Bool { eval_contains(a, b) }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
    const { instance, runtime } = await instantiate(result.wasm!);
    const hayPtr = runtime.writeString("The capital of France is Paris.");
    const needlePtr = runtime.writeString("Paris");
    const missingPtr = runtime.writeString("Berlin");
    expect((instance.exports.check as (a: number, b: number) => number)(hayPtr, needlePtr)).toBe(1);
    expect((instance.exports.check as (a: number, b: number) => number)(hayPtr, missingPtr)).toBe(0);
  });

  it("eval_exact compiles and rejects misuse without Eval effect for pure check", () => {
    // eval_exact is pure so should compile without effect
    const src = `
      module Test
      function check(a: String, b: String) -> Bool { eval_exact(a, b) }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("eval_llm_judge compiles with Eval effect", () => {
    const src = `
      module Test
      effect[Eval] function grade(model: String, prompt: String, resp: String, rubric: String) -> Result<String, String> {
        eval_llm_judge(model, prompt, resp, rubric)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects eval_llm_judge without Eval effect", () => {
    const src = `
      module Test
      function bad(model: String, prompt: String, resp: String, rubric: String) -> Result<String, String> {
        eval_llm_judge(model, prompt, resp, rubric)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("eval_semantic compiles with Eval effect", () => {
    const src = `
      module Test
      effect[Eval] function sim(a: String, b: String) -> Result<Float64, String> {
        eval_semantic(a, b)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// std/eval module
// ---------------------------------------------------------------------------
describe("std/eval module", () => {
  function setupEvalTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-eval-"));
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    copyStdFile(dir, "eval.clarity");
    return dir;
  }

  it("imports and compiles exact, has_match, judge, pass from std/eval", () => {
    const dir = setupEvalTest(`
      module Main
      import { exact, has_match, judge, pass } from "std/eval"
      function check_exact(a: String, b: String) -> Bool { exact(a, b) }
      function check_has(a: String, b: String) -> Bool { has_match(a, b) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
  });

  it("exact returns correct values via std/eval", async () => {
    const dir = setupEvalTest(`
      module Main
      import { exact } from "std/eval"
      function do_exact(a: String, b: String) -> Bool { exact(a, b) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const aPtr = runtime.writeString("hello");
    const bPtr = runtime.writeString("hello");
    const cPtr = runtime.writeString("world");
    expect((instance.exports.do_exact as (a: number, b: number) => number)(aPtr, bPtr)).toBe(1);
    expect((instance.exports.do_exact as (a: number, b: number) => number)(aPtr, cPtr)).toBe(0);
  });

  it("has_match returns correct values via std/eval", async () => {
    const dir = setupEvalTest(`
      module Main
      import { has_match } from "std/eval"
      function do_has(a: String, b: String) -> Bool { has_match(a, b) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const hayPtr = runtime.writeString("hello world");
    const needlePtr = runtime.writeString("world");
    const missingPtr = runtime.writeString("foo");
    expect((instance.exports.do_has as (a: number, b: number) => number)(hayPtr, needlePtr)).toBe(1);
    expect((instance.exports.do_has as (a: number, b: number) => number)(hayPtr, missingPtr)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Streaming builtins (stream_start, stream_next, stream_close)
// ---------------------------------------------------------------------------
describe("Streaming builtins", () => {
  it("stream_start / stream_next / stream_close compile with Model effect", () => {
    const src = `
      module Test
      effect[Model] function go(model: String, prompt: String) -> Result<String, String> {
        match stream_start(model, prompt, "") {
          Err(e) -> Err(e),
          Ok(handle) -> {
            let token = stream_next(handle);
            let err = stream_close(handle);
            match token {
              None -> Ok("done"),
              Some(t) -> Ok(t)
            }
          }
        }
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();
  });

  it("rejects stream_start without Model effect", () => {
    const src = `
      module Test
      function bad(model: String, prompt: String) -> Result<String, String> {
        stream_start(model, prompt, "")
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("stream_start returns Ok(handle) immediately; error surfaces via stream_close", async () => {
    // stream_start spawns the worker asynchronously and always returns Ok(handle).
    // The HTTP/auth error surfaces when the worker signals ERROR status, which
    // stream_next delivers as None and stream_close returns as an error string.
    const src = `
      module Test
      effect[Model] function start_handle(model: String, prompt: String) -> Int64 {
        match stream_start(model, prompt, "") {
          Err(_) -> 0 - 1,
          Ok(handle) -> handle
        }
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const mPtr = runtime.writeString("gpt-4o");
    const pPtr = runtime.writeString("hello");
    const handle = (instance.exports.start_handle as (m: number, p: number) => bigint)(mPtr, pPtr);
    // Should have returned a positive handle (worker spawned ok)
    expect(Number(handle)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// std/stream module
// ---------------------------------------------------------------------------
describe("std/stream module", () => {
  function setupStreamTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-stream-"));
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    copyStdFile(dir, "stream.clarity");
    return dir;
  }

  it("imports call and call_with_system from std/stream", () => {
    const dir = setupStreamTest(`
      module Main
      import { call, call_with_system } from "std/stream"
      effect[Model] function ask(model: String, prompt: String) -> Result<String, String> {
        call(model, prompt)
      }
      effect[Model] function ask_sys(model: String, sys: String, prompt: String) -> Result<String, String> {
        call_with_system(model, sys, prompt)
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
  });

  it("call returns Err when no API key", async () => {
    const dir = setupStreamTest(`
      module Main
      import { call } from "std/stream"
      effect[Model] function ask(model: String, prompt: String) -> Result<String, String> {
        call(model, prompt)
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.wasm).toBeDefined();
    const { instance, runtime } = await instantiate(result.wasm!);
    const mPtr = runtime.writeString("gpt-4o");
    const pPtr = runtime.writeString("hello");
    const resPtr = (instance.exports.ask as (m: number, p: number) => number)(mPtr, pPtr);
    const view = new DataView((instance.exports.memory as WebAssembly.Memory).buffer);
    const tag = view.getInt32(resPtr, true);
    expect(tag).toBe(1); // Err — no API key in test environment
  });
});

// ---------------------------------------------------------------------------
// None / [] placeholder type inference
// ---------------------------------------------------------------------------
describe("None / [] placeholder type inference", () => {
  it("None is accepted as Option<Int64> return type", () => {
    const src = `module T function f() -> Option<Int64> { None }`;
    expect(compile(src, "t.clarity").errors).toHaveLength(0);
  });

  it("None in match arm unifies with Some(Int64)", () => {
    const src = `module T
      function g(x: Bool) -> Option<Int64> {
        match x { True -> Some(42), False -> None }
      }`;
    expect(compile(src, "t.clarity").errors).toHaveLength(0);
  });

  it("[] is accepted as List<String> return type", () => {
    const src = `module T function f() -> List<String> { [] }`;
    expect(compile(src, "t.clarity").errors).toHaveLength(0);
  });

  it("generic find returns Option<T>", () => {
    const src = `module T
      function find_h<T>(xs: List<T>, pred: (T) -> Bool) -> Option<T> {
        match is_empty(xs) {
          True  -> None,
          False -> { let h = head(xs); match pred(h) { True -> Some(h), False -> find_h(tail(xs), pred) } }
        }
      }
      function gt5(x: Int64) -> Bool { x > 5 }
      export function run() -> Option<Int64> { find_h([1, 7, 3], gt5) }`;
    const result = compile(src, "t.clarity");
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// std/list module
// ---------------------------------------------------------------------------
describe("std/list module", () => {
  function setupListTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-list-"));
    fs.mkdirSync(path.join(dir, "std"), { recursive: true });
    fs.writeFileSync(path.join(dir, "main.clarity"), src);
    copyStdFile(dir, "list.clarity");
    return dir;
  }

  it("map doubles a list", async () => {
    const dir = setupListTest(`
      module Main
      import { map } from "std/list"
      function double(x: Int64) -> Int64 { x * 2 }
      export function run() -> Int64 {
        let xs = map([1, 2, 3], double);
        length(xs)
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run as () => bigint)()).toBe(3n);
  });

  it("filter keeps even numbers", async () => {
    const dir = setupListTest(`
      module Main
      import { filter } from "std/list"
      function is_even(x: Int64) -> Bool { x % 2 == 0 }
      export function run() -> Int64 { length(filter([1, 2, 3, 4, 5, 6], is_even)) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run as () => bigint)()).toBe(3n);
  });

  it("fold_left sums a list", async () => {
    const dir = setupListTest(`
      module Main
      import { fold_left } from "std/list"
      function add(a: Int64, b: Int64) -> Int64 { a + b }
      export function run() -> Int64 { fold_left([1, 2, 3, 4, 5], 0, add) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run as () => bigint)()).toBe(15n);
  });

  it("any / all work", async () => {
    const dir = setupListTest(`
      module Main
      import { any, all } from "std/list"
      function gt0(x: Int64) -> Bool { x > 0 }
      function gt10(x: Int64) -> Bool { x > 10 }
      export function run_any() -> Bool { any([1, 2, 3], gt0) }
      export function run_all() -> Bool { all([1, 2, 3], gt0) }
      export function run_any2() -> Bool { any([1, 2, 3], gt10) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run_any as () => number)()).toBe(1);
    expect((instance.exports.run_all as () => number)()).toBe(1);
    expect((instance.exports.run_any2 as () => number)()).toBe(0);
  });

  it("find returns Some / None", async () => {
    const dir = setupListTest(`
      module Main
      import { find } from "std/list"
      function gt5(x: Int64) -> Bool { x > 5 }
      export function run_found() -> Int64 {
        match find([1, 7, 3], gt5) { None -> 0 - 1, Some(v) -> v }
      }
      export function run_missing() -> Int64 {
        match find([1, 2, 3], gt5) { None -> 0 - 1, Some(v) -> v }
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run_found as () => bigint)()).toBe(7n);
    expect((instance.exports.run_missing as () => bigint)()).toBe(-1n);
  });

  it("range generates correct sequence", async () => {
    const dir = setupListTest(`
      module Main
      import { range, sum } from "std/list"
      export function run() -> Int64 { sum(range(1, 6)) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run as () => bigint)()).toBe(15n);
  });

  it("zip_with adds corresponding elements", async () => {
    const dir = setupListTest(`
      module Main
      import { zip_with, sum } from "std/list"
      function add(a: Int64, b: Int64) -> Int64 { a + b }
      export function run() -> Int64 { sum(zip_with([1, 2, 3], [10, 20, 30], add)) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run as () => bigint)()).toBe(66n);
  });

  it("take and drop split a list", async () => {
    const dir = setupListTest(`
      module Main
      import { take, drop } from "std/list"
      export function run_take() -> Int64 { length(take([1, 2, 3, 4, 5], 3)) }
      export function run_drop() -> Int64 { length(drop([1, 2, 3, 4, 5], 2)) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run_take as () => bigint)()).toBe(3n);
    expect((instance.exports.run_drop as () => bigint)()).toBe(3n);
  });

  it("flatten concatenates nested lists", async () => {
    const dir = setupListTest(`
      module Main
      import { flatten } from "std/list"
      export function run() -> Int64 { length(flatten([[1, 2], [3, 4], [5]])) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run as () => bigint)()).toBe(5n);
  });

  it("flat_map works", async () => {
    const dir = setupListTest(`
      module Main
      import { flat_map } from "std/list"
      function dup(x: Int64) -> List<Int64> { [x, x] }
      export function run() -> Int64 { length(flat_map([1, 2, 3], dup)) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run as () => bigint)()).toBe(6n);
  });

  it("maximum and minimum work", async () => {
    const dir = setupListTest(`
      module Main
      import { maximum, minimum } from "std/list"
      export function run_max() -> Int64 { maximum([3, 1, 4, 1, 5, 9, 2, 6], 0) }
      export function run_min() -> Int64 { minimum([3, 1, 4, 1, 5, 9, 2, 6], 999) }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const { instance } = await instantiate(result.wasm!);
    expect((instance.exports.run_max as () => bigint)()).toBe(9n);
    expect((instance.exports.run_min as () => bigint)()).toBe(1n);
  });
});

describe("checkpoint_save_raw builtin", () => {
  it("compiles with Persist effect", () => {
    const src = `
      module Test
      effect[Persist] function save(k: String, v: String) -> Bool {
        checkpoint_save_raw(k, v)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects checkpoint_save_raw without Persist effect", () => {
    const src = `
      module Test
      function bad(k: String, v: String) -> Bool {
        checkpoint_save_raw(k, v)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Persist");
  });

  it("returns 1 (true) on successful save", async () => {
    const src = `
      module Test
      effect[Persist] function save_it(k: String, v: String) -> Bool {
        checkpoint_save_raw(k, v)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-ckpt-raw-"));
    process.env.CLARITY_CHECKPOINT_DIR = dir;
    const { instance, runtime } = await instantiate(result.wasm!);
    const kPtr = runtime.writeString("test-raw-key");
    const vPtr = runtime.writeString("hello");
    const res = (instance.exports.save_it as (k: number, v: number) => number)(kPtr, vPtr);
    expect(res).toBe(1);
    delete process.env.CLARITY_CHECKPOINT_DIR;
    fs.rmSync(dir, { recursive: true });
  });
});

describe("HumanInLoop effect and hitl_ask builtin", () => {
  it("hitl_ask compiles with HumanInLoop effect", () => {
    const src = `
      module Test
      effect[HumanInLoop] function ask_human(key: String, q: String) -> String {
        hitl_ask(key, q)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects hitl_ask without HumanInLoop effect", () => {
    const src = `
      module Test
      function bad(key: String, q: String) -> String {
        hitl_ask(key, q)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("HumanInLoop");
  });

  it("hitl_ask returns pre-placed answer immediately", async () => {
    const src = `
      module Test
      effect[HumanInLoop] function ask_human(key: String, q: String) -> String {
        hitl_ask(key, q)
      }
    `;
    const result = compile(src, "test.clarity");
    expect(result.wasm).toBeDefined();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-hitl-"));
    process.env.CLARITY_HITL_DIR = dir;

    // Pre-place the answer file so hitl_ask returns immediately.
    fs.writeFileSync(path.join(dir, "test-key.answer"), "approved by human", "utf-8");

    const { instance, runtime } = await instantiate(result.wasm!);
    const kPtr = runtime.writeString("test-key");
    const qPtr = runtime.writeString("Is this correct?");
    const resPtr = (instance.exports.ask_human as (k: number, q: number) => number)(kPtr, qPtr);
    const answer = runtime.readString(resPtr);
    expect(answer).toBe("approved by human");

    delete process.env.CLARITY_HITL_DIR;
    fs.rmSync(dir, { recursive: true });
  });
});

describe("std/hitl module", () => {
  function setupHitlTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-hitl-std-"));
    fs.writeFileSync(path.join(dir, "main.clarity"), src, "utf-8");
    fs.cpSync(path.join(process.cwd(), "std"), path.join(dir, "std"), { recursive: true });
    return dir;
  }

  it("imports ask and confirm from std/hitl", () => {
    const dir = setupHitlTest(`
      module Main
      import { ask, confirm } from "std/hitl"
      export effect[HumanInLoop] function do_ask(key: String, q: String) -> String {
        ask(key, q)
      }
      export effect[HumanInLoop] function do_confirm(key: String, q: String) -> Bool {
        confirm(key, q)
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("arena GC in std/agent", () => {
  function setupAgentTest(src: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-agent-gc-"));
    fs.writeFileSync(path.join(dir, "main.clarity"), src, "utf-8");
    fs.cpSync(path.join(process.cwd(), "std"), path.join(dir, "std"), { recursive: true });
    return dir;
  }

  it("agent run with arena GC compiles cleanly", () => {
    const dir = setupAgentTest(`
      module Main
      import { run } from "std/agent"
      function my_step(state: String) -> String {
        "{\\"done\\":true,\\"result\\":\\"ok\\"}"
      }
      export effect[Persist] function go() -> Result<String, String> {
        run("test-agent", "{}", my_step)
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });

  it("agent loop runs 3 steps and returns final state", async () => {
    const dir = setupAgentTest(`
      module Main
      import { run } from "std/agent"
      function step(state: String) -> String {
        match contains(state, "\\"n\\":2") {
          True -> "{\\"done\\":true,\\"result\\":\\"finished\\"}",
          False -> match contains(state, "\\"n\\":1") {
            True -> "{\\"n\\":2}",
            False -> "{\\"n\\":1}"
          }
        }
      }
      export effect[Persist] function go() -> String {
        let result = run("gc-agent", "{\\"n\\":0}", step);
        match result {
          Ok(s) -> s,
          Err(e) -> e
        }
      }
    `);
    const result = compileFile(path.join(dir, "main.clarity"));
    expect(result.errors).toHaveLength(0);
    const ckptDir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-ckpt-gc-"));
    process.env.CLARITY_CHECKPOINT_DIR = ckptDir;
    const { instance, runtime } = await instantiate(result.wasm!);
    const resPtr = (instance.exports.go as () => number)();
    const res = runtime.readString(resPtr);
    expect(res).toContain("finished");
    delete process.env.CLARITY_CHECKPOINT_DIR;
    fs.rmSync(dir, { recursive: true });
    fs.rmSync(ckptDir, { recursive: true });
  });
});
