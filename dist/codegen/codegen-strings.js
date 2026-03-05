// Allocate a string literal in the data segment.
// Layout: [length: u32 LE][utf8 bytes]
export function allocStringLiteral(ctx, value) {
    const existing = ctx.stringLiterals.get(value);
    if (existing !== undefined)
        return existing;
    const encoded = new TextEncoder().encode(value);
    const ptr = ctx.dataSegmentOffset;
    const data = new Uint8Array(4 + encoded.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, encoded.length, true);
    data.set(encoded, 4);
    ctx.dataSegments.push({ offset: ptr, data });
    ctx.stringLiterals.set(value, ptr);
    ctx.dataSegmentOffset = ptr + data.length;
    ctx.dataSegmentOffset = (ctx.dataSegmentOffset + 3) & ~3;
    return ptr;
}
// Pre-scan the entire AST for string literals and allocate data segments
// so that setMemory can be called before function generation.
export function prescanStringLiterals(ctx, module) {
    for (const decl of module.declarations) {
        if (decl.kind === "FunctionDecl") {
            scanExprForStrings(ctx, decl.body);
        }
    }
}
export function scanExprForStrings(ctx, expr) {
    switch (expr.kind) {
        case "StringLiteral":
            allocStringLiteral(ctx, expr.value);
            break;
        case "BinaryExpr":
            scanExprForStrings(ctx, expr.left);
            scanExprForStrings(ctx, expr.right);
            break;
        case "UnaryExpr":
            scanExprForStrings(ctx, expr.operand);
            break;
        case "CallExpr":
            for (const arg of expr.args)
                scanExprForStrings(ctx, arg.value);
            if (expr.callee.kind !== "IdentifierExpr")
                scanExprForStrings(ctx, expr.callee);
            break;
        case "MatchExpr":
            scanExprForStrings(ctx, expr.scrutinee);
            for (const arm of expr.arms) {
                scanExprForStrings(ctx, arm.body);
                if (arm.pattern.kind === "LiteralPattern")
                    scanExprForStrings(ctx, arm.pattern.value);
            }
            break;
        case "LetExpr":
            scanExprForStrings(ctx, expr.value);
            break;
        case "AssignmentExpr":
            scanExprForStrings(ctx, expr.value);
            break;
        case "BlockExpr":
            for (const stmt of expr.statements)
                scanExprForStrings(ctx, stmt);
            if (expr.result)
                scanExprForStrings(ctx, expr.result);
            break;
        case "MemberExpr":
            scanExprForStrings(ctx, expr.object);
            break;
        case "ListLiteral":
            for (const elem of expr.elements)
                scanExprForStrings(ctx, elem);
            break;
        case "RecordLiteral":
            for (const field of expr.fields)
                scanExprForStrings(ctx, field.value);
            break;
        case "LambdaExpr":
            scanExprForStrings(ctx, expr.body);
            break;
    }
}
//# sourceMappingURL=codegen-strings.js.map