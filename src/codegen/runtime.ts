// Host runtime for Clarity WASM modules.
// Provides the JavaScript implementations of imported functions (print, string ops, logging).
//
// String memory layout: [length: u32 (4 bytes)][utf8 data: length bytes]
// Strings are stored in WASM linear memory. A string pointer (i32) points to the length prefix.

import * as nodeFs from "node:fs";
import { createHash } from "node:crypto";
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

export interface AssertionFailure {
  kind: string;
  actual: string;
  expected: string;
  testFunction: string;
}

export function createRuntime(config: RuntimeConfig = {}) {
  // Memory is set after instantiation via bindMemory()
  let memory: WebAssembly.Memory = null!;
  let heapPtr = 1024; // start heap after data segment area

  // String intern table: maps JS string content → WASM heap pointer.
  // Avoids duplicate allocations when the same string value is created
  // multiple times at runtime (e.g., repeated string_concat, int_to_string).
  const internedStrings = new Map<string, number>();

  function readString(ptr: number): string {
    const view = new DataView(memory.buffer);
    const len = view.getUint32(ptr, true); // little-endian
    const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
    return new TextDecoder().decode(bytes);
  }

  function writeString(str: string): number {
    // Check intern table first — reuse existing allocation if available
    const existing = internedStrings.get(str);
    if (existing !== undefined) return existing;

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

    // Intern this string for future reuse
    internedStrings.set(str, ptr);
    return ptr;
  }

  function setHeapBase(base: number) {
    heapPtr = base;
    // Clear intern table since data segment strings occupy lower addresses
    // and runtime strings should start fresh from the new heap base
    internedStrings.clear();
  }

  function bindMemory(mem: WebAssembly.Memory) {
    memory = mem;
  }

  // --- Test state (used by assertion functions and test runner) ---
  let currentTestFunction = "";
  let assertionFailures: AssertionFailure[] = [];
  let assertionCount = 0;

  // --- Map table ---
  // Maps are represented as opaque i32 handles backed by JS Map objects.
  // Keys: string (for String-keyed maps) or bigint (for Int64-keyed maps).
  // Values: number (i32 pointer types) or bigint (i64 types).
  // All mutations (map_set, map_remove) return a NEW handle — functional style.
  const mapTable = new Map<number, Map<string | bigint, number | bigint>>();
  let nextMapHandle = 1;

  // Allocate an Option<i32> union: [tag:i32][value:i32] = 8 bytes
  function allocOptionI32(value: number | null): number {
    heapPtr = (heapPtr + 3) & ~3;
    const ptr = heapPtr;
    heapPtr = ptr + 8;
    if (heapPtr > memory.buffer.byteLength) {
      memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
    }
    const view = new DataView(memory.buffer);
    if (value === null) {
      view.setInt32(ptr, 1, true); // None
    } else {
      view.setInt32(ptr, 0, true); // Some
      view.setInt32(ptr + 4, value, true);
    }
    return ptr;
  }

  // Allocate an Option<i64> union: [tag:i32][value:i64] = 12 bytes
  function allocOptionI64(value: bigint | null): number {
    heapPtr = (heapPtr + 3) & ~3;
    const ptr = heapPtr;
    heapPtr = ptr + 12;
    if (heapPtr > memory.buffer.byteLength) {
      memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
    }
    const view = new DataView(memory.buffer);
    if (value === null) {
      view.setInt32(ptr, 1, true); // None
    } else {
      view.setInt32(ptr, 0, true); // Some
      view.setBigInt64(ptr + 4, value, true);
    }
    return ptr;
  }

  // Allocate a List<i32> on the heap: [count:i32][elements:i32...]
  function allocListI32(items: number[]): number {
    const len = items.length;
    const size = 4 + len * 4;
    heapPtr = (heapPtr + 3) & ~3;
    const ptr = heapPtr;
    heapPtr = ptr + size;
    if (heapPtr > memory.buffer.byteLength) {
      memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
    }
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, len, true);
    for (let i = 0; i < len; i++) {
      view.setInt32(ptr + 4 + i * 4, items[i], true);
    }
    return ptr;
  }

  // Allocate a List<i64> on the heap: [count:i32][elements:i64...]
  function allocListI64(items: bigint[]): number {
    const len = items.length;
    const size = 4 + len * 8;
    heapPtr = (heapPtr + 3) & ~3;
    const ptr = heapPtr;
    heapPtr = ptr + size;
    if (heapPtr > memory.buffer.byteLength) {
      memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
    }
    const view = new DataView(memory.buffer);
    view.setInt32(ptr, len, true);
    for (let i = 0; i < len; i++) {
      view.setBigInt64(ptr + 4 + i * 8, items[i], true);
    }
    return ptr;
  }

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

      char_code(ptr: number): bigint {
        const s = readString(ptr);
        if (s.length === 0) return 0n;
        return BigInt(s.codePointAt(0)!);
      },

      char_from_code(code: bigint): number {
        return writeString(String.fromCodePoint(Number(code)));
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

      // string_to_int returns Option<Int64> as heap-allocated union pointer.
      // Layout: [tag:i32][value:i64] = 12 bytes. Tag 0 = Some, Tag 1 = None.
      string_to_int(ptr: number): number {
        const s = readString(ptr);
        const n = parseInt(s, 10);
        const size = 12;
        // Allocate via bump allocator (same logic as __alloc)
        heapPtr = (heapPtr + 3) & ~3;
        const unionPtr = heapPtr;
        const needed = unionPtr + size;
        if (needed > memory.buffer.byteLength) {
          memory.grow(Math.ceil((needed - memory.buffer.byteLength) / 65536));
        }
        heapPtr = unionPtr + size;
        const view = new DataView(memory.buffer);
        if (isNaN(n)) {
          view.setInt32(unionPtr, 1, true); // None: tag = 1
        } else {
          view.setInt32(unionPtr, 0, true); // Some: tag = 0
          view.setBigInt64(unionPtr + 4, BigInt(n), true);
        }
        return unionPtr;
      },

      // string_to_float returns Option<Float64> as heap-allocated union pointer.
      // Layout: [tag:i32][value:f64] = 12 bytes. Tag 0 = Some, Tag 1 = None.
      string_to_float(ptr: number): number {
        const s = readString(ptr);
        const n = parseFloat(s);
        const size = 12;
        heapPtr = (heapPtr + 3) & ~3;
        const unionPtr = heapPtr;
        const needed = unionPtr + size;
        if (needed > memory.buffer.byteLength) {
          memory.grow(Math.ceil((needed - memory.buffer.byteLength) / 65536));
        }
        heapPtr = unionPtr + size;
        const view = new DataView(memory.buffer);
        if (isNaN(n)) {
          view.setInt32(unionPtr, 1, true); // None: tag = 1
        } else {
          view.setInt32(unionPtr, 0, true); // Some: tag = 0
          view.setFloat64(unionPtr + 4, n, true);
        }
        return unionPtr;
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

      // --- Bytes operations ---
      // Layout: [length: i32][byte_0, byte_1, ...] — same as String but raw bytes
      bytes_new(size: bigint): number {
        const len = Number(size);
        const totalSize = 4 + len;
        heapPtr = (heapPtr + 3) & ~3;
        const ptr = heapPtr;
        if (ptr + totalSize > memory.buffer.byteLength) {
          memory.grow(Math.ceil((ptr + totalSize - memory.buffer.byteLength) / 65536));
        }
        heapPtr = ptr + totalSize;
        const view = new DataView(memory.buffer);
        view.setUint32(ptr, len, true);
        // Zero-fill the bytes
        new Uint8Array(memory.buffer, ptr + 4, len).fill(0);
        return ptr;
      },

      bytes_length(ptr: number): bigint {
        const view = new DataView(memory.buffer);
        return BigInt(view.getUint32(ptr, true));
      },

      bytes_get(ptr: number, index: bigint): bigint {
        const view = new DataView(memory.buffer);
        const len = view.getUint32(ptr, true);
        const i = Number(index);
        if (i < 0 || i >= len) return 0n;
        return BigInt(new Uint8Array(memory.buffer, ptr + 4, len)[i]);
      },

      bytes_set(ptr: number, index: bigint, value: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getUint32(ptr, true);
        const i = Number(index);
        // Create a copy with the modification
        const totalSize = 4 + len;
        heapPtr = (heapPtr + 3) & ~3;
        const newPtr = heapPtr;
        if (newPtr + totalSize > memory.buffer.byteLength) {
          memory.grow(Math.ceil((newPtr + totalSize - memory.buffer.byteLength) / 65536));
        }
        heapPtr = newPtr + totalSize;
        const newView = new DataView(memory.buffer);
        newView.setUint32(newPtr, len, true);
        new Uint8Array(memory.buffer, newPtr + 4, len).set(
          new Uint8Array(memory.buffer, ptr + 4, len),
        );
        if (i >= 0 && i < len) {
          new Uint8Array(memory.buffer)[newPtr + 4 + i] = Number(value) & 0xff;
        }
        return newPtr;
      },

      bytes_slice(ptr: number, start: bigint, length: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getUint32(ptr, true);
        const s = Math.max(0, Math.min(Number(start), len));
        const l = Math.max(0, Math.min(Number(length), len - s));
        const totalSize = 4 + l;
        heapPtr = (heapPtr + 3) & ~3;
        const newPtr = heapPtr;
        if (newPtr + totalSize > memory.buffer.byteLength) {
          memory.grow(Math.ceil((newPtr + totalSize - memory.buffer.byteLength) / 65536));
        }
        heapPtr = newPtr + totalSize;
        const newView = new DataView(memory.buffer);
        newView.setUint32(newPtr, l, true);
        new Uint8Array(memory.buffer, newPtr + 4, l).set(
          new Uint8Array(memory.buffer, ptr + 4 + s, l),
        );
        return newPtr;
      },

      bytes_concat(aPtr: number, bPtr: number): number {
        const view = new DataView(memory.buffer);
        const aLen = view.getUint32(aPtr, true);
        const bLen = view.getUint32(bPtr, true);
        const newLen = aLen + bLen;
        const totalSize = 4 + newLen;
        heapPtr = (heapPtr + 3) & ~3;
        const newPtr = heapPtr;
        if (newPtr + totalSize > memory.buffer.byteLength) {
          memory.grow(Math.ceil((newPtr + totalSize - memory.buffer.byteLength) / 65536));
        }
        heapPtr = newPtr + totalSize;
        const newView = new DataView(memory.buffer);
        newView.setUint32(newPtr, newLen, true);
        new Uint8Array(memory.buffer, newPtr + 4, aLen).set(
          new Uint8Array(memory.buffer, aPtr + 4, aLen),
        );
        new Uint8Array(memory.buffer, newPtr + 4 + aLen, bLen).set(
          new Uint8Array(memory.buffer, bPtr + 4, bLen),
        );
        return newPtr;
      },

      bytes_from_string(strPtr: number): number {
        // String and Bytes have the same layout: [length: u32][data]
        // Just copy the memory block
        const view = new DataView(memory.buffer);
        const len = view.getUint32(strPtr, true);
        const totalSize = 4 + len;
        heapPtr = (heapPtr + 3) & ~3;
        const newPtr = heapPtr;
        if (newPtr + totalSize > memory.buffer.byteLength) {
          memory.grow(Math.ceil((newPtr + totalSize - memory.buffer.byteLength) / 65536));
        }
        heapPtr = newPtr + totalSize;
        new Uint8Array(memory.buffer, newPtr, totalSize).set(
          new Uint8Array(memory.buffer, strPtr, totalSize),
        );
        return newPtr;
      },

      bytes_to_string(bytesPtr: number): number {
        // Decode bytes as UTF-8 string
        const view = new DataView(memory.buffer);
        const len = view.getUint32(bytesPtr, true);
        const bytes = new Uint8Array(memory.buffer, bytesPtr + 4, len);
        const str = new TextDecoder().decode(bytes);
        return writeString(str);
      },

      // --- Crypto operations ---
      sha256(strPtr: number): number {
        const str = readString(strPtr);
        const hex = createHash("sha256").update(str).digest("hex");
        return writeString(hex);
      },

      // --- JSON operations ---
      // json_parse parses a flat JSON object into Option<Map<String, String>>.
      // Some(mapHandle) on success, None on invalid input / non-object / nested values.
      json_parse(strPtr: number): number {
        const src = readString(strPtr);
        let parsed: unknown;
        try {
          parsed = JSON.parse(src);
        } catch {
          return allocOptionI32(null);
        }

        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return allocOptionI32(null);
        }

        const out = new Map<string | bigint, number | bigint>();
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v === null) {
            out.set(k, writeString("null"));
          } else if (typeof v === "string") {
            out.set(k, writeString(v));
          } else if (typeof v === "number" || typeof v === "boolean") {
            out.set(k, writeString(String(v)));
          } else {
            // Only flat scalar values are currently supported.
            return allocOptionI32(null);
          }
        }

        const handle = nextMapHandle++;
        mapTable.set(handle, out);
        return allocOptionI32(handle);
      },

      // json_stringify serializes Map<String, String> to a JSON object.
      // Values that look like JSON literals (null/true/false/number) are emitted raw.
      // Everything else is emitted as a JSON string.
      json_stringify(mapHandle: number): number {
        const m = mapTable.get(mapHandle);
        if (!m) return writeString("{}");

        const numPattern = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
        const parts: string[] = [];
        for (const [k, v] of m.entries()) {
          const key = String(k);
          const raw = typeof v === "number" ? readString(v) : String(v);
          const trimmed = raw.trim();
          const asJsonValue =
            trimmed === "null" ||
            trimmed === "true" ||
            trimmed === "false" ||
            numPattern.test(trimmed)
              ? trimmed
              : JSON.stringify(raw);
          parts.push(`${JSON.stringify(key)}:${asJsonValue}`);
        }

        return writeString(`{${parts.join(",")}}`);
      },

      // --- Timestamp operations ---
      // Timestamp is i64 (milliseconds since Unix epoch)
      now(): bigint {
        return BigInt(Date.now());
      },

      timestamp_to_string(ms: bigint): number {
        return writeString(new Date(Number(ms)).toISOString());
      },

      timestamp_to_int(ms: bigint): bigint {
        return ms;
      },

      timestamp_from_int(ms: bigint): bigint {
        return ms;
      },

      timestamp_add(t: bigint, ms: bigint): bigint {
        return t + ms;
      },

      timestamp_diff(a: bigint, b: bigint): bigint {
        return a - b;
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

      list_set_i64(ptr: number, index: bigint, value: bigint): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        const newSize = 4 + len * 8;
        const newPtr = heapPtr;
        heapPtr = (heapPtr + newSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, len, true);
        // Copy all elements
        new Uint8Array(memory.buffer, newPtr + 4, len * 8).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 8),
        );
        // Replace element at index
        if (i >= 0 && i < len) {
          new DataView(memory.buffer).setBigInt64(newPtr + 4 + i * 8, value, true);
        }
        return newPtr;
      },

      list_set_i32(ptr: number, index: bigint, value: number): number {
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const i = Number(index);
        const newSize = 4 + len * 4;
        const newPtr = heapPtr;
        heapPtr = (heapPtr + newSize + 3) & ~3;
        if (heapPtr > memory.buffer.byteLength) {
          memory.grow(Math.ceil((heapPtr - memory.buffer.byteLength) / 65536));
        }
        const newView = new DataView(memory.buffer);
        newView.setInt32(newPtr, len, true);
        // Copy all elements
        new Uint8Array(memory.buffer, newPtr + 4, len * 4).set(
          new Uint8Array(memory.buffer, ptr + 4, len * 4),
        );
        // Replace element at index
        if (i >= 0 && i < len) {
          new DataView(memory.buffer).setInt32(newPtr + 4 + i * 4, value, true);
        }
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

      // --- Map operations ---
      // Maps are backed by JS Map objects stored in mapTable.
      // String-keyed: key passed as i32 pointer to WASM string.
      // Int64-keyed: key passed as i64.
      // All mutations return a new handle (functional style).
      map_new(): number {
        const handle = nextMapHandle++;
        mapTable.set(handle, new Map());
        return handle;
      },

      map_size(handle: number): bigint {
        return BigInt(mapTable.get(handle)?.size ?? 0);
      },

      // String-keyed operations
      map_has_str(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        return mapTable.get(handle)?.has(key) ? 1 : 0;
      },

      map_get_str_i32(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI32(null);
        return allocOptionI32(m.get(key) as number);
      },

      map_get_str_i64(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI64(null);
        return allocOptionI64(m.get(key) as bigint);
      },

      map_set_str_i32(handle: number, keyPtr: number, val: number): number {
        const key = readString(keyPtr);
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_set_str_i64(handle: number, keyPtr: number, val: bigint): number {
        const key = readString(keyPtr);
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_remove_str(handle: number, keyPtr: number): number {
        const key = readString(keyPtr);
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.delete(key);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_keys_str(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI32([]);
        return allocListI32([...m.keys()].map((k) => writeString(k as string)));
      },

      map_values_i32(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI32([]);
        return allocListI32([...m.values()] as number[]);
      },

      // Int64-keyed operations
      map_has_i64(handle: number, key: bigint): number {
        return mapTable.get(handle)?.has(key) ? 1 : 0;
      },

      map_get_i64_i32(handle: number, key: bigint): number {
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI32(null);
        return allocOptionI32(m.get(key) as number);
      },

      map_get_i64_i64(handle: number, key: bigint): number {
        const m = mapTable.get(handle);
        if (!m?.has(key)) return allocOptionI64(null);
        return allocOptionI64(m.get(key) as bigint);
      },

      map_set_i64_i32(handle: number, key: bigint, val: number): number {
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_set_i64_i64(handle: number, key: bigint, val: bigint): number {
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.set(key, val);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_remove_i64(handle: number, key: bigint): number {
        const newMap = new Map(mapTable.get(handle) ?? []);
        newMap.delete(key);
        const newHandle = nextMapHandle++;
        mapTable.set(newHandle, newMap);
        return newHandle;
      },

      map_keys_i64(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI64([]);
        return allocListI64([...m.keys()] as bigint[]);
      },

      map_values_i64(handle: number): number {
        const m = mapTable.get(handle);
        if (!m) return allocListI64([]);
        return allocListI64([...m.values()] as bigint[]);
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
