// String and JSON builtins.

import type { SharedHelpers } from "./types.js";

export function createStringRuntime(
  h: SharedHelpers,
  mapTable: Map<number, Map<string | bigint, number | bigint>>,
  getNextMapHandle: () => number,
) {
  return {
    // --- String operations ---
    string_concat(aPtr: number, bPtr: number): number {
      return h.writeString(h.readString(aPtr) + h.readString(bPtr));
    },

    string_eq(aPtr: number, bPtr: number): number {
      return h.readString(aPtr) === h.readString(bPtr) ? 1 : 0;
    },

    string_length(ptr: number): bigint {
      return BigInt(h.readString(ptr).length);
    },

    substring(ptr: number, start: bigint, length: bigint): number {
      const s = h.readString(ptr);
      return h.writeString(s.substring(Number(start), Number(start) + Number(length)));
    },

    char_at(ptr: number, index: bigint): number {
      const s = h.readString(ptr);
      const i = Number(index);
      return h.writeString(i >= 0 && i < s.length ? s[i] : "");
    },

    contains(haystackPtr: number, needlePtr: number): number {
      return h.readString(haystackPtr).includes(h.readString(needlePtr)) ? 1 : 0;
    },

    string_starts_with(sPtr: number, prefixPtr: number): number {
      return h.readString(sPtr).startsWith(h.readString(prefixPtr)) ? 1 : 0;
    },

    string_ends_with(sPtr: number, suffixPtr: number): number {
      return h.readString(sPtr).endsWith(h.readString(suffixPtr)) ? 1 : 0;
    },

    index_of(haystackPtr: number, needlePtr: number): bigint {
      return BigInt(h.readString(haystackPtr).indexOf(h.readString(needlePtr)));
    },

    trim(ptr: number): number {
      return h.writeString(h.readString(ptr).trim());
    },

    split(sPtr: number, delimPtr: number): number {
      const parts = h.readString(sPtr).split(h.readString(delimPtr));
      const ptrs = parts.map(p => h.writeString(p));
      const listPtr = h.alloc(4 + ptrs.length * 4);
      const view = new DataView(h.memory().buffer);
      view.setInt32(listPtr, ptrs.length, true);
      for (let i = 0; i < ptrs.length; i++) {
        view.setInt32(listPtr + 4 + i * 4, ptrs[i], true);
      }
      return listPtr;
    },

    string_replace(sPtr: number, searchPtr: number, replacementPtr: number): number {
      const s = h.readString(sPtr);
      const search = h.readString(searchPtr);
      const replacement = h.readString(replacementPtr);
      if (search.length === 0) return h.writeString(s);
      return h.writeString(s.split(search).join(replacement));
    },

    string_repeat(sPtr: number, count: bigint): number {
      const n = Number(count);
      if (n <= 0) return h.writeString("");
      return h.writeString(h.readString(sPtr).repeat(n));
    },

    char_code(ptr: number): bigint {
      const s = h.readString(ptr);
      if (s.length === 0) return 0n;
      return BigInt(s.codePointAt(0)!);
    },

    char_from_code(code: bigint): number {
      return h.writeString(String.fromCodePoint(Number(code)));
    },

    to_uppercase(ptr: number): number {
      return h.writeString(h.readString(ptr).toUpperCase());
    },

    to_lowercase(ptr: number): number {
      return h.writeString(h.readString(ptr).toLowerCase());
    },

    trim_start(ptr: number): number {
      return h.writeString(h.readString(ptr).trimStart());
    },

    trim_end(ptr: number): number {
      return h.writeString(h.readString(ptr).trimEnd());
    },

    pad_left(sPtr: number, width: bigint, charPtr: number): number {
      const s = h.readString(sPtr);
      const w = Number(width);
      const ch = h.readString(charPtr) || " ";
      if (s.length >= w) return h.writeString(s);
      return h.writeString(s.padStart(w, ch));
    },

    pad_right(sPtr: number, width: bigint, charPtr: number): number {
      const s = h.readString(sPtr);
      const w = Number(width);
      const ch = h.readString(charPtr) || " ";
      if (s.length >= w) return h.writeString(s);
      return h.writeString(s.padEnd(w, ch));
    },

    split_lines(ptr: number): number {
      const s = h.readString(ptr);
      const lines = s.split(/\r\n|\r|\n/);
      const ptrs = lines.map(l => h.writeString(l));
      return h.allocListI32(ptrs);
    },

    chars(ptr: number): number {
      const s = h.readString(ptr);
      const charPtrs = [...s].map(c => h.writeString(c));
      return h.allocListI32(charPtrs);
    },

    // --- Type conversions ---
    int_to_float(value: bigint): number {
      return Number(value);
    },

    float_to_int(value: number): bigint {
      return BigInt(Math.trunc(value));
    },

    int_to_string(value: bigint): number {
      return h.writeString(value.toString());
    },

    float_to_string(value: number): number {
      return h.writeString(value.toString());
    },

    string_to_int(ptr: number): number {
      const s = h.readString(ptr).trim();
      const unionPtr = h.alloc(16);
      const view = new DataView(h.memory().buffer);
      if (/^-?\d+$/.test(s)) {
        try {
          view.setInt32(unionPtr, 0, true); // Some
          view.setBigInt64(unionPtr + 8, BigInt(s), true);
        } catch {
          view.setInt32(unionPtr, 1, true); // None (overflow)
        }
      } else {
        view.setInt32(unionPtr, 1, true); // None
      }
      return unionPtr;
    },

    string_to_float(ptr: number): number {
      const s = h.readString(ptr).trim();
      const unionPtr = h.alloc(16);
      const view = new DataView(h.memory().buffer);
      const n = s === "" ? NaN : Number(s);
      if (Number.isNaN(n)) {
        view.setInt32(unionPtr, 1, true); // None
      } else {
        view.setInt32(unionPtr, 0, true); // Some
        view.setFloat64(unionPtr + 8, n, true);
      }
      return unionPtr;
    },

    // --- JSON operations ---
    json_parse(strPtr: number): number {
      const src = h.readString(strPtr);
      let parsed: unknown;
      try {
        parsed = JSON.parse(src);
      } catch {
        return h.allocOptionI32(null);
      }

      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return h.allocOptionI32(null);
      }

      const out = new Map<string | bigint, number | bigint>();
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === null) {
          out.set(k, h.writeString("null"));
        } else if (typeof v === "string") {
          out.set(k, h.writeString(v));
        } else if (typeof v === "number" || typeof v === "boolean") {
          out.set(k, h.writeString(String(v)));
        } else {
          return h.allocOptionI32(null);
        }
      }

      const handle = getNextMapHandle();
      mapTable.set(handle, out);
      return h.allocOptionI32(handle);
    },

    json_stringify(mapHandle: number): number {
      const m = mapTable.get(mapHandle);
      if (!m) return h.writeString("{}");

      const numPattern = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
      const parts: string[] = [];
      for (const [k, v] of m.entries()) {
        const key = String(k);
        const raw = typeof v === "number" ? h.readString(v) : String(v);
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

      return h.writeString(`{${parts.join(",")}}`);
    },

    json_get(jsonPtr: number, keyPtr: number): number {
      try {
        const parsed = JSON.parse(h.readString(jsonPtr));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return h.allocOptionI32(null);
        const key = h.readString(keyPtr);
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) return h.allocOptionI32(null);
        const val = (parsed as Record<string, unknown>)[key];
        if (val === null || val === undefined) return h.allocOptionI32(null);
        const s = typeof val === "string" ? val : (typeof val === "object" ? JSON.stringify(val) : String(val));
        return h.allocOptionI32(h.writeString(s));
      } catch {
        return h.allocOptionI32(null);
      }
    },

    json_get_path(jsonPtr: number, pathPtr: number): number {
      try {
        let current: unknown = JSON.parse(h.readString(jsonPtr));
        const segments = h.readString(pathPtr).split(".");
        for (const seg of segments) {
          if (current === null || typeof current !== "object" || Array.isArray(current)) return h.allocOptionI32(null);
          const obj = current as Record<string, unknown>;
          if (!Object.prototype.hasOwnProperty.call(obj, seg)) return h.allocOptionI32(null);
          current = obj[seg];
        }
        if (current === null || current === undefined) return h.allocOptionI32(null);
        const s = typeof current === "string" ? current : (typeof current === "object" ? JSON.stringify(current) : String(current));
        return h.allocOptionI32(h.writeString(s));
      } catch {
        return h.allocOptionI32(null);
      }
    },

    json_get_nested(jsonPtr: number, pathPtr: number): number {
      try {
        let node: unknown = JSON.parse(h.readString(jsonPtr));
        const parts = h.readString(pathPtr).split(".");
        for (const part of parts) {
          if (node === null || node === undefined) return h.allocOptionI32(null);
          if (Array.isArray(node)) {
            const idx = parseInt(part, 10);
            if (isNaN(idx) || idx < 0 || idx >= node.length) return h.allocOptionI32(null);
            node = (node as unknown[])[idx];
          } else if (typeof node === "object") {
            if (!Object.prototype.hasOwnProperty.call(node, part)) return h.allocOptionI32(null);
            node = (node as Record<string, unknown>)[part];
          } else {
            return h.allocOptionI32(null);
          }
        }
        if (node === null || node === undefined) return h.allocOptionI32(null);
        const s = typeof node === "string" ? node : JSON.stringify(node);
        return h.allocOptionI32(h.writeString(s));
      } catch {
        return h.allocOptionI32(null);
      }
    },

    json_array_length(jsonPtr: number): number {
      try {
        const parsed = JSON.parse(h.readString(jsonPtr));
        if (!Array.isArray(parsed)) return h.allocOptionI64(null);
        return h.allocOptionI64(BigInt(parsed.length));
      } catch {
        return h.allocOptionI64(null);
      }
    },

    json_array_get(jsonPtr: number, index: bigint): number {
      try {
        const parsed = JSON.parse(h.readString(jsonPtr));
        if (!Array.isArray(parsed)) return h.allocOptionI32(null);
        const idx = Number(index);
        if (idx < 0 || idx >= parsed.length) return h.allocOptionI32(null);
        const val = (parsed as unknown[])[idx];
        const s = typeof val === "string" ? val : JSON.stringify(val);
        return h.allocOptionI32(h.writeString(s));
      } catch {
        return h.allocOptionI32(null);
      }
    },

    json_keys(jsonPtr: number): number {
      try {
        const parsed = JSON.parse(h.readString(jsonPtr));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return h.allocOptionI32(null);
        const keys = Object.keys(parsed as Record<string, unknown>);
        const ptrs = keys.map((k) => h.writeString(k));
        const listPtr = h.allocListI32(ptrs);
        return h.allocOptionI32(listPtr);
      } catch {
        return h.allocOptionI32(null);
      }
    },

    json_escape_string(ptr: number): number {
      const s = h.readString(ptr);
      const escaped = JSON.stringify(s).slice(1, -1);
      return h.writeString(escaped);
    },

    // --- Regex operations ---
    regex_match(patternPtr: number, textPtr: number): number {
      try {
        const re = new RegExp(h.readString(patternPtr));
        return re.test(h.readString(textPtr)) ? 1 : 0;
      } catch {
        return 0;
      }
    },

    regex_captures(patternPtr: number, textPtr: number): number {
      try {
        const re = new RegExp(h.readString(patternPtr));
        const match = h.readString(textPtr).match(re);
        if (!match) return h.allocOptionI32(null);
        const ptrs = match.map((m) => h.writeString(m));
        const listPtr = h.allocListI32(ptrs);
        return h.allocOptionI32(listPtr);
      } catch {
        return h.allocOptionI32(null);
      }
    },

    // --- URL encoding helpers (pure) ---
    url_encode(sPtr: number): number {
      return h.writeString(encodeURIComponent(h.readString(sPtr)));
    },

    url_decode(sPtr: number): number {
      const s = h.readString(sPtr);
      try {
        return h.writeString(decodeURIComponent(s));
      } catch {
        return h.writeString(s);
      }
    },

    // --- JSON object operations ---
    json_parse_object(ptr: number): number {
      try {
        const parsed = JSON.parse(h.readString(ptr));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return h.allocResultString(false, h.writeString("Expected JSON object"));
        }
        const m = new Map<string | bigint, number | bigint>();
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") {
            m.set(k, h.writeString(v));
          } else if (v === null || typeof v === "number" || typeof v === "boolean") {
            m.set(k, h.writeString(String(v)));
          } else {
            m.set(k, h.writeString(JSON.stringify(v)));
          }
        }
        const handle = getNextMapHandle();
        mapTable.set(handle, m);
        return h.allocResultI32(true, handle);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return h.allocResultI32(false, h.writeString(msg));
      }
    },

    json_stringify_object(handle: number): number {
      const m = mapTable.get(handle) ?? new Map();
      const obj: Record<string, string> = {};
      for (const [k, v] of m.entries()) {
        obj[String(k)] = typeof v === "number" ? h.readString(v) : String(v);
      }
      return h.writeString(JSON.stringify(obj));
    },
  };
}
