export function collectFreeVars(expr, bound) {
    const free = new Set();
    walkExpr(expr, bound, free);
    return free;
}
export function walkExpr(expr, bound, free) {
    switch (expr.kind) {
        case "IdentifierExpr":
            if (!bound.has(expr.name))
                free.add(expr.name);
            break;
        case "LambdaExpr":
            // Don't recurse into nested lambda bodies — they are independent closures.
            break;
        case "IntLiteral":
        case "FloatLiteral":
        case "StringLiteral":
        case "BoolLiteral":
            break;
        case "ListLiteral":
            for (const el of expr.elements)
                walkExpr(el, bound, free);
            break;
        case "RecordLiteral":
            for (const f of expr.fields)
                walkExpr(f.value, bound, free);
            break;
        case "BinaryExpr":
            walkExpr(expr.left, bound, free);
            walkExpr(expr.right, bound, free);
            break;
        case "UnaryExpr":
            walkExpr(expr.operand, bound, free);
            break;
        case "CallExpr":
            walkExpr(expr.callee, bound, free);
            for (const a of expr.args)
                walkExpr(a.value, bound, free);
            break;
        case "MemberExpr":
            walkExpr(expr.object, bound, free);
            break;
        case "LetExpr": {
            walkExpr(expr.value, bound, free);
            // The let-bound name is NOT yet bound when we evaluate the value,
            // and since LetExpr has no body sub-expression, nothing else to walk.
            break;
        }
        case "AssignmentExpr":
            walkExpr(expr.value, bound, free);
            break;
        case "BlockExpr": {
            // Track locally-bound names introduced by LetExprs in this block.
            const innerBound = new Set(bound);
            for (const stmt of expr.statements) {
                walkExpr(stmt, innerBound, free);
                if (stmt.kind === "LetExpr")
                    innerBound.add(stmt.name);
            }
            if (expr.result)
                walkExpr(expr.result, innerBound, free);
            break;
        }
        case "MatchExpr":
            walkExpr(expr.scrutinee, bound, free);
            for (const arm of expr.arms) {
                const armBound = new Set(bound);
                collectPatternBindings(arm.pattern, armBound);
                if (arm.guard)
                    walkExpr(arm.guard, armBound, free);
                walkExpr(arm.body, armBound, free);
            }
            break;
    }
}
export function collectPatternBindings(pattern, bound) {
    switch (pattern.kind) {
        case "BindingPattern":
            bound.add(pattern.name);
            break;
        case "ConstructorPattern":
            for (const pf of pattern.fields)
                collectPatternBindings(pf.pattern, bound);
            break;
        case "WildcardPattern":
        case "LiteralPattern":
        case "RangePattern":
            break;
    }
}
//# sourceMappingURL=checker-freevars.js.map