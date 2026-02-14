# File I/O Operations

**Complexity:** Intermediate
**Category:** File System, Effects

## Description

A simple file copy utility demonstrating file reading and writing with the FileSystem effect. Shows how to work with command-line arguments and handle file operations.

## What This Example Demonstrates

- **File reading** (`read_file`)
- **File writing** (`write_file`)
- **Command-line arguments** (`get_args`)
- **FileSystem effect** for file operations
- **Log effect** for printing status
- **Function wrapper pattern** (main → copy)

## Features Used

- **Language Features:**
  - Effect declarations (`effect[FileSystem, Log]`)
  - Multiple effects in one function
  - Function composition (main calls copy)
  - String arguments

- **Built-in Functions:**
  - `read_file(path: String) -> String` (FileSystem)
  - `write_file(path: String, content: String) -> Unit` (FileSystem)
  - `print_string(s: String) -> Unit` (Log)
  - String concatenation `++`

- **Effects:** `FileSystem`, `Log`

## Usage

### Compile

```bash
npx clarityc compile examples/04-file-io/file_copy.clarity
```

### Run file copy

```bash
# Copy source.txt to dest.txt
npx clarityc run examples/04-file-io/file_copy.clarity -f main -a '"source.txt"' '"dest.txt"'

# Copy with relative paths
npx clarityc run examples/04-file-io/file_copy.clarity -f main -a '"../data/input.txt"' '"output.txt"'

# Copy with absolute paths
npx clarityc run examples/04-file-io/file_copy.clarity -f main -a '"/tmp/file1.txt"' '"/tmp/file2.txt"'
```

**Note:** Arguments must be quoted strings in shell: `'"filename.txt"'`

### Example

```bash
# Create a test file
echo "Hello, Clarity!" > test.txt

# Copy it
npx clarityc run examples/04-file-io/file_copy.clarity -f main -a '"test.txt"' '"test_copy.txt"'

# Verify
cat test_copy.txt
# Output: Hello, Clarity!
```

## Code Walkthrough

### Core Copy Logic

```clarity
function copy(src: String, dst: String) -> Unit {
  let content = read_file(src);    // Read entire source file
  write_file(dst, content);        // Write to destination
  print_string("Copied " ++ src ++ " to " ++ dst)
}
```

**How it works:**
1. `read_file(src)` reads entire source file into memory as String
2. `write_file(dst, content)` writes String to destination file
3. `print_string` confirms operation

### Main Entry Point

```clarity
effect[FileSystem, Log] function main(src: String, dst: String) -> Unit {
  copy(src, dst)
}
```

**Wrapper pattern:**
- `main` is the entry point that accepts arguments
- It delegates to `copy` for the actual logic
- Separates concerns (argument handling vs core logic)

## FileSystem Effect

Functions that access the file system must declare `effect[FileSystem]`:

```clarity
effect[FileSystem] function read_config(path: String) -> String {
  read_file(path)
}

effect[FileSystem] function save_data(path: String, data: String) -> Unit {
  write_file(path, data)
}
```

### Available FileSystem Built-ins

- `read_file(path: String) -> String` - Read entire file
- `write_file(path: String, content: String) -> Unit` - Write entire file
- `read_line() -> String` - Read one line from stdin
- `read_all_stdin() -> String` - Read all stdin
- `get_args() -> List<String>` - Get command-line arguments
- `exit(code: Int64) -> Unit` - Exit with status code

## Error Handling

**Current behavior:** If file operations fail (file not found, permission denied), the program crashes with an error message.

**Future improvement:** Once Clarity adds better Result types, file operations should return:
```clarity
function read_file(path: String) -> Result<String, FileError>
```

This would allow graceful error handling with pattern matching.

## Memory Considerations

**Note:** `read_file` and `write_file` load/write entire files into memory. For large files, this may not be suitable.

**Future improvement:** Streaming I/O operations would allow processing large files incrementally:
```clarity
function read_lines(path: String) -> Stream<String>
function write_lines(path: String, lines: Stream<String>) -> Unit
```

## Learning Objectives

After studying this example, you should understand:

1. How to use the FileSystem effect for file operations
2. How to read and write files in Clarity
3. How command-line arguments work
4. The wrapper pattern for entry point functions
5. When to use multiple effects in one function
6. Current limitations (no streaming, basic error handling)

## Pattern: Entry Point with Arguments

For programs that accept command-line arguments:

```clarity
effect[FileSystem, Log] function main(arg1: String, arg2: String) -> Unit {
  // Use arg1 and arg2
  process(arg1, arg2)
}
```

Run with:
```bash
npx clarityc run file.clarity -f main -a '"value1"' '"value2"'
```

## Next Steps

- Study `05-sudoku-solver` requirements for complex file parsing
- See `11-todo-cli` requirements for a full CLI application with persistence
- Explore `16-database-crud` requirements for structured data storage
