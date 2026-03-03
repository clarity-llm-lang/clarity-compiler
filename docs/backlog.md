# Clarity Compiler Backlog

Generated from codebase audit (2026-03-01). Items are grouped by priority and category.
Checked items (✅) are done. Each item references the audit finding number.

---

## 🔴 High Priority

### Type System / Correctness

- [x] **#2 Int64 match exhaustiveness not checked** — fixed *(2026-03-01)*
- [x] **#3 Overlapping range patterns not detected** — fixed *(2026-03-01)*
- [x] **#6 Record field layout has no alignment/padding** — fixed *(2026-03-01)*
- [x] **#7 Union discriminant is unchecked at match time** — fixed *(2026-03-01)*

### Unimplemented / Dead Stubs

- [x] **#1 `db_query` and `db_execute` dead stubs** — removed *(2026-03-01)*
- [x] **#4 `http_listen` dead stub** — removed *(2026-03-01)*

---

## 🟠 Medium Priority

### Type System / Codegen

- [x] **#5 Complex generic instantiations are untested** — fixed *(2026-03-03)*
  Added e2e tests for `List<Result<String,String>>`, `Result<Option<String>,String>`,
  `Option<List<Int64>>`. Also fixed codegen bug where `Result<T,E>` nested as a type argument
  (e.g. inside `List<...>`) was never registered in `allTypeDecls`, causing invalid WASM.
  Fix: `registerNestedResultTypes()` recursively walks types before codegen.

- [x] **#8 Mutual recursion not tail-call optimised** — fixed *(2026-03-03)*
  The checker now detects mutual tail-call pairs (A tail-calls B AND B tail-calls A) and
  emits a `warning`-severity diagnostic. Self-recursive tail calls and normal helper calls
  are not warned. Warning deduplication ensures each pair is reported exactly once.
  Also fixed: `Option<TypeVar>` in generic function bodies was not converted to Union form,
  causing "Cannot use constructor pattern on non-union type Option<V>" errors in generic
  stdlib code (`std/map`). Fixed in `makeOptionType` (skip cache for TypeVar keys) and in
  the generic call resolution path (removed `!containsTypeVar` guard).

- [ ] **#9 Higher-order of higher-order functions untested**
  `apply(apply, double)` style calls are untested. Add coverage and fix any codegen issues.

### Missing Stdlib

- [x] **#10 String stdlib gaps** — fixed *(2026-03-03)*
- [x] **#11 List stdlib gaps** — fixed *(2026-03-03)*
- [x] **#12 Math stdlib gaps** — fixed *(2026-03-03)*

- [x] **#13 Map operations** — fixed *(2026-03-03)*
  Added `std/map.clarity` with `map_merge`, `map_filter`, `map_transform`, `map_entries`
  as pure Clarity HOF implementations built on the existing `map_keys`, `map_get`, `map_set`,
  `map_new` builtins. Also exports `MapEntry<K, V>` generic record type for `map_entries`.
  5 new e2e tests in "Standard library: std/map" describe block.

- [ ] **#14 JSON stdlib gaps** — `std/json.clarity`
  Missing: formatting/pretty-print, nested path access helpers (`json_get_path`),
  basic schema validation.

- [ ] **#15 Regex effect undefined**
  `regex_match` / `regex_captures` referenced in docs but the `Regex` effect is not defined
  in the registry. Either add the effect + runtime implementation, or remove the docs reference.

### Effect System

- [ ] **#16 `Random` effect is thin**
  Only `random_int` and `random_float` exist. Add: `random_choice(list)`, `shuffle(list)`,
  `random_bytes(n: Int64) -> Bytes`.

- [ ] **#17 `Time` effect gaps**
  No time zone support, no duration type, no parsing of time strings. Consider adding a
  `Duration` type and `timestamp_parse(s: String) -> Option<Timestamp>`.

- [ ] **#18 Effect checking transitivity audit**
  Verify (with tests) that calling a `effect[Network]` function from a function that does not
  declare `Network` is always caught by the checker. Audit stdlib modules for any violations.

### CLI

- [ ] **#19 No `watch` command** — `src/index.ts`
  No auto-recompile on file change. Implement `clarityc watch [file]` using `fs.watch`.

- [ ] **#20 No `fmt` command**
  No code formatter. LLMs produce inconsistently indented Clarity. Add `clarityc fmt [file]`
  (in-place formatting, or `--check` mode for CI).

- [ ] **#21 No `lint` command**
  No unused-variable warnings, no style checks. Add `clarityc lint [file]`.

- [ ] **#22 REPL is brute-force** — `src/index.ts` lines 549–651
  Tries all 7 return types sequentially to determine expression type. Add readline history
  and tab completion; infer return type from checker output instead of runtime probing.

