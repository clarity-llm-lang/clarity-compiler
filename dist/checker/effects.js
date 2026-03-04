import { error } from "../errors/diagnostic.js";
import { getKnownEffectNames } from "../registry/builtins-registry.js";
export const KNOWN_EFFECTS = getKnownEffectNames();
export function validateEffectNames(effects, span) {
    const diagnostics = [];
    for (const eff of effects) {
        if (!KNOWN_EFFECTS.has(eff)) {
            diagnostics.push(error(`Unknown effect '${eff}'`, span, `Known effects are: ${[...KNOWN_EFFECTS].join(", ")}`));
        }
    }
    return diagnostics;
}
export function checkEffectSafety(callerEffects, calleeEffects, callSpan) {
    const missing = [...calleeEffects].filter((e) => !callerEffects.has(e));
    if (missing.length > 0) {
        return [
            error(`Called function requires effects [${missing.join(", ")}] but caller only declares [${[...callerEffects].join(", ") || "none"}]`, callSpan, `Add the missing effects to the caller's effect annotation: effect[${[...callerEffects, ...missing].join(", ")}]`),
        ];
    }
    return [];
}
//# sourceMappingURL=effects.js.map