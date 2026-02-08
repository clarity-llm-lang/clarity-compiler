import type { Span } from "../errors/diagnostic.js";
import type { Diagnostic } from "../errors/diagnostic.js";
import { error } from "../errors/diagnostic.js";
import type { ClarityType, ClarityVariant } from "./types.js";
import type { Pattern } from "../ast/nodes.js";

export function checkExhaustiveness(
  scrutineeType: ClarityType,
  patterns: Pattern[],
  span: Span,
): Diagnostic[] {
  // Wildcard or binding pattern covers everything
  if (patterns.some((p) => p.kind === "WildcardPattern" || p.kind === "BindingPattern")) {
    return [];
  }

  if (scrutineeType.kind === "Bool") {
    return checkBoolExhaustiveness(patterns, span);
  }

  if (scrutineeType.kind === "Union") {
    return checkUnionExhaustiveness(scrutineeType.variants, patterns, span);
  }

  // For other types, we can't easily check exhaustiveness in MVP
  return [];
}

function checkBoolExhaustiveness(patterns: Pattern[], span: Span): Diagnostic[] {
  let hasTrue = false;
  let hasFalse = false;

  for (const p of patterns) {
    if (p.kind === "LiteralPattern" && p.value.kind === "BoolLiteral") {
      if (p.value.value) hasTrue = true;
      else hasFalse = true;
    }
  }

  const missing: string[] = [];
  if (!hasTrue) missing.push("True");
  if (!hasFalse) missing.push("False");

  if (missing.length > 0) {
    return [
      error(
        `Non-exhaustive match: missing pattern(s) for ${missing.join(", ")}`,
        span,
        `Add match arm(s) for: ${missing.join(", ")}`,
      ),
    ];
  }
  return [];
}

function checkUnionExhaustiveness(
  variants: ClarityVariant[],
  patterns: Pattern[],
  span: Span,
): Diagnostic[] {
  const coveredVariants = new Set<string>();

  for (const p of patterns) {
    if (p.kind === "ConstructorPattern") {
      coveredVariants.add(p.name);
    }
  }

  const missing = variants
    .map((v) => v.name)
    .filter((name) => !coveredVariants.has(name));

  if (missing.length > 0) {
    return [
      error(
        `Non-exhaustive match: missing pattern(s) for variant(s) ${missing.join(", ")}`,
        span,
        `Add match arm(s) for: ${missing.join(", ")}`,
      ),
    ];
  }
  return [];
}
