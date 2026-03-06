import type { Command } from "commander";
/** Apply Clarity source formatting rules to a source string. */
export declare function formatSource(source: string): string;
export declare function registerFmtCommand(program: Command): void;
