import binaryen from "binaryen";
import type { ClarityType } from "../checker/types.js";

export function clarityTypeToWasm(type: ClarityType): binaryen.Type {
  switch (type.kind) {
    case "Int64": return binaryen.i64;
    case "Float64": return binaryen.f64;
    case "Bool": return binaryen.i32;
    case "Unit": return binaryen.none;
    case "Timestamp": return binaryen.i64; // milliseconds since epoch
    // Pointer types → i32 into linear memory
    case "Record":
    case "Union":
    case "String":
    case "Bytes":
    case "List":
    case "Map":    // Map handle (opaque i32)
    case "Option":
    case "Result":
    case "Function":
    case "TypeVar":
      return binaryen.i32;
    default:
      return binaryen.i32;
  }
}

export function isNumericType(type: ClarityType): boolean {
  return type.kind === "Int64" || type.kind === "Float64";
}

export function isI64(type: ClarityType): boolean {
  return type.kind === "Int64";
}

export function isF64(type: ClarityType): boolean {
  return type.kind === "Float64";
}