- [ ] **#23 `clarityc pack` is not truly standalone**
  Packed launcher requires `clarity-lang` in node_modules at the deploy target. Bundle the
  runtime inline into the launcher, or document the dependency explicitly.

### Test Coverage

- [ ] **#24 No golden-file tests for error messages**
  Error text can change silently and break downstream tools or LLM prompts that parse
  compiler output. Add snapshot/golden tests for key error messages.

- [ ] **#25 No concurrent/multi-stream tests**
  `stream_start()` called twice, interleaved `stream_next()`, closing one stream while
  another is open — all untested.

- [ ] **#26 No memory-limit / allocator stress tests**
  No test approaches the WASM memory limit or exercises the free-list under pressure.

---

## 🟢 Low Priority

### Performance / Codegen Quality

- [ ] **#28 No constant folding** — `src/codegen/codegen.ts`
  `5 + 3` emits two `i64.const` plus `i64.add`. `"a" ++ "b"` is not folded. Implement
  constant folding in the codegen or as a pre-pass on the AST.

- [ ] **#29 No dead-code elimination**
  Unused functions are compiled and exported. Add a reachability pass from the entry
  function(s) and skip unreachable functions in codegen.

### Error Messages

- [ ] **#30 Generic error messages** — `src/checker/checker.ts`
  "Expected Int64 but got String" without tracing where the inferred type came from.
  Add type-inference traces for generic function call failures; show the search path
  when a module-not-found error is raised.

### Maintainability

- [ ] **#31 Dead lambda AST nodes** — `src/ast/nodes.ts` lines 252–260; `src/codegen/codegen.ts`
  `LambdaExpr` AST node, `lambdaCounter`, and `pendingLambdas` in codegen exist but are
  never exercised. Wire up lambda parsing or remove the dead infrastructure to reduce
  confusion.

- [ ] **#32 No `.eslintrc` / `.prettierrc`**
  Inconsistent code style across files. Add linting and formatting config and run in CI.

- [ ] **#33 CLAUDE.md phase status drift**
  REPL is marked TODO in Phase 5 but it is implemented. Browser playground (the other half)
  is not. Do a pass on all ✓/TODO markers in CLAUDE.md to reflect reality.

- [ ] **#34 `inferFunctionReturnType` hardcoded map is a maintenance trap** — `src/codegen/codegen.ts`
  This map must be manually kept in sync with the builtins registry. It has already caused
  one bug (i64 vs i32 mismatch fixed 2026-03-01). Refactor codegen to derive return types
  directly from `CLARITY_BUILTINS` in the registry instead of maintaining a parallel map.

---

## Done

- [x] **#34 `inferFunctionReturnType` hardcoded map** — Replaced 150-line manual map in
  `src/codegen/codegen.ts` with a single `Map` built from `CLARITY_BUILTINS` at module load.
  Adding a new builtin to the registry now automatically propagates its return type to codegen.
  *(2026-03-01)*

- [x] **#2 Int64 match exhaustiveness not checked** — `src/checker/exhaustiveness.ts` now emits
  a compile error when an Int64 match has only literal/range arms and no wildcard `_`.
  Same check applied to String, Float64, Bytes, Timestamp matches with literal arms.
  *(2026-03-01)*

- [x] **#3 Overlapping range patterns not detected** — Overlap detection added to
  `src/checker/exhaustiveness.ts`. Overlapping pairs emit a `warning`-severity diagnostic
  (compilation continues but the programmer is notified). *(2026-03-01)*

- [x] **Compiler errors vs warnings separated** — `CompileResult` now has `errors` (severity:
  "error", blocks compilation) and `warnings` (severity: "warning"/"info", non-fatal).
  `src/compiler.ts` updated for both `compile()` and `compileFile()`. *(2026-03-01)*

- [x] **#1 `db_execute` and `db_query` dead stubs removed** — Removed from
  `src/registry/builtins-registry.ts` and `src/codegen/builtins.ts`. Runtime implementations
  remain but are unreachable from Clarity. `DB` effect removed from `EFFECT_DEFINITIONS`.
  *(2026-03-01)*

- [x] **#4 `http_listen` dead stub removed** — Removed from registry and builtins.ts.
  Also cleaned up duplicate `http_request` import entry in builtins.ts. *(2026-03-01)*

- [x] **#6 Record field alignment and Timestamp i64 load/store** — `src/codegen/codegen.ts`
  + `src/codegen/runtime.ts`
  Three fixes in one:
  1. The bump allocator in runtime.ts now guarantees **8-byte alignment** (`heapPtr = (heapPtr + 7) & ~7`),
     so record and union base pointers are always 8-byte aligned.
  2. Union header widened from 4 bytes to **8 bytes** (i32 tag + 4 bytes padding), ensuring the
     first variant field — even an Int64 or Float64 — lands at an 8-byte-aligned offset.
     All field accesses in codegen updated from `+4` to `+8`; all JS-side union allocators
     (`allocOptionI32/I64`, `allocResultI32/I64`, `string_to_int`, `string_to_float`,
     `cosine_similarity`) updated to match (sizes and offsets).
  3. `storeField`/`loadField` now handle `Timestamp` as i64 (was incorrectly using i32),
     and use alignment hint `8` for `Int64`/`Float64`/`Timestamp` (was `4`).
  *(2026-03-01)*

