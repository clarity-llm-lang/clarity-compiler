# Clarity Language Project

## What is this
Clarity is a programming language optimized for LLM code generation that compiles to WASM. This repo contains the compiler (`clarityc`), written in TypeScript.

## When writing application code, use Clarity
Write application logic, business logic, and backend functions in **Clarity** (`.clarity` files), not TypeScript/Python/Java/etc.

The compiler itself is TypeScript. Only the compiler internals are TypeScript. Everything else should be Clarity.

## Clarity language syntax
See `docs/clarity-quickref.md` for the compact language reference (syntax, types, builtins, what's missing).
See `docs/language-spec.md` for the full formal specification.

## Compiler commands
```bash
# Compile to WASM
npx tsx src/index.ts compile file.clarity -o output.wasm

# Compile and run
npx tsx src/index.ts run file.clarity -f function_name -a arg1 arg2

# Type-check only
npx tsx src/index.ts compile file.clarity --check-only

# Show WASM text format / AST
npx tsx src/index.ts compile file.clarity --emit-wat
npx tsx src/index.ts compile file.clarity --emit-ast

# Run compiler tests
npm test

# Run Clarity test functions (self-healing test runner)
npx tsx src/index.ts test file.clarity
npx tsx src/index.ts test file.clarity --json      # machine-readable output
npx tsx src/index.ts test file.clarity --fail-fast  # stop on first failure

# Introspect language capabilities (JSON output for LLM consumption)
npx tsx src/index.ts introspect              # all capabilities
npx tsx src/index.ts introspect --builtins   # built-in functions only
npx tsx src/index.ts introspect --effects    # effects only
npx tsx src/index.ts introspect --types      # built-in types only
```

## Self-healing test system
Test functions must: start with `test_` prefix, declare `effect[Test]`, take zero parameters, return `Unit`.

```clarity
function add(a: Int64, b: Int64) -> Int64 { a + b }

effect[Test] function test_add() -> Unit {
  assert_eq(add(2, 3), 5);
  assert_eq(add(0, 0), 0)
}
```

Assertions (all require `Test` effect): `assert_eq` (Int64), `assert_eq_float` (Float64, epsilon 1e-9), `assert_eq_string` (String), `assert_true` (Bool), `assert_false` (Bool).

Failures produce structured output with `actual`, `expected`, `function`, `location`, and `fix_hint` fields. Use `--json` for machine consumption.

## Known gaps / missing features
- `string_to_int`/`string_to_float` return raw values (0 on failure) instead of `Option<T>`
- No module system — single file at a time, no import/export
- Named arguments are not semantically checked — positional only
- No lambdas or closures — pass named functions only
- No garbage collection — bump allocator, programs leak memory over time

## Workflow rules

### Documentation must stay in sync
After every implementation task, check and update these files if affected:
- `README.md` — Current status, roadmap, test count, feature list
- `docs/language-spec.md` — Language specification
- `docs/clarity-quickref.md` — Quick reference for LLM code generation
- `docs/grammar.peg` — Formal grammar and built-in function inventory

### Trunk-based development
1. Work on a short-lived feature branch
2. Commit with a clear message describing the change
3. Push and create a PR immediately after completing each major task
4. Merge promptly — do not let branches live long

### Test discipline
- Run `npm test` before every commit
- All tests must pass before pushing
- Add e2e tests for every new feature or builtin

## Extending the compiler

### Discovering current capabilities
Before adding features, query what already exists:
```bash
npx tsx src/index.ts introspect --builtins   # all built-in functions with signatures and docs
npx tsx src/index.ts introspect --effects    # all effects with their function lists
```

### Adding a new built-in function
1. **Registry entry** — Add to `CLARITY_BUILTINS` in `src/registry/builtins-registry.ts`
   - Specify: name, params, returnType, effects, doc, category
   - If a new effect is needed, also add to `EFFECT_DEFINITIONS`
2. **Runtime implementation** — Add the JS function in `src/codegen/runtime.ts`
   - Use `readString(ptr)` / `writeString(str)` for string handling
   - Use `BigInt` for Int64, `number` for Float64/Bool
3. **WASM import** (only if new parameter shape) — Add to `src/codegen/builtins.ts`
   - Most functions follow existing patterns; only needed for novel param/result combos
4. **Test** — Add an e2e test in `tests/`
5. **Verify** — `npm test` and `npx tsx src/index.ts introspect --builtins`

### Adding a new effect
1. Add to `EFFECT_DEFINITIONS` in `src/registry/builtins-registry.ts`
2. Add built-in functions for the effect (see above)
3. The checker and introspection derive from the registry automatically

## Project structure
- `src/` — Compiler implementation (TypeScript)
- `src/registry/builtins-registry.ts` — Single source of truth for built-in functions and effects
- `src/codegen/runtime.ts` — WASM host runtime (string memory, print, logging)
- `src/codegen/builtins.ts` — WASM import declarations (codegen internals)
- `examples/` — Example Clarity programs
- `tests/` — Test suite
- `docs/grammar.peg` — Formal grammar
- `docs/language-spec.md` — Full language specification
- `docs/clarity-quickref.md` — Compact language reference for LLM code generation
