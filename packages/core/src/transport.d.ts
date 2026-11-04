import type { DshOAuthProvider } from './oauth.js';
/** Remote transport: streamable HTTP, optionally OAuth or static headers. */
export interface RemoteTransportSpec {
    transport: 'streamable-http';
    url: string;
    headers?: Record<string, string> | undefined;
    authProvider?: DshOAuthProvider | undefined;
}
/** Local transport: an MCP server spawned as a child process. */
export interface StdioTransportSpec {
    transport: 'stdio';
    command: string;
    args?: string[] | undefined;
    env?: Record<string, string> | undefined;
    cwd?: string | undefined;
}
export type TransportSpec = RemoteTransportSpec | StdioTransportSpec;
/**
 * Child environment for a stdio server: the scrubbed parent environment plus
 * whatever the plugin configuration passes explicitly.
 *
 * Credential-shaped names are dropped deliberately — the host does the same for
 * its own MCP children, and silently forwarding them would make a plugin a
 * privilege-escalation path. Pass secrets as command arguments instead, or name
 * them explicitly in `env`.
 */
export declare function buildChildEnv(extra: Record<string, string> | undefined): Record<string, string>;
/** Build the transport for one configured server. */
export declare function createTransport(spec: TransportSpec): unknown;
