# CSV Processor

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Intermediate
**Category:** Data Processing, Text Parsing

## Overview

Read CSV files, parse rows, filter by column values, and compute statistics. Demonstrates text parsing and functional list operations. Includes 9 tests covering parsing, filtering, and statistics.

## Required Language Features

### 1. String Splitting

```clarity
function string_split(s: String, delimiter: String) -> List<String>

// Example:
let line = "John,Doe,30,Engineer";
let fields = string_split(line, ",");  // ["John", "Doe", "30", "Engineer"]
```

### 2. Map/Filter/Reduce for Lists

```clarity
function map<A, B>(list: List<A>, f: (A) -> B) -> List<B>
function filter<T>(list: List<T>, predicate: (T) -> Bool) -> List<T>
function reduce<T, R>(list: List<T>, init: R, f: (R, T) -> R) -> R

// Or list comprehensions:
let ages = [int_to_string(row.age) | row <- people, row.age > 18];
```

## Example Use Case

```clarity
type Person = {
  name: String,
  age: Int64,
  city: String
}

effect[FileSystem, Log] function process_csv(filename: String) -> Unit {
  let content = read_file(filename);
  let lines = string_split(content, "\n");
  let rows = map(lines, parse_csv_row);

  // Filter people over 30
  let adults = filter(rows, is_adult);

  // Calculate average age
  let ages = map(adults, get_age);
  let total = reduce(ages, 0, add_int);
  let avg = total / length(ages);

  print_int(avg)
}

function parse_csv_row(line: String) -> Person {
  let fields = string_split(line, ",");
  {
    name: head(fields),
    age: string_to_int(head(tail(fields))),
    city: head(tail(tail(fields)))
  }
}

function is_adult(person: Person) -> Bool {
  person.age > 30
}

function get_age(person: Person) -> Int64 {
  person.age
}

function add_int(a: Int64, b: Int64) -> Int64 {
  a + b
}
```

## Learning Objectives

- CSV parsing with string_split
- Functional list processing (map, filter, reduce)
- Working with records/structs
- Data transformation pipelines

## Dependencies

- ❌ `string_split` (CRITICAL)
- ❌ `map`/`filter`/`reduce` or list comprehensions (HIGH)
- ✅ File I/O (already available)
- ✅ Records (already available)
