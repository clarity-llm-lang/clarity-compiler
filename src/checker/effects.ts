import type { Span } from "../errors/diagnostic.js";
import type { Diagnostic } from "../errors/diagnostic.js";
import { error } from "../errors/diagnostic.js";

export const KNOWN_EFFECTS = new Set([
  "DB",
  "Network",
  "Time",
  "Random",
  "Log",
  "FileSystem",
  "Test",
]);

export function validateEffectNames(effects: string[], span: Span): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const eff of effects) {
    if (!KNOWN_EFFECTS.has(eff)) {
      diagnostics.push(
        error(
          `Unknown effect '${eff}'`,
          span,
          `Known effects are: ${[...KNOWN_EFFECTS].join(", ")}`,
        ),
      );
    }
  }
  return diagnostics;
}

export function checkEffectSafety(
  callerEffects: Set<string>,
  calleeEffects: Set<string>,
  callSpan: Span,
): Diagnostic[] {
  const missing = [...calleeEffects].filter((e) => !callerEffects.has(e));
  if (missing.length > 0) {
    return [
      error(
        `Called function requires effects [${missing.join(", ")}] but caller only declares [${[...callerEffects].join(", ") || "none"}]`,
        callSpan,
        `Add the missing effects to the caller's effect annotation: effect[${[...callerEffects, ...missing].join(", ")}]`,
      ),
    ];
  }
  return [];
}