- [x] **#7 Union discriminant bounds-check at match time** — `src/codegen/codegen.ts`
  Both `generateUnionMatch` and `generateUnionMatchTCO` now emit an explicit
  `(if (i32.ge_u tag numVariants) (unreachable))` guard before the if-else dispatch chain.
  A corrupted tag that happens to equal a valid variant index can no longer silently execute
  the wrong arm — out-of-range tags always trap. *(2026-03-01)*

- [x] **#10 String stdlib gaps** — Added 8 new string builtins (`to_uppercase`, `to_lowercase`,
  `trim_start`, `trim_end`, `pad_left`, `pad_right`, `split_lines`, `chars`) in registry, runtime,
  and builtins stubs. Added `to_upper`, `to_lower`, `ltrim`, `rtrim` aliases to `std/string.clarity`.
  5 new e2e tests. *(2026-03-03)*

- [x] **#11 List stdlib gaps** — Added `sort`, `sort_by`, `uniq`, `intersperse`, `reject`,
  `group_by` as pure Clarity implementations in `std/list.clarity`. No new builtins needed.
  Note: `sort_by` takes a key function; builtins cannot be passed as first-class function
  references (use a named wrapper function). *(2026-03-03)*

- [x] **#12 Math stdlib gaps** — Added 8 new math builtins (`log`, `log2`, `log10`, `exp`,
  `sin`, `cos`, `tan`, `atan2`) in registry, runtime, and builtins stubs. Added `ln`, `log_2`,
  `log_10`, `e_pow` wrappers plus Clarity-level `gcd` / `lcm` in `std/math.clarity`. *(2026-03-03)*

- [x] **RQ-LANG-CLI-FS-001/FS-002: FS directory and state primitives** — Added `list_dir`,
  `file_exists`, `remove_file`, `make_dir` as `FileSystem` builtins in registry, runtime, and
  builtins stubs. Enables `list`, `cancel`, and `watch` (via polling) in native Clarity CLI.
  *(2026-03-03)*

- [x] **RQ-LANG-CLI-PKG-001: Multi-module symbol collision** — `src/codegen/codegen.ts`
  Private (non-exported) functions are now assigned collision-free WASM names by prefixing with
  their module name (`ModuleName$funcName`). `setupModuleMulti` builds per-module name resolution
  tables (`currentModuleWasmNames`) and generates functions module-by-module so call sites always
  resolve to the correct WASM name. Exported functions keep their plain Clarity name. Covered by
  e2e test "multi-module symbol collision: two modules with same private function name".
  *(2026-03-03)*

- [x] **#5 Complex nested generics codegen bug + tests** — `src/codegen/codegen.ts`
  `Result<T,E>` nested as a type argument (e.g. `List<Result<String,String>>`) was never
  registered in `allTypeDecls`, causing "Generated invalid WASM module". Fixed with
  `registerNestedResultTypes()` that recursively walks ClarityType. Added e2e tests for
  `List<Result<String,String>>`, `Result<Option<String>,String>`, `Option<List<Int64>>`.
  *(2026-03-03)*

- [x] **#8 Mutual tail-recursion warning** — `src/checker/checker.ts`
  After body checking, the checker builds a tail-call graph (per-function set of local
  functions called in tail position). Pairs where A tail-calls B and B tail-calls A are
  reported as `warning`-severity diagnostics. Self-recursive and non-mutual patterns are
  ignored; each pair warned exactly once. 4 e2e tests added. *(2026-03-03)*

- [x] **#13 Map stdlib** — `std/map.clarity`
  New module exporting `map_merge`, `map_filter`, `map_transform`, `map_entries` (plus
  `MapEntry<K, V>` generic record type). Implemented as pure Clarity HOF functions using
  existing `map_keys`, `map_get`, `map_set`, `map_new` builtins. Also fixed checker bug:
  `Option<TypeVar>` was not converted to Union form for generic function bodies, causing
  false "Cannot use constructor pattern on non-union type Option<V>" errors. *(2026-03-03)*

- [x] **#18 Cross-module effect transitivity tests** — `tests/e2e/compile.test.ts`
  Added 6 integration tests verifying that the effect checker correctly rejects importing
  and calling `Network`/`Log`/`FileSystem` functions from pure callers, and accepts them
  when the caller declares the matching effect. *(2026-03-03)*
