import { type PluginContext } from './tools.js';
export { DshOAuthProvider, OAuthCallbackListener, ensureAuthorized } from './oauth.js';
export { TokenStore, dshHome } from './store.js';
export { buildChildEnv, createTransport } from './transport.js';
export { publicToolName, syncTools } from './tools.js';
export type { CallbackResult, ProviderOptions } from './oauth.js';
export type { PluginContext, PluginLogger } from './tools.js';
/** Per-service defaults baked into a connector package. */
export interface McpPluginPreset {
    /** Namespace for tool names and the credential file. */
    serverName: string;
    /** `streamable-http` for remote servers, `stdio` for child processes. */
    transport: 'streamable-http' | 'stdio';
    /** How the remote server authenticates. Ignored for stdio. */
    auth?: 'oauth' | 'bearer' | 'none' | undefined;
    /** Remote MCP endpoint. */
    url?: string | undefined;
    /** Local command for stdio servers. */
    command?: string | undefined;
    /** Default argument vector for stdio servers. */
    args?: string[] | undefined;
    /** Environment variable that carries a bearer token. */
    bearerTokenEnv?: string | undefined;
    /** Default scope request. */
    scope?: string | undefined;
}
/** Resolved plugin configuration after schemastery defaults are applied. */
export interface ResolvedConfig {
    serverName: string;
    transport: string;
    auth: string;
    url: string;
    headers: Record<string, string>;
    bearerTokenEnv: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
    scope: string;
    clientId: string;
    clientSecret: string;
    authorizationParams: Record<string, string>;
    tokenEndpointAuthMethod: string;
    toolCallTimeoutMs: number;
    authTimeoutMs: number;
    failOnStartupError: boolean;
}
/**
 * Build a Cordis plugin for one MCP server.
 *
 * The returned object carries the four names the harness loader reads, so a
 * service package only needs to re-export them.
 */
export declare function createMcpPlugin(preset: McpPluginPreset): {
    name: string;
    inject: string[];
    Config: unknown;
    apply(ctx: PluginContext, config: ResolvedConfig): Promise<void>;
};
