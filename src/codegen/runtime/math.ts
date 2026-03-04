// Math, random, time, and bytes builtins.

import { createHash } from "node:crypto";
import type { SharedHelpers } from "./types.js";

export function createMathRuntime(h: SharedHelpers) {
  return {
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

    int_clamp(value: bigint, min: bigint, max: bigint): bigint {
      if (value < min) return min;
      if (value > max) return max;
      return value;
    },

    float_clamp(value: number, min: number, max: number): number {
      if (value < min) return min;
      if (value > max) return max;
      return value;
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

    log(x: number): number { return Math.log(x); },
    log2(x: number): number { return Math.log2(x); },
    log10(x: number): number { return Math.log10(x); },
    exp(x: number): number { return Math.exp(x); },
    sin(x: number): number { return Math.sin(x); },
    cos(x: number): number { return Math.cos(x); },
    tan(x: number): number { return Math.tan(x); },
    atan2(y: number, x: number): number { return Math.atan2(y, x); },

    f64_rem(a: number, b: number): number {
      return a % b;
    },

    // --- Random operations ---
    random_int(min: bigint, max: bigint): bigint {
      if (max < min) return min;
      const minN = Number(min);
      const maxN = Number(max);
      const value = Math.floor(Math.random() * (maxN - minN + 1)) + minN;
      return BigInt(value);
    },

    random_float(): number {
      return Math.random();
    },

    // --- Timestamp operations ---
    sleep(ms: bigint): void {
      const delay = Number(ms);
      if (delay <= 0) return;
      try {
        const sab = new SharedArrayBuffer(4);
        const arr = new Int32Array(sab);
        Atomics.wait(arr, 0, 0, delay);
      } catch {
        const end = Date.now() + delay;
        while (Date.now() < end) { /* spin */ }
      }
    },

    now(): bigint {
      return BigInt(Date.now());
    },

    timestamp_to_string(ms: bigint): number {
      return h.writeString(new Date(Number(ms)).toISOString());
    },

    timestamp_to_int(ms: bigint): bigint {
      return ms;
    },

    timestamp_from_int(ms: bigint): bigint {
      return ms;
    },

    timestamp_parse_iso(ptr: number): number {
      const ms = Date.parse(h.readString(ptr));
      if (Number.isNaN(ms)) return h.allocOptionI64(null);
      return h.allocOptionI64(BigInt(ms));
    },

    timestamp_add(t: bigint, ms: bigint): bigint {
      return t + ms;
    },

    timestamp_diff(a: bigint, b: bigint): bigint {
      return a - b;
    },

    // --- Bytes operations ---
    bytes_new(size: bigint): number {
      const len = Number(size);
      const ptr = h.alloc(4 + len);
      const view = new DataView(h.memory().buffer);
      view.setUint32(ptr, len, true);
      new Uint8Array(h.memory().buffer, ptr + 4, len).fill(0);
      return ptr;
    },

    bytes_length(ptr: number): bigint {
      const view = new DataView(h.memory().buffer);
      return BigInt(view.getUint32(ptr, true));
    },

    bytes_get(ptr: number, index: bigint): bigint {
      const view = new DataView(h.memory().buffer);
      const len = view.getUint32(ptr, true);
      const i = Number(index);
      if (i < 0 || i >= len) return 0n;
      return BigInt(new Uint8Array(h.memory().buffer, ptr + 4, len)[i]);
    },

    bytes_set(ptr: number, index: bigint, value: bigint): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getUint32(ptr, true);
      const i = Number(index);
      const newPtr = h.alloc(4 + len);
      const newView = new DataView(h.memory().buffer);
      newView.setUint32(newPtr, len, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, len).set(
        new Uint8Array(h.memory().buffer, ptr + 4, len),
      );
      if (i >= 0 && i < len) {
        new Uint8Array(h.memory().buffer)[newPtr + 4 + i] = Number(value) & 0xff;
      }
      return newPtr;
    },

    bytes_slice(ptr: number, start: bigint, length: bigint): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getUint32(ptr, true);
      const s = Math.max(0, Math.min(Number(start), len));
      const l = Math.max(0, Math.min(Number(length), len - s));
      const newPtr = h.alloc(4 + l);
      const newView = new DataView(h.memory().buffer);
      newView.setUint32(newPtr, l, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, l).set(
        new Uint8Array(h.memory().buffer, ptr + 4 + s, l),
      );
      return newPtr;
    },

    bytes_concat(aPtr: number, bPtr: number): number {
      const view = new DataView(h.memory().buffer);
      const aLen = view.getUint32(aPtr, true);
      const bLen = view.getUint32(bPtr, true);
      const newLen = aLen + bLen;
      const newPtr = h.alloc(4 + newLen);
      const newView = new DataView(h.memory().buffer);
      newView.setUint32(newPtr, newLen, true);
      new Uint8Array(h.memory().buffer, newPtr + 4, aLen).set(
        new Uint8Array(h.memory().buffer, aPtr + 4, aLen),
      );
      new Uint8Array(h.memory().buffer, newPtr + 4 + aLen, bLen).set(
        new Uint8Array(h.memory().buffer, bPtr + 4, bLen),
      );
      return newPtr;
    },

    bytes_from_string(strPtr: number): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getUint32(strPtr, true);
      const totalSize = 4 + len;
      const newPtr = h.alloc(totalSize);
      new Uint8Array(h.memory().buffer, newPtr, totalSize).set(
        new Uint8Array(h.memory().buffer, strPtr, totalSize),
      );
      return newPtr;
    },

    bytes_to_string(bytesPtr: number): number {
      const view = new DataView(h.memory().buffer);
      const len = view.getUint32(bytesPtr, true);
      const bytes = new Uint8Array(h.memory().buffer, bytesPtr + 4, len);
      const str = new TextDecoder().decode(bytes);
      return h.writeString(str);
    },

    // --- Crypto operations ---
    sha256(strPtr: number): number {
      const str = h.readString(strPtr);
      const hex = createHash("sha256").update(str).digest("hex");
      return h.writeString(hex);
    },
  };
}
