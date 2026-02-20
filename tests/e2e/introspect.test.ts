import { describe, it, expect } from "vitest";
import {
  CLARITY_BUILTINS,
  EFFECT_DEFINITIONS,
  getKnownEffectNames,
  getBuiltinsForEffect,
  getBuiltinsByCategory,
} from "../../src/registry/builtins-registry.js";
import { typeToString } from "../../src/checker/types.js";

describe("builtins registry", () => {
  it("contains all expected built-in functions", () => {
    const names = CLARITY_BUILTINS.map((b) => b.name);
    // Spot-check key functions from each category
    expect(names).toContain("print_string");
    expect(names).toContain("string_concat");
    expect(names).toContain("int_to_float");
    expect(names).toContain("abs_int");
    expect(names).toContain("head");
    expect(names).toContain("read_line");
    expect(names).toContain("http_get");
    expect(names).toContain("assert_eq");
    expect(names).toContain("random_int");
    expect(names).toContain("regex_match");
    expect(names).toContain("timestamp_parse_iso");
    expect(names).toContain("string_replace");
    expect(names).toContain("string_starts_with");
    expect(names).toContain("string_ends_with");
    expect(names).toContain("string_repeat");
    expect(names).toContain("int_clamp");
    expect(names).toContain("float_clamp");
    expect(names).toContain("json_parse_object");
    expect(names).toContain("json_stringify_object");
    expect(names).toContain("db_execute");
    expect(names).toContain("db_query");
    expect(names).toContain("http_listen");
  });

  it("contains all expected effects", () => {
    const effectNames = EFFECT_DEFINITIONS.map((e) => e.name);
    expect(effectNames).toContain("DB");
    expect(effectNames).toContain("Network");
    expect(effectNames).toContain("Time");
    expect(effectNames).toContain("Random");
    expect(effectNames).toContain("Log");
    expect(effectNames).toContain("FileSystem");
    expect(effectNames).toContain("Test");
    expect(effectNames).toHaveLength(7);
  });

  it("getKnownEffectNames returns a Set of all effect names", () => {
    const names = getKnownEffectNames();
    expect(names).toBeInstanceOf(Set);
    expect(names.size).toBe(7);
    expect(names.has("FileSystem")).toBe(true);
  });

  it("getBuiltinsForEffect returns functions for a given effect", () => {
    const fsFns = getBuiltinsForEffect("FileSystem");
    const fsNames = fsFns.map((b) => b.name);
    expect(fsNames).toContain("read_line");
    expect(fsNames).toContain("read_file");
    expect(fsNames).toContain("write_file");
    expect(fsNames).toContain("get_args");
    expect(fsNames).toContain("exit");
  });

  it("getBuiltinsByCategory returns functions for a given category", () => {
    const mathFns = getBuiltinsByCategory("math");
    const mathNames = mathFns.map((b) => b.name);
    expect(mathNames).toContain("abs_int");
    expect(mathNames).toContain("sqrt");
    expect(mathNames).toContain("pow");
  });

  it("every builtin has required fields", () => {
    for (const b of CLARITY_BUILTINS) {
      expect(b.name).toBeTruthy();
      expect(Array.isArray(b.params)).toBe(true);
      expect(b.returnType).toBeTruthy();
      expect(Array.isArray(b.effects)).toBe(true);
      expect(b.doc).toBeTruthy();
      expect(b.category).toBeTruthy();
    }
  });

  it("every builtin effect references a known effect", () => {
    const known = getKnownEffectNames();
    for (const b of CLARITY_BUILTINS) {
      for (const eff of b.effects) {
        expect(known.has(eff)).toBe(true);
      }
    }
  });

  it("types serialize correctly via typeToString", () => {
    const readLine = CLARITY_BUILTINS.find((b) => b.name === "read_line")!;
    expect(typeToString(readLine.returnType)).toBe("String");

    const getArgs = CLARITY_BUILTINS.find((b) => b.name === "get_args")!;
    expect(typeToString(getArgs.returnType)).toBe("List<String>");

    const assertEq = CLARITY_BUILTINS.find((b) => b.name === "assert_eq")!;
    expect(assertEq.params.map(typeToString)).toEqual(["Int64", "Int64"]);
    expect(typeToString(assertEq.returnType)).toBe("Unit");
  });
});
