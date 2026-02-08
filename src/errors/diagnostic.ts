export interface Position {
  offset: number;
  line: number;
  column: number;
}

export interface Span {
  start: Position;
  end: Position;
  source: string;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  message: string;
  span: Span;
  help?: string;
}

export function error(message: string, span: Span, help?: string): Diagnostic {
  return { severity: "error", message, span, help };
}

export function warning(message: string, span: Span, help?: string): Diagnostic {
  return { severity: "warning", message, span, help };
}

export function makeSpan(
  source: string,
  startOffset: number,
  endOffset: number,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): Span {
  return {
    start: { offset: startOffset, line: startLine, column: startCol },
    end: { offset: endOffset, line: endLine, column: endCol },
    source,
  };
}
