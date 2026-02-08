import chalk from "chalk";
import type { Diagnostic } from "./diagnostic.js";

export function formatDiagnostic(source: string, diag: Diagnostic): string {
  const lines = source.split("\n");
  const line = lines[diag.span.start.line - 1] ?? "";
  const lineNum = String(diag.span.start.line);
  const padding = " ".repeat(lineNum.length);

  const severityLabel =
    diag.severity === "error"
      ? chalk.red.bold("error")
      : diag.severity === "warning"
        ? chalk.yellow.bold("warning")
        : chalk.blue.bold("info");

  let output = `${severityLabel}: ${chalk.bold(diag.message)}\n`;
  output += `${padding} ${chalk.blue("-->")} ${diag.span.source}:${diag.span.start.line}:${diag.span.start.column}\n`;
  output += `${padding} ${chalk.blue("|")}\n`;
  output += `${chalk.blue(lineNum)} ${chalk.blue("|")} ${line}\n`;
  output += `${padding} ${chalk.blue("|")} ${" ".repeat(diag.span.start.column - 1)}${chalk.red("^".repeat(Math.max(1, diag.span.end.column - diag.span.start.column)))}\n`;

  if (diag.help) {
    output += `${padding} ${chalk.blue("=")} ${chalk.green("help")}: ${diag.help}\n`;
  }

  return output;
}

export function formatDiagnostics(source: string, diagnostics: Diagnostic[]): string {
  return diagnostics.map((d) => formatDiagnostic(source, d)).join("\n");
}
