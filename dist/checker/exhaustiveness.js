import { error, warning } from "../errors/diagnostic.js";
export function checkExhaustiveness(scrutineeType, patterns, span) {
    const diags = [];
    // Range-overlap warnings are emitted regardless of whether a wildcard is present,
    // because overlapping arms are a logic bug even in an otherwise-exhaustive match.
    if (scrutineeType.kind === "Int64") {
        diags.push(...checkRangeOverlaps(patterns, span));
    }
    // Wildcard or (unguarded) binding pattern covers everything — exhaustiveness satisfied.
    // Note: guards live on MatchArm, not on Pattern — they are stripped before
    // reaching here, so a guarded binding like `n if n > 0` still appears as a
    // plain BindingPattern and is (conservatively) treated as exhaustive.
    if (patterns.some((p) => p.kind === "WildcardPattern" || p.kind === "BindingPattern")) {
        return diags; // may still contain range-overlap warnings
    }
    if (scrutineeType.kind === "Bool") {
        return [...diags, ...checkBoolExhaustiveness(patterns, span)];
    }
    if (scrutineeType.kind === "Union") {
        return [...diags, ...checkUnionExhaustiveness(scrutineeType.variants, patterns, span)];
    }
    // Int64: require a wildcard arm when only literal/range patterns are present.
    if (scrutineeType.kind === "Int64") {
        if (patterns.some((p) => p.kind === "LiteralPattern" || p.kind === "RangePattern")) {
            diags.push(error(`Non-exhaustive match on Int64: missing wildcard arm`, span, `Add a wildcard arm to cover all other values: _ -> <expression>`));
        }
        return diags;
    }
    // Other open types (String, Float64, Bytes, Timestamp) cannot be exhaustively
    // covered with literal patterns alone.  Require a wildcard arm.
    if (scrutineeType.kind === "String" ||
        scrutineeType.kind === "Float64" ||
        scrutineeType.kind === "Bytes" ||
        scrutineeType.kind === "Timestamp") {
        if (patterns.some((p) => p.kind === "LiteralPattern")) {
            diags.push(error(`Non-exhaustive match on ${scrutineeType.kind}: missing wildcard arm`, span, `Add a wildcard arm to cover all other values: _ -> <expression>`));
        }
    }
    return diags;
}
function checkBoolExhaustiveness(patterns, span) {
    let hasTrue = false;
    let hasFalse = false;
    for (const p of patterns) {
        if (p.kind === "LiteralPattern" && p.value.kind === "BoolLiteral") {
            if (p.value.value)
                hasTrue = true;
            else
                hasFalse = true;
        }
    }
    const missing = [];
    if (!hasTrue)
        missing.push("True");
    if (!hasFalse)
        missing.push("False");
    if (missing.length > 0) {
        return [
            error(`Non-exhaustive match: missing pattern(s) for ${missing.join(", ")}`, span, `Add match arm(s) for: ${missing.join(", ")}`),
        ];
    }
    return [];
}
function checkUnionExhaustiveness(variants, patterns, span) {
    const coveredVariants = new Set();
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
            error(`Non-exhaustive match: missing pattern(s) for variant(s) ${missing.join(", ")}`, span, `Add match arm(s) for: ${missing.join(", ")}`),
        ];
    }
    return [];
}
// Check for overlapping range patterns in an Int64 match.
// Emitted regardless of whether a wildcard arm is present.
function checkRangeOverlaps(patterns, span) {
    const diags = [];
    const ranges = [];
    for (const p of patterns) {
        if (p.kind === "RangePattern") {
            const start = p.start.value;
            const end = p.end.value;
            ranges.push({ start, end, label: `${start}..${end}` });
        }
    }
    // Check every pair for overlap.  Inclusive ranges [a.start, a.end] and
    // [b.start, b.end] overlap iff  a.start <= b.end  AND  b.start <= a.end.
    for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
            const a = ranges[i];
            const b = ranges[j];
            if (a.start <= b.end && b.start <= a.end) {
                diags.push(warning(`Overlapping range patterns: ${a.label} and ${b.label} share at least one value`, span, `Remove or adjust one of the overlapping range arms`));
            }
        }
    }
    return diags;
}
//# sourceMappingURL=exhaustiveness.js.map