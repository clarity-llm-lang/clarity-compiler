import type { SharedHelpers } from "./types.js";
export declare function createAgentRuntime(h: SharedHelpers, mcpSessions: Map<number, {
    url: string;
}>, getMcpNextId: () => number, spanTable: Map<number, {
    op: string;
    start: number;
    events: string[];
}>, getNextSpanId: () => number): {
    get_secret(namePtr: number): number;
    mcp_connect(urlPtr: number): number;
    mcp_list_tools(sessionId: bigint): number;
    mcp_call_tool(sessionId: bigint, toolPtr: number, argsPtr: number): number;
    mcp_disconnect(sessionId: bigint): void;
    a2a_discover(urlPtr: number): number;
    a2a_submit(urlPtr: number, messagePtr: number): number;
    a2a_poll(urlPtr: number, taskIdPtr: number): number;
    a2a_cancel(urlPtr: number, taskIdPtr: number): number;
    trace_start(opPtr: number): bigint;
    trace_end(spanIdBig: bigint): void;
    trace_log(spanIdBig: bigint, messagePtr: number): void;
    checkpoint_save(keyPtr: number, valuePtr: number): number;
    checkpoint_load(keyPtr: number): number;
    checkpoint_delete(keyPtr: number): void;
    checkpoint_save_raw(keyPtr: number, valuePtr: number): number;
    hitl_ask(keyPtr: number, questionPtr: number): number;
};
