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

### ✅ Implemented Examples (16 total)

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
| 11 | [Todo CLI](11-todo-cli/) | Intermediate | CLI, CRUD | 14 | ✅ Implemented |
| 13 | [Template Engine](13-template-engine/) | Intermediate | Text | 12 | ✅ Implemented |
| 14 | [Tic-Tac-Toe](14-tic-tac-toe/) | Intermediate | Games, AI | 8 | ✅ Implemented |
| 17 | [Linear Regression](17-linear-regression/) | Advanced | ML, Numeric | 6 | ✅ Implemented |
| 18 | [Merkle Tree](18-merkle-tree/) | Advanced | Blockchain, Crypto | 12 | ✅ Implemented |
| 19 | [JSON Parser](19-json-parser/) | Advanced | Parsing | 17 | ✅ Implemented |
| 20 | [Expression Evaluator](20-expr-evaluator/) | Advanced | Compilers | 9 | ✅ Implemented |

\* *String Toolkit: Implemented without case conversion (requires `char_code()` builtin)*

### 📋 Requirements Documentation (4 remaining)

| # | Name | Complexity | Category | Blocked By |
|---|------|------------|----------|------------|
| 08 | [JSON API Client](08-json-api/) | Intermediate | Network | HTTP client |
| 12 | [Log Analyzer](12-log-analyzer/) | Intermediate→Advanced | Analysis | Regex |
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

## Missing Language Features

Based on the examples catalog, Clarity needs these features to be production-ready:

### 🚨 Critical (Blocking Basic Examples)

| Feature | Required By | Priority | Impact |
|---------|-------------|----------|--------|
| **Array<T> with indexed access** | 05, 14, 17 | CRITICAL | Enables algorithms requiring O(1) random access |
| **char_code / char_from_code** | 07, 19 | CRITICAL | Enables case conversion, character classification |
| **parse_int returning Result** | 05, many | CRITICAL | Proper error handling for parsing |

### ⚠️ High Priority (Needed for Real Applications)

| Feature | Required By | Priority | Impact |
|---------|-------------|----------|--------|
| **Map<K, V> type** | 08, 10, 11, 12, 15, 16, 19 | HIGH | Key-value storage, configuration, JSON objects |
| **string_split** | 07, 09, 10, many | HIGH | Text parsing, CSV, configuration |
| **JSON support** | 08, 11 | HIGH | API clients, data serialization |
| **HTTP client** | 08 | HIGH | REST APIs, web services |
| **Regex** | 10, 12 | HIGH | Pattern matching, log parsing |

### 📊 Medium Priority (Ergonomics & Advanced Features)

| Feature | Required By | Priority | Impact |
|---------|-------------|----------|--------|
| **String interpolation** | 13 | MEDIUM | Cleaner string construction |
| **map/filter/reduce** | 09 | MEDIUM | Functional list operations |
| **Set<T>** | - | MEDIUM | Unique collections |
| **Tuple types** | - | MEDIUM | Fixed-size heterogeneous data |
| **DateTime type** | 12 | MEDIUM | Time parsing, arithmetic |
| **Random numbers** | 14 | MEDIUM | Games, simulations |
| **HTTP server** | 15 | MEDIUM | Web applications |
| **DB built-ins** | 16 | MEDIUM | Database operations |
| **Matrix type** | 17 | MEDIUM | Numerical computing, ML |
| **Crypto (sha256, etc.)** | 18 | MEDIUM | Blockchain, security |

### 💡 Low Priority (Nice to Have)

- Multi-line strings
- Destructuring syntax
- Async/await
- Streaming I/O
- List comprehensions

## Implementation Roadmap

### Phase 1: Critical Language Features (Q1 2026)

**Goal:** Enable examples 05-07

1. ✅ **Add Array<T> type**
   ```clarity
   type Array<T>
   function array_new<T>(size: Int64, initial: T) -> Array<T>
   function array_get<T>(arr: Array<T>, index: Int64) -> Option<T>
   function array_set<T>(arr: Array<T>, index: Int64, value: T) -> Array<T>
   ```
   - Enables: Sudoku solver, Tic-Tac-Toe, Linear Regression

