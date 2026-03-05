// ---------------------------------------------------------------------------
// Mutual tail-recursion warning helpers.
// Only needs diagnostics[] from the class — extracted as pure functions.
// ---------------------------------------------------------------------------
import type { Diagnostic } from "../errors/diagnostic.js";
import { warning } from "../errors/diagnostic.js";
import type { FunctionDecl, Expr } from "../ast/nodes.js";

// Collect the set of names called directly in tail position of expr.
export function tailCallees(expr: Expr): Set<string> {
  const result = new Set<string>();
  switch (expr.kind) {
    case "CallExpr":
      if (expr.callee.kind === "IdentifierExpr") {
        result.add(expr.callee.name);
      }
      break;
    case "BlockExpr":
      if (expr.result) {
        for (const n of tailCallees(expr.result)) result.add(n);
      }
      break;
    case "MatchExpr":
      for (const arm of expr.arms) {
        for (const n of tailCallees(arm.body)) result.add(n);
      }
      break;
    default:
      break;
  }
  return result;
}

// Detect pairs of local functions that mutually tail-call each other (A→B and B→A)
// and emit a warning for each such pair. Only local (module-level) functions are checked.
export function warnMutualTailRecursion(
  diagnostics: Diagnostic[],
  decls: FunctionDecl[],
  localFuncNames: Set<string>,
): void {
  // Build tail-call map: funcName → set of local functions it tail-calls (excluding itself)
  const tailCallMap = new Map<string, Set<string>>();
  for (const decl of decls) {
    const callees = new Set<string>();
    for (const callee of tailCallees(decl.body)) {
      if (callee !== decl.name && localFuncNames.has(callee)) {
        callees.add(callee);
      }
    }
    tailCallMap.set(decl.name, callees);
  }

  // Warn for each pair (A, B) where A tail-calls B AND B tail-calls A
  const warned = new Set<string>();
  for (const decl of decls) {
    const aCallees = tailCallMap.get(decl.name) ?? new Set();
    for (const b of aCallees) {
      const bCallees = tailCallMap.get(b) ?? new Set();
      if (bCallees.has(decl.name)) {
        // Mutual tail recursion: decl.name ↔ b
        const pairKey = [decl.name, b].sort().join(":");
        if (!warned.has(pairKey)) {
          warned.add(pairKey);
          diagnostics.push(
            warning(
              `Mutual tail recursion between '${decl.name}' and '${b}' cannot be tail-call optimised and may stack-overflow on deep inputs.`,
              decl.span,
              `Consider restructuring '${decl.name}' and '${b}' to use an explicit accumulator or a shared helper with an iterative loop.`,
            ),
          );
        }
      }
    }
  }
}
