// Host runtime for Clarity WASM modules.
// Provides the JavaScript implementations of imported functions (print, string ops, logging).
//
// String memory layout: [length: u32 (4 bytes)][utf8 data: length bytes]
// Strings are stored in WASM linear memory. A string pointer (i32) points to the length prefix.
// The WASM module owns the memory and exports it; the runtime binds to it after instantiation.

export interface RuntimeExports {
  memory: WebAssembly.Memory;
  __heap_base?: WebAssembly.Global;
}

export function createRuntime() {
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
  };
}
