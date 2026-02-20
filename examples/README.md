# Clarity Examples Catalog

**Philosophy:** This catalog represents what Clarity *should* be able to do. Each example is a requirements specification. If an example can't be implemented elegantly, we add the missing language feature rather than implementing workarounds.

## Quick Start

```bash
# Compile an example
npx clarityc compile examples/01-hello-world/hello.clarity

# Run an example
npx clarityc run examples/01-hello-world/hello.clarity -f square -a 5

# Type-check only
npx clarityc compile examples/02-recursion/fibonacci.clarity --check-only

# Run tests
npx clarityc test examples/06-math-toolkit/math.clarity
```

## All Examples (20 Total)

### ✅ Implemented Examples (17 total)

| # | Name | Complexity | Category | Tests | Status |
|---|------|------------|----------|-------|--------|
| 01 | [Hello World](01-hello-world/) | Beginner | Fundamentals | - | ✅ Implemented |
| 02 | [Recursion](02-recursion/) | Beginner→Intermediate | Fundamentals | - | ✅ Implemented |
| 03 | [String Processing](03-string-processing/) | Intermediate | Text, Effects | - | ✅ Implemented |
| 04 | [File I/O](04-file-io/) | Intermediate | FileSystem, Effects | - | ✅ Implemented |
| 05 | [Sudoku Solver](05-sudoku-solver/) | Advanced | Algorithms, Backtracking | 8 | ✅ Implemented |
| 06 | [Math Toolkit](06-math-toolkit/) | Intermediate | Mathematics | 16 | ✅ Implemented |
| 07 | [String Toolkit](07-string-toolkit/) | Intermediate | Text Processing | 13 | ✅ Implemented* |
| 09 | [CSV Processor](09-csv-processor/) | Intermediate | Data Processing | 9 | ✅ Implemented |
| 10 | [Config Parser](10-config-parser/) | Intermediate | Parsing | 12 | ✅ Implemented |
| 11 | [Todo CLI](11-todo-cli/) | Intermediate | CLI, CRUD | 21 | ✅ Implemented |
| 12 | [Log Analyzer](12-log-analyzer/) | Intermediate→Advanced | Analysis | 22 | ✅ Implemented |
| 13 | [Template Engine](13-template-engine/) | Intermediate | Text | 12 | ✅ Implemented |
| 14 | [Tic-Tac-Toe](14-tic-tac-toe/) | Intermediate | Games, AI | 8 | ✅ Implemented |
| 17 | [Linear Regression](17-linear-regression/) | Advanced | ML, Numeric | 6 | ✅ Implemented |
| 18 | [Merkle Tree](18-merkle-tree/) | Advanced | Blockchain, Crypto | 12 | ✅ Implemented |
| 19 | [JSON Parser](19-json-parser/) | Advanced | Parsing | 17 | ✅ Implemented |
| 20 | [Expression Evaluator](20-expr-evaluator/) | Advanced | Compilers | 9 | ✅ Implemented |

\* *String Toolkit: Implemented without case conversion (requires `char_code()` builtin)*

### 📋 Requirements Documentation (3 remaining)

| # | Name | Complexity | Category | Blocked By |
|---|------|------------|----------|------------|
| 08 | [JSON API Client](08-json-api/) | Intermediate | Network | JSON runtime built-ins |
| 15 | [Web Server](15-web-server/) | Advanced | Network | HTTP server |
| 16 | [Database CRUD](16-database-crud/) | Intermediate→Advanced | Database | DB built-ins |

## Examples by Complexity

### Beginner (Start Here!)
- **01-hello-world** - Basic arithmetic, pure functions
- **02-recursion** - Pattern matching, recursion basics

### Intermediate
- **03-string-processing** - Effects, tail recursion, string operations
- **04-file-io** - FileSystem effect, file operations
- **06-math-toolkit** - Pure math functions, test suite
- **07-string-toolkit** - String manipulation, character operations
- **08-json-api** - HTTP requests, JSON parsing
- **09-csv-processor** - Text parsing, data transformation
- **10-config-parser** - INI/TOML parsing
- **11-todo-cli** - CLI application, persistence
- **12-log-analyzer** - Log parsing, aggregation
- **13-template-engine** - String interpolation, templates
- **14-tic-tac-toe** - Game logic, AI
- **16-database-crud** - Database operations

### Advanced
- **05-sudoku-solver** - Backtracking algorithms, 2D grids
- **15-web-server** - HTTP server, routing
- **17-linear-regression** - Numerical computing, ML
- **18-merkle-tree** - Cryptography, tree structures
- **19-json-parser** - Recursive descent parsing
- **20-expr-evaluator** - Lexer, parser, interpreter

## Examples by Category

### Fundamentals
- 01-hello-world, 02-recursion

### Text Processing
- 03-string-processing, 07-string-toolkit, 13-template-engine

