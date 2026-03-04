import type { Span } from "../errors/diagnostic.js";
import type { Diagnostic } from "../errors/diagnostic.js";
import type { ClarityType } from "./types.js";
import type { Pattern } from "../ast/nodes.js";
export declare function checkExhaustiveness(scrutineeType: ClarityType, patterns: Pattern[], span: Span): Diagnostic[];
