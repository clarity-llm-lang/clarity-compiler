// Memory management, list, map, test assertion builtins.

import type { SharedHelpers, AssertionFailure } from "./types.js";

export function createMiscRuntime(
  h: SharedHelpers,
  // Arena/memory state references (owned by the main runtime)
  memoryState: {
    heapPtr: () => number;
    setHeapPtr: (v: number) => void;
    internedStrings: Map<string, number>;
    allocSizeMap: Map<number, number>;
    freeLists: Map<number, number[]>;
  },
  // Test state
  testState: {
    currentTestFunction: () => string;
    assertionFailures: AssertionFailure[];
    assertionCount: { value: number };
  },
  // Map table
  mapTable: Map<number, Map<string | bigint, number | bigint>>,
  getNextMapHandle: () => number,
) {
  return {
    // --- Memory allocator ---
    __alloc(size: number): number {
      return h.alloc(size);
    },

    __free(_ptr: number): void {
      // free is handled by the main runtime closure
    },

    // --- Arena marks ---
    arena_save(): bigint {
      return BigInt(memoryState.heapPtr());
    },

    arena_restore(mark: bigint): void {
      const markPtr = Number(mark);
      if (markPtr >= memoryState.heapPtr()) return;

      for (const [str, ptr] of memoryState.internedStrings) {
        if (ptr >= markPtr) memoryState.internedStrings.delete(str);
      }
      for (const [ptr] of memoryState.allocSizeMap) {
        if (ptr >= markPtr) memoryState.allocSizeMap.delete(ptr);
      }
      for (const [cls, list] of memoryState.freeLists) {
        const trimmed = list.filter(p => p < markPtr);
        if (trimmed.length !== list.length) memoryState.freeLists.set(cls, trimmed);
      }
      memoryState.setHeapPtr(markPtr);
    },

    arena_restore_keeping_str(mark: bigint, strPtr: number): number {
      const str = h.readString(strPtr);
      const markPtr = Number(mark);

      if (markPtr < memoryState.heapPtr()) {
        for (const [s, p] of memoryState.internedStrings) {
          if (p >= markPtr) memoryState.internedStrings.delete(s);
        }
        for (const [p] of memoryState.allocSizeMap) {
          if (p >= markPtr) memoryState.allocSizeMap.delete(p);
        }
        for (const [cls, list] of memoryState.freeLists) {
          const trimmed = list.filter(p => p < markPtr);
          if (trimmed.length !== list.length) memoryState.freeLists.set(cls, trimmed);
        }
        memoryState.setHeapPtr(markPtr);
      }
      return h.writeString(str);
    },

    memory_stats(): number {
      const live = memoryState.allocSizeMap.size;
      let freeCount = 0;
      for (const list of memoryState.freeLists.values()) freeCount += list.length;
      return h.writeString(JSON.stringify({
        heap_ptr: memoryState.heapPtr(),
        live_allocs: live,
        free_blocks: freeCount,
        interned_strings: memoryState.internedStrings.size,
      }));
    },

    // --- List operations ---
    list_length(ptr: number): bigint {
      const view = new DataView(h.memory().buffer);
      return BigInt(view.getInt32(ptr, true));
    },

    list_get_i64(ptr: number, index: bigint): bigint {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      const i = Number(index);
      if (i < 0 || i >= len) return 0n;
      return view.getBigInt64(ptr + 4 + i * 8, true);
    },

    list_get_i32(ptr: number, index: bigint): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      const i = Number(index);
      if (i < 0 || i >= len) return 0;
      return view.getInt32(ptr + 4 + i * 4, true);
    },

    list_head_i64(ptr: number): bigint {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      if (len === 0) return 0n;
      return view.getBigInt64(ptr + 4, true);
    },

    list_tail(ptr: number, elemSize: number): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      if (len <= 0) {
        const newPtr = h.alloc(4);
        new DataView(h.memory().buffer).setInt32(newPtr, 0, true);
        return newPtr;
      }
      const newLen = len - 1;
      const newPtr = h.alloc(4 + newLen * elemSize);
      const newView = new DataView(h.memory().buffer);
      newView.setInt32(newPtr, newLen, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, newLen * elemSize).set(
        new Uint8Array(h.memory().buffer, ptr + 4 + elemSize, newLen * elemSize),
      );
      return newPtr;
    },

    list_append_i64(ptr: number, value: bigint): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      const newLen = len + 1;
      const newPtr = h.alloc(4 + newLen * 8);
      const newView = new DataView(h.memory().buffer);
      newView.setInt32(newPtr, newLen, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, len * 8).set(
        new Uint8Array(h.memory().buffer, ptr + 4, len * 8),
      );
      newView.setBigInt64(newPtr + 4 + len * 8, value, true);
      return newPtr;
    },

    list_append_i32(ptr: number, value: number): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      const newLen = len + 1;
      const newPtr = h.alloc(4 + newLen * 4);
      const newView = new DataView(h.memory().buffer);
      newView.setInt32(newPtr, newLen, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, len * 4).set(
        new Uint8Array(h.memory().buffer, ptr + 4, len * 4),
      );
      newView.setInt32(newPtr + 4 + len * 4, value, true);
      return newPtr;
    },

    list_set_i64(ptr: number, index: bigint, value: bigint): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      const i = Number(index);
      const newPtr = h.alloc(4 + len * 8);
      const newView = new DataView(h.memory().buffer);
      newView.setInt32(newPtr, len, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, len * 8).set(
        new Uint8Array(h.memory().buffer, ptr + 4, len * 8),
      );
      if (i >= 0 && i < len) {
        new DataView(h.memory().buffer).setBigInt64(newPtr + 4 + i * 8, value, true);
      }
      return newPtr;
    },

    list_set_i32(ptr: number, index: bigint, value: number): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      const i = Number(index);
      const newPtr = h.alloc(4 + len * 4);
      const newView = new DataView(h.memory().buffer);
      newView.setInt32(newPtr, len, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, len * 4).set(
        new Uint8Array(h.memory().buffer, ptr + 4, len * 4),
      );
      if (i >= 0 && i < len) {
        new DataView(h.memory().buffer).setInt32(newPtr + 4 + i * 4, value, true);
      }
      return newPtr;
    },

    list_concat(aPtr: number, bPtr: number, elemSize: number): number {
      const view = new DataView(h.memory().buffer);
      const aLen = view.getInt32(aPtr, true);
      const bLen = view.getInt32(bPtr, true);
      const newLen = aLen + bLen;
      const newPtr = h.alloc(4 + newLen * elemSize);
      const newView = new DataView(h.memory().buffer);
      newView.setInt32(newPtr, newLen, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, aLen * elemSize).set(
        new Uint8Array(h.memory().buffer, aPtr + 4, aLen * elemSize),
      );
      new Uint8Array(h.memory().buffer, newPtr + 4 + aLen * elemSize, bLen * elemSize).set(
        new Uint8Array(h.memory().buffer, bPtr + 4, bLen * elemSize),
      );
      return newPtr;
    },

    list_reverse(ptr: number, elemSize: number): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getInt32(ptr, true);
      const newPtr = h.alloc(4 + len * elemSize);
      const newView = new DataView(h.memory().buffer);
      newView.setInt32(newPtr, len, true);
      const src = new Uint8Array(h.memory().buffer, ptr + 4, len * elemSize);
      for (let i = 0; i < len; i++) {
        new Uint8Array(h.memory().buffer, newPtr + 4 + (len - 1 - i) * elemSize, elemSize).set(
          src.subarray(i * elemSize, (i + 1) * elemSize),
        );
      }
      return newPtr;
    },

    // --- Map operations ---
    map_new(): number {
      const handle = getNextMapHandle();
      mapTable.set(handle, new Map());
      return handle;
    },

    map_size(handle: number): bigint {
      return BigInt(mapTable.get(handle)?.size ?? 0);
    },

    map_has_str(handle: number, keyPtr: number): number {
      const key = h.readString(keyPtr);
      return mapTable.get(handle)?.has(key) ? 1 : 0;
    },

    map_get_str_i32(handle: number, keyPtr: number): number {
      const key = h.readString(keyPtr);
      const m = mapTable.get(handle);
      if (!m?.has(key)) return h.allocOptionI32(null);
      return h.allocOptionI32(m.get(key) as number);
    },

    map_get_str_i64(handle: number, keyPtr: number): number {
      const key = h.readString(keyPtr);
      const m = mapTable.get(handle);
      if (!m?.has(key)) return h.allocOptionI64(null);
      return h.allocOptionI64(m.get(key) as bigint);
    },

    map_set_str_i32(handle: number, keyPtr: number, val: number): number {
      const key = h.readString(keyPtr);
      const newMap = new Map(mapTable.get(handle) ?? []);
      newMap.set(key, val);
      const newHandle = getNextMapHandle();
      mapTable.set(newHandle, newMap);
      return newHandle;
    },

    map_set_str_i64(handle: number, keyPtr: number, val: bigint): number {
      const key = h.readString(keyPtr);
      const newMap = new Map(mapTable.get(handle) ?? []);
      newMap.set(key, val);
      const newHandle = getNextMapHandle();
      mapTable.set(newHandle, newMap);
      return newHandle;
    },

    map_remove_str(handle: number, keyPtr: number): number {
      const key = h.readString(keyPtr);
      const newMap = new Map(mapTable.get(handle) ?? []);
      newMap.delete(key);
      const newHandle = getNextMapHandle();
      mapTable.set(newHandle, newMap);
      return newHandle;
    },

    map_keys_str(handle: number): number {
      const m = mapTable.get(handle);
      if (!m) return h.allocListI32([]);
      return h.allocListI32([...m.keys()].map((k) => h.writeString(k as string)));
    },

    map_values_i32(handle: number): number {
      const m = mapTable.get(handle);
      if (!m) return h.allocListI32([]);
      return h.allocListI32([...m.values()] as number[]);
    },

    map_has_i64(handle: number, key: bigint): number {
      return mapTable.get(handle)?.has(key) ? 1 : 0;
    },

    map_get_i64_i32(handle: number, key: bigint): number {
      const m = mapTable.get(handle);
      if (!m?.has(key)) return h.allocOptionI32(null);
      return h.allocOptionI32(m.get(key) as number);
    },

    map_get_i64_i64(handle: number, key: bigint): number {
      const m = mapTable.get(handle);
      if (!m?.has(key)) return h.allocOptionI64(null);
      return h.allocOptionI64(m.get(key) as bigint);
    },

    map_set_i64_i32(handle: number, key: bigint, val: number): number {
      const newMap = new Map(mapTable.get(handle) ?? []);
      newMap.set(key, val);
      const newHandle = getNextMapHandle();
      mapTable.set(newHandle, newMap);
      return newHandle;
    },

    map_set_i64_i64(handle: number, key: bigint, val: bigint): number {
      const newMap = new Map(mapTable.get(handle) ?? []);
      newMap.set(key, val);
      const newHandle = getNextMapHandle();
      mapTable.set(newHandle, newMap);
      return newHandle;
    },

    map_remove_i64(handle: number, key: bigint): number {
      const newMap = new Map(mapTable.get(handle) ?? []);
      newMap.delete(key);
      const newHandle = getNextMapHandle();
      mapTable.set(newHandle, newMap);
      return newHandle;
    },

    map_keys_i64(handle: number): number {
      const m = mapTable.get(handle);
      if (!m) return h.allocListI64([]);
      return h.allocListI64([...m.keys()] as bigint[]);
    },

    map_values_i64(handle: number): number {
      const m = mapTable.get(handle);
      if (!m) return h.allocListI64([]);
      return h.allocListI64([...m.values()] as bigint[]);
    },

    // --- Test assertions ---
    assert_eq(actual: bigint, expected: bigint): void {
      testState.assertionCount.value++;
      if (actual !== expected) {
        testState.assertionFailures.push({ kind: "assert_eq", actual: actual.toString(), expected: expected.toString(), testFunction: testState.currentTestFunction() });
      }
    },

    assert_eq_float(actual: number, expected: number): void {
      testState.assertionCount.value++;
      const EPSILON = 1e-9;
      if (Math.abs(actual - expected) > EPSILON) {
        testState.assertionFailures.push({ kind: "assert_eq_float", actual: actual.toString(), expected: expected.toString(), testFunction: testState.currentTestFunction() });
      }
    },

    assert_eq_string(actualPtr: number, expectedPtr: number): void {
      testState.assertionCount.value++;
      const actualStr = h.readString(actualPtr);
      const expectedStr = h.readString(expectedPtr);
      if (actualStr !== expectedStr) {
        testState.assertionFailures.push({ kind: "assert_eq_string", actual: JSON.stringify(actualStr), expected: JSON.stringify(expectedStr), testFunction: testState.currentTestFunction() });
      }
    },

    assert_true(value: number): void {
      testState.assertionCount.value++;
      if (value !== 1) {
        testState.assertionFailures.push({ kind: "assert_true", actual: "False", expected: "True", testFunction: testState.currentTestFunction() });
      }
    },

    assert_false(value: number): void {
      testState.assertionCount.value++;
      if (value !== 0) {
        testState.assertionFailures.push({ kind: "assert_false", actual: "True", expected: "False", testFunction: testState.currentTestFunction() });
      }
    },

    // --- I/O & Logging ---
    print_string(ptr: number): void {
      console.log(h.readString(ptr));
    },

    print_no_newline(ptr: number): void {
      process.stdout.write(h.readString(ptr));
    },

    print_int(value: bigint): void {
      console.log(value.toString());
    },

    print_float(value: number): void {
      console.log(value.toString());
    },

    log_info(ptr: number): void {
      console.log(`[INFO] ${h.readString(ptr)}`);
    },

    log_warn(ptr: number): void {
      console.warn(`[WARN] ${h.readString(ptr)}`);
    },

    print_stderr(ptr: number): void {
      process.stderr.write(h.readString(ptr) + "\n");
    },

    // --- Policy introspection ---
    policy_is_url_allowed(urlPtr: number): number {
      return h.policyCheckUrl(h.readString(urlPtr)) === null ? 1 : 0;
    },

    policy_is_effect_allowed(effectPtr: number): number {
      return h.policyCheckEffect(h.readString(effectPtr)) === null ? 1 : 0;
    },
  };
}