### Data Processing
- 09-csv-processor, 10-config-parser, 12-log-analyzer

### Network & Web
- 08-json-api, 15-web-server

### Persistence
- 04-file-io, 11-todo-cli, 16-database-crud

### Algorithms
- 05-sudoku-solver, 06-math-toolkit, 14-tic-tac-toe

### Advanced Topics
- 17-linear-regression (ML)
- 18-merkle-tree (Crypto)
- 19-json-parser (Parsing)
- 20-expr-evaluator (Compilers)

## Examples by Effect

### Pure Functions (No Effects)
- 01-hello-world, 02-recursion, 06-math-toolkit

### FileSystem Effect
- 03-string-processing (stdin), 04-file-io, 05-sudoku-solver, 09-csv-processor, 10-config-parser, 11-todo-cli

### Log Effect
- 03-string-processing, 04-file-io, 05-sudoku-solver, 06-math-toolkit (Test), 08-json-api, 11-todo-cli, 12-log-analyzer, 14-tic-tac-toe, 16-database-crud

### Network Effect
- 08-json-api (HTTP client), 15-web-server (HTTP server)

### DB Effect
- 16-database-crud

### Random Effect
- 14-tic-tac-toe (AI)

### Test Effect
- 05-sudoku-solver, 06-math-toolkit, 07-string-toolkit, 17-linear-regression, 19-json-parser, 20-expr-evaluator

## Language Requirements Gap (Examples-Driven)

The examples in this directory are treated as requirements for Clarity. This section tracks the gap between:

1. what the examples require, and
2. what the language/runtime currently provides.

### ✅ Requirements satisfied today

- 17/20 examples are fully implemented and type-check in the current toolchain.
- Core enablers are present: `Map<K, V>`, `split`, `char_code`/`char_from_code`, list/map transforms, `sha256`, `Timestamp`, effect system, and test runner.

### 🚧 Remaining hard gaps (blocking unimplemented examples)

| Gap | Blocks | Why it matters |
|-----|--------|----------------|
| **HTTP client built-ins** (`http_get`, `http_post`) | 08 | Required to make outbound API requests under `effect[Network]`. |
| **JSON runtime built-ins** (`json_parse`, `json_stringify`, typed `JsonValue`) | 08 | Needed for general API payload handling (beyond example-level parsers). |
| **HTTP server built-ins** (`http_listen`, request/response host bridge) | 15 | Required for long-running network services and routing examples. |
| **DB built-ins** (`db_query`, `db_execute`, typed DB errors) | 16 | Required for relational CRUD workflows under `effect[DB]`. |

### ⚙️ Secondary gaps (not blocking current 17 implemented examples)

| Gap | Notes |
|-----|------|
| **Structured DateTime parsing/format directives** | `Timestamp` exists; richer parse/format APIs are still a capability gap for log/time-heavy workloads. |
| **Regex built-ins** | Current examples show regex-free alternatives; regex would improve ergonomics and portability of parsing tasks. |
| **Closures/lambdas** | Named-function HOFs work, but closures would simplify callback-heavy server/database code. |

## Next Implementation Roadmap (examples-first)

### Milestone A — Finish example 08 (JSON API client)

1. ✅ Added `http_get(url)` and `http_post(url, body)` under `effect[Network]`.
2. Add built-in JSON runtime surface:
   - `json_parse(s) -> Result<JsonValue, String>`
   - `json_stringify(v) -> String`
3. Add e2e tests for parse failure paths and JSON traversal.

### Milestone B — Unlock example 15 (Web server)

4. 🚧 Started HTTP server surface with `http_listen(port)` scaffold (currently returns not-implemented).
4. Add `http_listen(port, handler)` with named-handler callback support.
5. Add host bridge types (`Request`, `Response`) and header map helpers.
6. Add integration tests for routing and status/header correctness.

### Milestone C — Unlock example 16 (Database CRUD)

7. 🚧 Started DB surface with `db_execute(sql, params)` and `db_query(sql, params)` scaffolds (currently return not-implemented).
7. Add `db_execute(sql, params)` and `db_query(sql, params)` under `effect[DB]`.
8. Define stable `DbError` shape and row-to-map conversion semantics.
9. Add CRUD e2e tests (create/read/update/delete + error handling).

### Suggested next task

**Next task: complete Milestone A by implementing JSON runtime built-ins (`json_parse`/`json_stringify`) and update example 08 from partially blocked to implemented.**

## Recently Implemented Examples

### ✅ 06-math-toolkit (16 tests)

**Implemented with:**
- Factorial, GCD, LCM, prime checking, integer exponentiation
- Fibonacci (both naive and tail-recursive)
- Euclidean distance, hypotenuse, circle area, triangle area
- List operations: sum, mean, product
- Comprehensive test suite demonstrating pure functional programming

### ✅ 10-config-parser (12 tests)

