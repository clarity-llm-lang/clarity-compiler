// =============================================================================
// Clarity Built-in Registry — Single Source of Truth
// =============================================================================
//
// This file declares every Clarity-level built-in function and effect.
// The type checker and introspection command read from here.
//
// To add a new built-in function:
//   1. Add an entry to the appropriate domain file in src/registry/builtins/
//   2. Add the JS runtime implementation in src/codegen/runtime/<domain>.ts
//   3. If the WASM import shape is new, add it to src/codegen/builtins.ts
//   4. Run `npm test` and `clarityc introspect --builtins` to verify
//
// To add a new effect:
//   1. Add an entry to EFFECT_DEFINITIONS below
//   2. Use the effect name in your built-in's `effects` array

// Re-export the interfaces so importers can use them from this module.
export type { ClarityBuiltin, EffectDefinition } from "./builtins/types.js";

import { CORE_BUILTINS } from "./builtins/core.js";
import { FS_BUILTINS } from "./builtins/fs.js";
import { NETWORK_BUILTINS } from "./builtins/network.js";
import { TTY_BUILTINS } from "./builtins/tty.js";
import { LLM_BUILTINS } from "./builtins/llm.js";
import { AGENT_BUILTINS } from "./builtins/agent.js";
import type { ClarityBuiltin, EffectDefinition } from "./builtins/types.js";

// -----------------------------------------------------------------------------
// Effect Definitions
// -----------------------------------------------------------------------------

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  { name: "Network", description: "Network and HTTP operations" },
  { name: "Time", description: "Access to current time and timestamps" },
  { name: "Random", description: "Random number generation" },
  { name: "Log", description: "Logging and printing to stdout/stderr" },
  { name: "FileSystem", description: "File I/O, stdin/stdout, command-line args, and process control" },
  { name: "Test", description: "Test assertions for the self-healing test system" },
  { name: "Model", description: "LLM inference — call language models and list available models. Requires OPENAI_API_KEY (or compatible) environment variable." },
  { name: "Secret", description: "Read named secrets from environment variables. Prevents secrets from appearing in source code." },
  { name: "MCP", description: "Model Context Protocol — connect to MCP servers, list tools, and call tools via stdio or HTTP." },
  { name: "A2A", description: "Agent-to-Agent protocol — discover agents, submit tasks, poll status, and cancel tasks." },
  { name: "Trace", description: "Structured span tracing — start/end named spans and log events within them. Spans are written to the audit log with timing and event lists." },
  { name: "Persist", description: "Durable key-value checkpointing backed by the local filesystem (CLARITY_CHECKPOINT_DIR). Used to save and resume agent state across restarts." },
  { name: "Embed", description: "Text embedding and vector retrieval — call an embedding model and perform cosine-similarity search over a corpus. Requires OPENAI_API_KEY (or compatible)." },
  { name: "Eval", description: "LLM output evaluation — assess model responses against expected outputs or rubrics. Supports exact match, substring match, semantic similarity, and LLM-as-judge scoring." },
  { name: "HumanInLoop", description: "Human-in-the-loop interaction — pause agent execution and emit a prompt to a human operator via CLARITY_HITL_DIR; resume when the operator writes a response. Enables supervised agentic workflows." },
  { name: "TTY", description: "Raw terminal input and cursor/line control — enter/exit raw keypress mode, read normalized key events (up/down/enter/space/escape), move cursor, clear lines, show/hide cursor, and query terminal dimensions. Works only when stdout/stdin is a real TTY." },
];

// -----------------------------------------------------------------------------
// Built-in Function Definitions — assembled from domain files
// -----------------------------------------------------------------------------

export const CLARITY_BUILTINS: ClarityBuiltin[] = [
  ...CORE_BUILTINS,
  ...FS_BUILTINS,
  ...NETWORK_BUILTINS,
  ...TTY_BUILTINS,
  ...LLM_BUILTINS,
  ...AGENT_BUILTINS,
];

// -----------------------------------------------------------------------------
// Query helpers
// -----------------------------------------------------------------------------

/** Get the set of all known effect names (for the checker) */
export function getKnownEffectNames(): Set<string> {
  return new Set(EFFECT_DEFINITIONS.map((e) => e.name));
}

/** Get all built-ins for a given effect */
export function getBuiltinsForEffect(effectName: string): ClarityBuiltin[] {
  return CLARITY_BUILTINS.filter((b) => b.effects.includes(effectName));
}

/** Get all built-ins in a given category */
export function getBuiltinsByCategory(category: string): ClarityBuiltin[] {
  return CLARITY_BUILTINS.filter((b) => b.category === category);
}
