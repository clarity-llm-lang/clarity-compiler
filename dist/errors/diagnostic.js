export function error(message, span, help) {
    return { severity: "error", message, span, help };
}
export function warning(message, span, help) {
    return { severity: "warning", message, span, help };
}
export function makeSpan(source, startOffset, endOffset, startLine, startCol, endLine, endCol) {
    return {
        start: { offset: startOffset, line: startLine, column: startCol },
        end: { offset: endOffset, line: endLine, column: endCol },
        source,
    };
}
//# sourceMappingURL=diagnostic.js.map