**Implemented with:**
- INI file parsing with `split()` builtin
- Comment handling (# and ;)
- Key-value storage using `List<ConfigEntry>`
- Whitespace trimming and validation
- Values containing '=' character

### ✅ 20-expr-evaluator (9 tests)

**Implemented with:**
- Full lexer tokenizing numbers, operators, parentheses
- Recursive descent parser with operator precedence
- AST evaluator computing numeric results
- Demonstrates all phases of a simple interpreter

### ✅ 11-todo-cli (21 tests)

**Implemented with:**
- Pipe-delimited persistence format (`id|done|text`) using file I/O
- `Map<String, String>` for in-memory storage
- Commands: add, list, done, delete, help
- Argument parsing from `get_args()`
- Serialize/deserialize round-trip tested

### ✅ 12-log-analyzer (22 tests)

**Implemented with:**
- Apache/Nginx Common Log Format parsing (no regex — pure string ops)
- IP extraction from first whitespace-delimited field
- Status code extraction by scanning past the quoted request field
- `Map<String, Int64>` for per-IP and per-status-code counts
- Error detection (4xx/5xx) and error count aggregation
- Reads log file content; reports total/valid/error line counts

### ✅ 13-template-engine (12 tests)

**Implemented with:**
- `{{key}}` placeholder substitution using `contains` + `index_of`
- `Map<String, String>` variable store
- Unknown placeholders preserved in output
- Key extraction and deduplication
- Recursive rendering handles adjacent and repeated placeholders

### ✅ 19-json-parser (17 tests)

**Implemented with:**
- Flat JSON object parser: `{" key": "value", "count": 42}`
- Parses strings (with escape sequences), numbers, booleans, null
- Returns `Map<String, String>` (all values as their raw string repr)
- Uses `char_code()` for digit classification
- No regex — pure recursive descent string processing

## Contributing New Examples

When adding examples to this catalog:

1. **Create subdirectory:** `examples/NN-example-name/`
2. **Add README.md** with:
   - Description
   - Required language features (with ✅/❌ status)
   - Ideal implementation (show what code SHOULD look like)
   - Learning objectives
   - Dependencies
3. **Update this root README** with links and status
4. **If blocked:** Document missing features in "Language Requirements Gap" section
5. **If ready:** Implement the .clarity file and tests

## Example Structure

Each example directory should contain:

```
NN-example-name/
├── README.md          # Documentation, requirements, usage
├── example.clarity    # Implementation (if not blocked)
├── input.txt          # Sample input (if needed)
└── expected.txt       # Expected output (if applicable)
```

## Navigation

### Implemented Examples
- [01-hello-world](01-hello-world/) - ✅ Start here if you're new to Clarity
- [02-recursion](02-recursion/) - ✅ Learn pattern matching and recursion
- [03-string-processing](03-string-processing/) - ✅ Effects and string operations
- [04-file-io](04-file-io/) - ✅ File reading and writing
- [05-sudoku-solver](05-sudoku-solver/) - ✅ Backtracking algorithms (8 tests)
- [06-math-toolkit](06-math-toolkit/) - ✅ Pure math functions (16 tests)
- [07-string-toolkit](07-string-toolkit/) - ✅ String manipulation (13 tests, partial)
- [09-csv-processor](09-csv-processor/) - ✅ CSV parsing (9 tests)
- [10-config-parser](10-config-parser/) - ✅ INI parsing (12 tests)
- [11-todo-cli](11-todo-cli/) - ✅ Todo CLI with persistence (21 tests)
- [12-log-analyzer](12-log-analyzer/) - ✅ Apache log analysis (22 tests)
- [13-template-engine](13-template-engine/) - ✅ Template rendering (12 tests)
- [14-tic-tac-toe](14-tic-tac-toe/) - ✅ Game AI with minimax (8 tests)
- [17-linear-regression](17-linear-regression/) - ✅ ML/numeric computing (6 tests)
- [18-merkle-tree](18-merkle-tree/) - ✅ Cryptography (12 tests)
- [19-json-parser](19-json-parser/) - ✅ Flat JSON object parser (17 tests)
- [20-expr-evaluator](20-expr-evaluator/) - ✅ Lexer/parser/interpreter (9 tests)

### Requirements (Not Yet Implemented)
- [08-json-api](08-json-api/) - **REQUIRES:** HTTP client
- [15-web-server](15-web-server/) - **REQUIRES:** HTTP server
- [16-database-crud](16-database-crud/) - **REQUIRES:** DB built-ins

## Questions or Feedback?

This examples catalog is a living document. If you:
- Find a bug in a working example
- Have ideas for new examples
- Want to implement a documented requirement
- Think a missing feature should be prioritized

Please open an issue or discussion in the clarity-compiler repository.

---

**Last updated:** 2026-02-20
**Total examples:** 20 (17 implemented, 3 requirements)
**Total tests:** 165 (across all implemented examples with test suites)
