# Clarity Compiler Backlog

Generated from codebase audit (2026-03-01). Items are grouped by priority and category.
Checked items (✅) are done. Each item references the audit finding number.

---

## 🔴 High Priority

### Type System / Correctness

- [ ] **#2 Int64 match exhaustiveness not checked** — `src/checker/exhaustiveness.ts`
  The exhaustiveness checker only validates Bool and Union types. An Int64 match without
  a wildcard `_` arm silently compiles but crashes at runtime on an unmatched value.
  Range patterns (`1..10`) have the same gap. Fix: require `_` (or full literal coverage)
  for Int64 matches; emit a compile error otherwise.

- [ ] **#3 Overlapping range patterns not detected** — `src/checker/exhaustiveness.ts`
  `1..5` and `3..7` in the same match compile with no warning. Add overlap detection and
  emit a warning (or error) for overlapping Int64 range arms.

- [ ] **#6 Record field layout has no alignment/padding** — `src/codegen/codegen.ts`
  Fields are laid out sequentially in linear memory without word-alignment padding.
  `{ a: Int64, b: Bool, c: Int64 }` produces misaligned reads. Fix: align each field
  to its natural size (4 bytes for i32/f32, 8 bytes for i64/f64).

- [ ] **#7 Union discriminant is unchecked at match time** — `src/codegen/codegen.ts`
  The variant tag (i32) stored in memory is never bounds-checked when pattern matching.
  A corrupted heap silently executes the wrong arm instead of trapping.

### Unimplemented / Dead Stubs

- [ ] **#1 `db_query` and `db_execute` are dead stubs** — `src/codegen/runtime.ts`, `src/registry/builtins-registry.ts`
  Declared in the registry with WASM stubs but always return `Err("not implemented yet")`.
  Decision needed: implement a real SQLite binding, or remove them from the registry and
  document the gap. Either is better than silent misleading stubs.

- [ ] **#4 `http_listen` is a stub** — `src/codegen/runtime.ts`
  Always returns `Err("http_listen not implemented yet")`. Clarity cannot be used as an
  HTTP server despite the docs suggesting it. Same decision as #1.

---

## 🟠 Medium Priority

### Type System / Codegen

- [ ] **#5 Complex generic instantiations are untested**
  `List<Result<String, String>>`, `Result<Option<String>, String>`, `Map<String, List<Int64>>`
  have no e2e tests. Monomorphization may silently produce wrong code for deeply nested generics.
  Add tests; fix any bugs found.

- [ ] **#8 Mutual recursion not tail-call optimised** — `src/codegen/codegen.ts`
  TCO only applies to self-recursion. Mutually recursive functions (`f → g → f`) will
  stack-overflow on deep inputs. Emit a compile-time warning when a non-self recursive
  call is in tail position.

- [ ] **#9 Higher-order of higher-order functions untested**
  `apply(apply, double)` style calls are untested. Add coverage and fix any codegen issues.

### Missing Stdlib

- [ ] **#10 String stdlib gaps** — `std/string.clarity`
  Missing: `to_uppercase`, `to_lowercase`, `trim_start`, `trim_end`, `pad_left`, `pad_right`,
  `split_lines`, `chars`

- [ ] **#11 List stdlib gaps** — `std/list.clarity`
  Missing: `sort`, `sort_by`, `group_by`, `uniq`, `partition`, `intersperse`

- [ ] **#12 Math stdlib gaps** — `std/math.clarity`
  Missing: `log`, `log2`, `log10`, `exp`, `sin`, `cos`, `tan`, `atan2`, `gcd`, `lcm`

- [ ] **#13 Map operations** — no stdlib file
  Maps can only be built and looked up. Missing: `map_merge`, `map_filter`, `map_transform`,
  `map_keys`, `map_values`, `map_entries`

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
