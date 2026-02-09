import { describe, it, expect } from "vitest";
import { compile } from "../../src/compiler.js";
import { createRuntime, type RuntimeConfig } from "../../src/codegen/runtime.js";

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
    if (result.errors.length > 0) console.log("ERRORS:", JSON.stringify(result.errors));
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

  it("compiles string_to_int returning raw Int64", async () => {
    const source = `
      module Test
      function parse(s: String) -> Int64 {
        string_to_int(s)
      }
    `;
    const result = compile(source, "test.clarity");
    expect(result.errors).toHaveLength(0);
    expect(result.wasm).toBeDefined();

    const { instance, runtime } = await instantiate(result.wasm!);
    const parse = instance.exports.parse as (ptr: number) => bigint;
    expect(parse(runtime.writeString("42"))).toBe(42n);
    expect(parse(runtime.writeString("not_a_number"))).toBe(0n);
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
});
