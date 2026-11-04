/** Logger surface the host exposes to plugins. */
export interface PluginLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
/** The subset of the Cordis plugin context this bridge depends on. */
export interface PluginContext {
    tools: {
        register(definition: unknown): () => void;
    };
    logger: PluginLogger;
    effect(callback: () => (() => void) | void, label?: string): unknown;
}
/**
 * Public tool name for one upstream tool: `mcp__<server>__<tool>`.
 *
 * Mirrors the host bridge's naming so permission rules, transcripts and
 * allowlists written for the built-in client keep working unchanged. Over-long
 * names collapse to a truncated form plus a stable hash.
 */
export declare function publicToolName(serverName: string, rawName: string): string;
/** The connected MCP client as far as this bridge needs to see it. */
interface McpClientLike {
    getServerCapabilities(): {
        tools?: unknown;
    } | undefined;
    listTools(params: undefined, options: {
        cacheMode: 'refresh';
    }): Promise<{
        tools: readonly McpToolLike[];
    }>;
    callTool(request: {
        name: string;
        arguments: Record<string, unknown>;
    }, options: Record<string, unknown>): Promise<unknown>;
}
interface McpToolLike {
    name: string;
    description?: string | undefined;
    inputSchema: unknown;
    outputSchema?: unknown;
    execution?: {
        taskSupport?: string | undefined;
    } | undefined;
}
export interface SyncOptions {
    serverName: string;
    toolCallTimeoutMs: number;
}
/**
 * Publish one MCP server's tool list on `ctx.tools`.
 *
 * Fetch first, swap second: a failed discovery leaves the previous generation
 * registered instead of half-replacing it.
 *
 * @returns number of tools registered for this server.
 */
export declare function syncTools(client: McpClientLike, ctx: PluginContext, options: SyncOptions, live: Map<string, () => void>): Promise<number>;
export {};