2. ✅ **Add char_code operations**
   ```clarity
   function char_code(ch: String) -> Int64
   function char_from_code(code: Int64) -> String
   ```
   - Enables: String toolkit, JSON parser

3. ✅ **Improve parse_int/parse_float**
   ```clarity
   function parse_int(s: String) -> Result<Int64, String>
   function parse_float(s: String) -> Result<Float64, String>
   ```
   - Enables: Better error handling everywhere

### Phase 2: Data Structures (Q2 2026)

**Goal:** Enable examples 08-13

4. ✅ **Add Map<K, V> type**
   - Enables: JSON API, Config Parser, Todo CLI, Log Analyzer, Web Server, DB CRUD

5. ✅ **Add string_split**
   - Enables: CSV Processor, Config Parser, many text processing tasks

6. ✅ **Add map/filter/reduce**
   - Enables: Functional data processing patterns

### Phase 3: I/O & Network (Q3 2026)

**Goal:** Enable examples 08, 15, 16

7. ✅ **Add HTTP client** (Network effect)
8. ✅ **Add JSON parsing** (json_parse, json_stringify)
9. ✅ **Add HTTP server** (Network effect)
10. ✅ **Add DB operations** (DB effect)

### Phase 4: Advanced Features (Q4 2026)

**Goal:** Enable examples 12, 17, 18

11. ✅ **Add Regex support**
12. ✅ **Add Matrix operations**
13. ✅ **Add Crypto functions** (sha256, etc.)
14. ✅ **Add DateTime support**

### Phase 5: Polish & Ergonomics (2027)

15. ✅ String interpolation
16. ✅ Random number generation
17. ✅ Multi-line strings
18. ✅ Set<T> type
19. ✅ Async/await
20. ✅ Streaming I/O

## Recently Implemented Examples

### ✅ 11-todo-cli (14 tests)

**Implemented with:**
- `Map<String, String>` for in-memory todo storage (key = string ID, value = encoded entry)
- Tab-separated text format for file persistence (`id\ttext|done`)
- Union type `Command` for structured dispatch on CLI arguments
- `get_args()`, `read_file`, `write_file` for full CLI application lifecycle
- `last_index_of` helper to support `|` characters in todo text

### ✅ 13-template-engine (12 tests)

**Implemented with:**
- `{{key}}` placeholder substitution using `Map<String, String>`
- Handles unknown keys (preserves original placeholder)
- Recursive template rendering with `map_get` lookups
- HTML/text template examples

### ✅ 19-json-parser (17 tests)

**Implemented with:**
- Recursive descent parser for flat JSON objects → `Map<String, String>`
- `char_code()` for character classification (digit, whitespace)
- Handles strings with escape sequences, numbers, booleans, null
- Error signaling via sentinel `next_pos = -1`

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
4. **If blocked:** Document missing features in "Missing Language Features" section
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
- [11-todo-cli](11-todo-cli/) - ✅ Todo CRUD with file persistence (14 tests)
- [13-template-engine](13-template-engine/) - ✅ {{key}} template substitution (12 tests)
- [14-tic-tac-toe](14-tic-tac-toe/) - ✅ Game AI with minimax (8 tests)
- [17-linear-regression](17-linear-regression/) - ✅ ML/numeric computing (6 tests)
- [18-merkle-tree](18-merkle-tree/) - ✅ Cryptography (12 tests)
- [19-json-parser](19-json-parser/) - ✅ Recursive JSON object parser (17 tests)
- [20-expr-evaluator](20-expr-evaluator/) - ✅ Lexer/parser/interpreter (9 tests)

### Requirements (Not Yet Implemented)
- [08-json-api](08-json-api/) - **REQUIRES:** HTTP client
- [12-log-analyzer](12-log-analyzer/) - **REQUIRES:** Regex
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
**Total examples:** 20 (16 implemented, 4 requirements)
**Total tests:** 136 (across all implemented examples with test suites)
