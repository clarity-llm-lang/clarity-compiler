# CSV Processor

**Status:** ✅ **IMPLEMENTED**
**Complexity:** Intermediate
**Category:** Data Processing, Text Parsing

## Overview

Parse CSV files, extract fields, filter rows, and compute statistics. Demonstrates text parsing with `split()` builtin and functional list operations using recursion. Includes 9 tests covering parsing, filtering, and statistics.

## Implementation Notes

This example uses Clarity's `split()` builtin to parse CSV lines and custom recursive functions to implement map/filter/reduce patterns. Demonstrates practical data processing without requiring higher-order list functions or list comprehensions.

### Key Features

- ✅ **CSV parsing** - Split lines by delimiter with `split()`
- ✅ **Field extraction** - Access specific columns by index
- ✅ **Row filtering** - Custom filter functions using recursion
- ✅ **Statistics** - Compute sum, average, min, max
- ✅ **Type conversion** - Parse numeric fields with `string_to_int()`
- ✅ **Record types** - Represent rows as structured data

## Usage

```bash
# Compile
npx clarityc compile examples/09-csv-processor/csv.clarity --check-only

# Run tests (9 tests covering parsing and statistics)
npx clarityc test examples/09-csv-processor/csv.clarity

# Run demo
npx clarityc run examples/09-csv-processor/csv.clarity -f demo
```

### Sample Output
```
CSV Processor Demo
==================

Parsed 3 rows
Total score: 270
Average score: 90
Highest score: 95
Lowest score: 85
```

## Test Coverage

The example includes 9 comprehensive tests:
- `test_parse_csv_line` - Basic CSV line parsing
- `test_parse_multiple_fields` - Multi-field parsing
- `test_get_field` - Field extraction by index
- `test_filter_rows` - Row filtering by predicate
- `test_count_rows` - Row counting
- `test_sum_column` - Column sum computation
- `test_average` - Average calculation
- `test_min_max` - Minimum/maximum finding
- `test_empty_csv` - Edge case handling

## Learning Objectives

Studying this example teaches:

1. **CSV parsing** - Splitting text by delimiters
2. **Functional list processing** - Map/filter/reduce patterns using recursion
3. **Working with records** - Structured data representation
4. **Data transformation pipelines** - Multi-step data processing
5. **Type conversion** - String to numeric conversion with `string_to_int()`
6. **Option type handling** - Safe field access with fallbacks

## Related Examples

- `07-string-toolkit` - String manipulation functions
- `10-config-parser` - Another text parsing example
- `03-string-processing` - String processing with recursion

## Dependencies Used

- ✅ **`split()`** - String splitting by delimiter
- ✅ **`string_to_int()`** - Numeric parsing with Option<Int64>
- ✅ **List operations** - head, tail, append, length
- ✅ **Records** - Structured data types
- ✅ **Recursion** - Implementing map/filter/reduce patterns
