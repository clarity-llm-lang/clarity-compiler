// ---------------------------------------------------------------------------
// Binary and unary operator type checking helpers.
// These are pure functions of diagnostics + operand types — no class state needed.
// ---------------------------------------------------------------------------
import type { Diagnostic, Span } from "../errors/diagnostic.js";
import { error } from "../errors/diagnostic.js";
import type { ClarityType } from "./types.js";
import {
  INT64, FLOAT64, BOOL, STRING, ERROR_TYPE,
  typesEqual, typeToString,
} from "./types.js";

export function checkBinaryOp(
  diagnostics: Diagnostic[],
  op: string,
  left: ClarityType,
  right: ClarityType,
  span: Span,
): ClarityType {
  if (left.kind === "Error" || right.kind === "Error") return ERROR_TYPE;

  // Arithmetic: +, -, *, /, %
  if (["+", "-", "*", "/", "%"].includes(op)) {
    if (left.kind === "Int64" && right.kind === "Int64") return INT64;
    if (left.kind === "Float64" && right.kind === "Float64") return FLOAT64;
    // Allow Int64 + Float64 -> Float64
    if (
      (left.kind === "Int64" && right.kind === "Float64") ||
      (left.kind === "Float64" && right.kind === "Int64")
    ) {
      diagnostics.push(
        error(
          `Cannot mix Int64 and Float64 in arithmetic`,
          span,
          "Clarity does not have implicit numeric conversions. Convert explicitly.",
        ),
      );
      return ERROR_TYPE;
    }
    diagnostics.push(
      error(`Operator '${op}' requires numeric types, got ${typeToString(left)} and ${typeToString(right)}`, span),
    );
    return ERROR_TYPE;
  }

  // String concat: ++
  if (op === "++") {
    if (left.kind === "String" && right.kind === "String") return STRING;
    diagnostics.push(
      error(`Operator '++' requires String types, got ${typeToString(left)} and ${typeToString(right)}`, span),
    );
    return ERROR_TYPE;
  }

  // Comparison: ==, !=, <, >, <=, >=
  if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
    if (!typesEqual(left, right)) {
      diagnostics.push(
        error(
          `Cannot compare ${typeToString(left)} and ${typeToString(right)}`,
          span,
          "Both sides of a comparison must have the same type",
        ),
      );
      return ERROR_TYPE;
    }
    return BOOL;
  }

  // Logical: and, or
  if (op === "and" || op === "or") {
    if (left.kind === "Bool" && right.kind === "Bool") return BOOL;
    diagnostics.push(
      error(`Operator '${op}' requires Bool types, got ${typeToString(left)} and ${typeToString(right)}`, span),
    );
    return ERROR_TYPE;
  }

  diagnostics.push(error(`Unknown operator '${op}'`, span));
  return ERROR_TYPE;
}

export function checkUnaryOp(
  diagnostics: Diagnostic[],
  op: string,
  operand: ClarityType,
  span: Span,
): ClarityType {
  if (operand.kind === "Error") return ERROR_TYPE;

  if (op === "-") {
    if (operand.kind === "Int64") return INT64;
    if (operand.kind === "Float64") return FLOAT64;
    diagnostics.push(
      error(`Unary '-' requires numeric type, got ${typeToString(operand)}`, span),
    );
    return ERROR_TYPE;
  }

  if (op === "!") {
    if (operand.kind === "Bool") return BOOL;
    diagnostics.push(
      error(`Unary '!' requires Bool type, got ${typeToString(operand)}`, span),
    );
    return ERROR_TYPE;
  }

  return ERROR_TYPE;
}
