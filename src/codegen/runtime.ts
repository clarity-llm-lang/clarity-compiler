// Host runtime for Clarity WASM modules.
// Provides the JavaScript implementations of imported functions (print, string ops, logging).
//
// String memory layout: [length: u32 (4 bytes)][utf8 data: length bytes]
// Strings are stored in WASM linear memory. A string pointer (i32) points to the length prefix.

import * as nodeFs from "node:fs";
// The WASM module owns the memory and exports it; the runtime binds to it after instantiation.

export interface RuntimeExports {
  memory: WebAssembly.Memory;
  __heap_base?: WebAssembly.Global;
}

export interface RuntimeConfig {
  /** Command-line arguments to expose via get_args() */
  argv?: string[];
  /** Stdin content (pre-read). If not provided, reads synchronously from process.stdin */
  stdin?: string;
  /** File system access. If not provided, uses Node.js fs */
  fs?: {
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, content: string) => void;
  };
}

export function createRuntime(config: RuntimeConfig = {}) {
  // Memory is set after instantiation via bindMemory()
  let memory: WebAssembly.Memory = null!;
  let heapPtr = 1024; // start heap after data segment area

  function readString(ptr: number): string {
    const view = new DataView(memory.buffer);
    const len = view.getUint32(ptr, true); // little-endian
    const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
    return new TextDecoder().decode(bytes);
  }

  function writeString(str: string): number {
    const encoded = new TextEncoder().encode(str);
    const ptr = heapPtr;

    // Grow memory if needed
    const needed = ptr + 4 + encoded.length;
    if (needed > memory.buffer.byteLength) {
      const pages = Math.ceil((needed - memory.buffer.byteLength) / 65536);
      memory.grow(pages);
    }

    const view = new DataView(memory.buffer);
    view.setUint32(ptr, encoded.length, true);
    new Uint8Array(memory.buffer, ptr + 4, encoded.length).set(encoded);
    heapPtr = ptr + 4 + encoded.length;
    // Align to 4 bytes
    heapPtr = (heapPtr + 3) & ~3;
    return ptr;
  }

  function setHeapBase(base: number) {
    heapPtr = base;
  }

  function bindMemory(mem: WebAssembly.Memory) {
    memory = mem;
  }

  // --- Test state (used by assertion functions and test runner) ---
  interface AssertionFailure {
    kind: string;
    actual: string;
    expected: string;
    testFunction: string;
  }

  let currentTestFunction = "";
  let assertionFailures: AssertionFailure[] = [];
  let assertionCount = 0;

  const imports = {
    env: {
      // --- I/O & Logging ---
      print_string(ptr: number): void {
        console.log(readString(ptr));
      },

      print_int(value: bigint): void {
        console.log(value.toString());
      },

      print_float(value: number): void {
        console.log(value.toString());
      },

      log_info(ptr: number): void {
        console.log(`[INFO] ${readString(ptr)}`);
      },

      log_warn(ptr: number): void {
        console.warn(`[WARN] ${readString(ptr)}`);
      },

      // --- String operations ---
      string_concat(aPtr: number, bPtr: number): number {
        const a = readString(aPtr);
        const b = readString(bPtr);
        return writeString(a + b);
      },

      string_eq(aPtr: number, bPtr: number): number {
        return readString(aPtr) === readString(bPtr) ? 1 : 0;
      },

      string_length(ptr: number): bigint {
        return BigInt(readString(ptr).length);
      },

      substring(ptr: number, start: bigint, length: bigint): number {
        const s = readString(ptr);
        return writeString(s.substring(Number(start), Number(start) + Number(length)));
      },

      char_at(ptr: number, index: bigint): number {
        const s = readString(ptr);
        const i = Number(index);
        return writeString(i >= 0 && i < s.length ? s[i] : "");
      },

      contains(haystackPtr: number, needlePtr: number): number {
        return readString(haystackPtr).includes(readString(needlePtr)) ? 1 : 0;
      },

      index_of(haystackPtr: number, needlePtr: number): bigint {
        return BigInt(readString(haystackPtr).indexOf(readString(needlePtr)));
      },

      trim(ptr: number): number {
        return writeString(readString(ptr).trim());
      },

      split(sPtr: number, delimPtr: number): number {
        const parts = readString(sPtr).split(readString(delimPtr));
        // Build a List<String> in memory: [length: i32][ptr0: i32][ptr1: i32]...
        const ptrs = parts.map(p => writeString(p));
        const listSize = 4 + ptrs.length * 4;
        const listPtr = heapPtr;
        heapPtr = (heapPtr + listSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const view = new DataView(memory.buffer);
        view.setInt32(listPtr, ptrs.length, true);
        for (let i = 0; i < ptrs.length; i++) {
          view.setInt32(listPtr + 4 + i * 4, ptrs[i], true);
        }
        return listPtr;
      },

      // --- Type conversions ---
      int_to_float(value: bigint): number {
        return Number(value);
      },

      float_to_int(value: number): bigint {
        return BigInt(Math.trunc(value));
      },

      int_to_string(value: bigint): number {
        return writeString(value.toString());
      },

      float_to_string(value: number): number {
        return writeString(value.toString());
      },

      string_to_int(ptr: number): bigint {
        const s = readString(ptr);
        const n = parseInt(s, 10);
        // Returns the value directly — Option encoding TBD
        return isNaN(n) ? BigInt(0) : BigInt(n);
      },

      string_to_float(ptr: number): number {
        const s = readString(ptr);
        const n = parseFloat(s);
        return isNaN(n) ? 0.0 : n;
      },

      // --- Math builtins ---
      abs_int(value: bigint): bigint {
        return value < 0n ? -value : value;
      },

      min_int(a: bigint, b: bigint): bigint {
        return a < b ? a : b;
      },

      max_int(a: bigint, b: bigint): bigint {
        return a > b ? a : b;
      },

      sqrt(value: number): number {
        return Math.sqrt(value);
      },

      pow(base: number, exp: number): number {
        return Math.pow(base, exp);
      },

      floor(value: number): number {
        return Math.floor(value);
      },

      ceil(value: number): number {
        return Math.ceil(value);
      },

      f64_rem(a: number, b: number): number {
        return a % b;
      },

      // --- Memory allocator (bump allocator) ---
      __alloc(size: number): number {
        const align = 4;
        heapPtr = (heapPtr + align - 1) & ~(align - 1);
        const ptr = heapPtr;

        // Grow memory if needed
        const needed = ptr + size;
        if (needed > memory.buffer.byteLength) {
          const pages = Math.ceil((needed - memory.buffer.byteLength) / 65536);
          memory.grow(pages);
        }

        heapPtr = ptr + size;
        return ptr;
      },

      // --- List operations ---
      // Layout: [length: i32(4 bytes)][elem_0][elem_1]...
      // elem_size is passed to allow generic element access.
      list_length(ptr: number): bigint {
        const view = new DataView(memory.buffer);
        return BigInt(view.getInt32(ptr, true));
      },

      list_get_i64(ptr: number, index: bigint): bigint {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        if (i < 0 || i >= len) return 0n;
        return view.getBigInt64(ptr + 4 + i * 8, true);
      },

      list_get_i32(ptr: number, index: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        if (i < 0 || i >= len) return 0;
        return view.getInt32(ptr + 4 + i * 4, true);
      },

      list_head_i64(ptr: number): bigint {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        if (len === 0) return 0n;
        return view.getBigInt64(ptr + 4, true);
      },

      list_tail(ptr: number, elemSize: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        if (len <= 0) {
          // Return empty list
          const newPtr = heapPtr;
          heapPtr = (heapPtr + 4 + 3) & ~3;
          if (heapPtr > memory.buffer.byteLength) {
            memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
          }
          new DataView(memory.buffer).setInt32(newPtr, 0, true);
          return newPtr;
        }
        const newLen = len - 1;
        const newSize = 4 + newLen * elemSize;
        const newPtr = heapPtr;
        heapPtr = (heapPtr + newSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        // Copy elements starting from index 1
        new Uint8Array(memory.buffer, newPtr + 4, newLen * elemSize).set(
          new Uint8Array(memory.buffer, ptr + 4 + elemSize, newLen * elemSize),
        );
        return newPtr;
      },

      list_append_i64(ptr: number, value: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const newLen = len + 1;
        const newSize = 4 + newLen * 8;
        const newPtr = heapPtr;
        heapPtr = (heapPtr + newSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        // Copy existing elements
        new Uint8Array(memory.buffer, newPtr + 4, len * 8).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 8),
        );
        // Append new element
        newView.setBigInt64(newPtr + 4 + len * 8, value, true);
        return newPtr;
      },

      list_append_i32(ptr: number, value: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const newLen = len + 1;
        const newSize = 4 + newLen * 4;
        const newPtr = heapPtr;
        heapPtr = (heapPtr + newSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        new Uint8Array(memory.buffer, newPtr + 4, len * 4).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 4),
        );
        newView.setInt32(newPtr + 4 + len * 4, value, true);
        return newPtr;
      },

      list_concat(aPtr: number, bPtr: number, elemSize: number): number {
        const view = new DataView(memory.buffer);
        const aLen = view.getInt32(aPtr, true);
        const bLen = view.getInt32(bPtr, true);
        const newLen = aLen + bLen;
        const newSize = 4 + newLen * elemSize;
        const newPtr = heapPtr;
        heapPtr = (heapPtr + newSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, newLen, true);
        // Copy a elements
        new Uint8Array(memory.buffer, newPtr + 4, aLen * elemSize).set(
          new Uint8Array(memory.buffer, aPtr + 4, aLen * elemSize),
        );
        // Copy b elements
        new Uint8Array(memory.buffer, newPtr + 4 + aLen * elemSize, bLen * elemSize).set(
          new Uint8Array(memory.buffer, bPtr + 4, bLen * elemSize),
        );
        return newPtr;
      },

      // --- Test assertions ---
      // Assertions accumulate failures rather than throwing, so an LLM
      // can see ALL failures in a single test run for better self-healing.
      assert_eq(actual: bigint, expected: bigint): void {
        assertionCount++;
        if (actual !== expected) {
          assertionFailures.push({
            kind: "assert_eq",
            actual: actual.toString(),
            expected: expected.toString(),
            testFunction: currentTestFunction,
          });
        }
      },

      assert_eq_float(actual: number, expected: number): void {
        assertionCount++;
        const EPSILON = 1e-9;
        if (Math.abs(actual - expected) > EPSILON) {
          assertionFailures.push({
            kind: "assert_eq_float",
            actual: actual.toString(),
            expected: expected.toString(),
            testFunction: currentTestFunction,
          });
        }
      },

      assert_eq_string(actualPtr: number, expectedPtr: number): void {
        assertionCount++;
        const actualStr = readString(actualPtr);
        const expectedStr = readString(expectedPtr);
        if (actualStr !== expectedStr) {
          assertionFailures.push({
            kind: "assert_eq_string",
            actual: JSON.stringify(actualStr),
            expected: JSON.stringify(expectedStr),
            testFunction: currentTestFunction,
          });
        }
      },

      assert_true(value: number): void {
        assertionCount++;
        if (value !== 1) {
          assertionFailures.push({
            kind: "assert_true",
            actual: "False",
            expected: "True",
            testFunction: currentTestFunction,
          });
        }
      },

      assert_false(value: number): void {
        assertionCount++;
        if (value !== 0) {
          assertionFailures.push({
            kind: "assert_false",
            actual: "True",
            expected: "False",
            testFunction: currentTestFunction,
          });
        }
      },

      // --- I/O primitives ---
      read_line(): number {
        if (config.stdin !== undefined) {
          // Return the first line from pre-provided stdin
          const newline = config.stdin.indexOf("\n");
          if (newline === -1) {
            const line = config.stdin;
            config.stdin = "";
            return writeString(line);
          }
          const line = config.stdin.substring(0, newline);
          config.stdin = config.stdin.substring(newline + 1);
          return writeString(line);
        }
        // Synchronous stdin read via Node.js
        try {
          const fs = nodeFs;
          const buf = Buffer.alloc(4096);
          const bytesRead = fs.readSync(0, buf, 0, buf.length, null);
          const input = buf.toString("utf-8", 0, bytesRead);
          const newline = input.indexOf("\n");
          return writeString(newline === -1 ? input : input.substring(0, newline));
        } catch {
          return writeString("");
        }
      },

      read_all_stdin(): number {
        if (config.stdin !== undefined) {
          const content = config.stdin;
          config.stdin = "";
          return writeString(content);
        }
        try {
          const fs = nodeFs;
          const chunks: Buffer[] = [];
          const buf = Buffer.alloc(4096);
          let bytesRead: number;
          while ((bytesRead = fs.readSync(0, buf, 0, buf.length, null)) > 0) {
            chunks.push(buf.subarray(0, bytesRead));
          }
          return writeString(Buffer.concat(chunks).toString("utf-8"));
        } catch {
          return writeString("");
        }
      },

      read_file(pathPtr: number): number {
        const path = readString(pathPtr);
        try {
          if (config.fs) {
            return writeString(config.fs.readFileSync(path, "utf-8"));
          }
          const fs = nodeFs;
          return writeString(fs.readFileSync(path, "utf-8"));
        } catch (e: unknown) {
          return writeString("");
        }
      },

      write_file(pathPtr: number, contentPtr: number): void {
        const path = readString(pathPtr);
        const content = readString(contentPtr);
        if (config.fs) {
          config.fs.writeFileSync(path, content);
          return;
        }
        nodeFs.writeFileSync(path, content);
      },

      get_args(): number {
        const args = config.argv ?? [];
        // Build a List<String> in WASM memory: [length: i32][ptr0: i32][ptr1: i32]...
        // Each element is an i32 string pointer
        const strPtrs = args.map(a => writeString(a));
        const listSize = 4 + strPtrs.length * 4;
        const listPtr = heapPtr;
        heapPtr = (heapPtr + listSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const view = new DataView(memory.buffer);
        view.setInt32(listPtr, strPtrs.length, true);
        for (let i = 0; i < strPtrs.length; i++) {
          view.setInt32(listPtr + 4 + i * 4, strPtrs[i], true);
        }
        return listPtr;
      },

      exit(code: bigint): void {
        process.exit(Number(code));
      },

      list_reverse(ptr: number, elemSize: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const newSize = 4 + len * elemSize;
        const newPtr = heapPtr;
        heapPtr = (heapPtr + newSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, len, true);
        const src = new Uint8Array(memory.buffer, ptr + 4, len * elemSize);
        for (let i = 0; i < len; i++) {
          new Uint8Array(memory.buffer, newPtr + 4 + (len - 1 - i) * elemSize, elemSize).set(
            src.subarray(i * elemSize, (i + 1) * elemSize),
          );
        }
        return newPtr;
      },
    },
  };

  return {
    get memory() { return memory; },
    imports,
    readString,
    writeString,
    setHeapBase,
    bindMemory,
    // Test runner API
    setCurrentTest(name: string) { currentTestFunction = name; },
    getTestResults() { return { total: assertionCount, failures: [...assertionFailures] }; },
    resetTestState() { assertionFailures = []; assertionCount = 0; },
  };
}
