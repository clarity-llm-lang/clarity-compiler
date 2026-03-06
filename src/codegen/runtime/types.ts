// Shared types for runtime sub-modules.

/** Structured agent observability event emitted by std/mcp and std/a2a operations. */
export interface AgentEvent {
  kind: string;
  data: Record<string, unknown>;
}

export interface RuntimeConfig {
  /** Command-line arguments to expose via get_args() */
  argv?: string[];
  /** Stdin content (pre-read). If not provided, reads synchronously from process.stdin */
  stdin?: string;
  /** File system access. If not provided, uses Node.js fs */
  fs?: {
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, content: string) => void;
  };
  /**
   * Optional callback for structured agent.* observability events.
   * LLM-runtime passes this when embedding WASM modules so MCP tool calls
   * and A2A task operations appear on the agent event timeline.
   * Events are also written to the audit log regardless of this callback.
   */
  agentEventEmitter?: (event: AgentEvent) => void;
}

export interface AssertionFailure {
  kind: string;
  actual: string;
  expected: string;
  testFunction: string;
}

export interface RuntimeExports {
  memory: WebAssembly.Memory;
  __heap_base?: WebAssembly.Global;
}

/** Shared helpers passed to each domain factory. */
export interface SharedHelpers {
  readString: (ptr: number) => string;
  writeString: (str: string) => number;
  alloc: (size: number) => number;
  memory: () => WebAssembly.Memory;
  allocOptionI32: (value: number | null) => number;
  allocOptionI64: (value: bigint | null) => number;
  allocResultI64: (ok: boolean, value: bigint, errPtr?: number) => number;
  allocResultString: (ok: boolean, valuePtr: number) => number;
  allocResultI32: (ok: boolean, valuePtr: number) => number;
  allocListI32: (items: number[]) => number;
  allocListI64: (items: bigint[]) => number;
  policyCheckUrl: (url: string) => string | null;
  policyCheckEffect: (effectName: string) => string | null;
  policyAuditLog: (entry: Record<string, unknown>) => void;
  /** Emit a structured agent.* observability event (no-op when no emitter configured). */
  emitAgentEvent: (event: AgentEvent) => void;
}
