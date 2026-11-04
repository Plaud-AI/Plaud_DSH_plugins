import type { OAuthClientProvider } from '@modelcontextprotocol/client';
/** Token set as the MCP SDK's provider interface describes it. */
export type Tokens = NonNullable<Awaited<ReturnType<OAuthClientProvider['tokens']>>>;
/** Registered-client information as the MCP SDK's provider interface describes it. */
export type ClientInformation = NonNullable<Awaited<ReturnType<OAuthClientProvider['clientInformation']>>>;
/** Per-authorization-server context the SDK passes to credential callbacks. */
export type IssuerContext = Parameters<OAuthClientProvider['tokens']>[0];
/**
 * Root of the DeepSeek Harness installation that owns this process.
 *
 * Matches the host's own convention so a plugin running under the desktop app
 * and one running under the CLI resolve to the same directory.
 */
export declare function dshHome(): string;
/**
 * Persistent OAuth credentials for one MCP server.
 *
 * One JSON document per server under `$DSH_HOME/mcp-oauth/`, written atomically
 * and chmod 0600. Entries are keyed by authorization-server issuer so a server
 * that moves between issuers never replays a token against the wrong one
 * (RFC 9207 mix-up defense).
 */
export declare class TokenStore {
    #private;
    /** Absolute path of the backing file; surfaced in logs so users can find it. */
    readonly file: string;
    constructor(serverName: string);
    /** Stored client registration for an issuer, or `undefined` when unregistered. */
    client(ctx?: IssuerContext): Promise<ClientInformation | undefined>;
    /** Persist a dynamically registered client and remember it as the latest issuer. */
    putClient(ctx: IssuerContext | undefined, client: ClientInformation): Promise<void>;
    /**
     * Tokens for an issuer, or the most recently saved set when the SDK asks
     * without context (its per-request bearer-token read).
     */
    tokens(ctx?: IssuerContext): Promise<Tokens | undefined>;
    /** Persist a token set for an issuer. */
    putTokens(ctx: IssuerContext | undefined, tokens: Tokens): Promise<void>;
    /** Drop every stored credential for this server (used by the logout path). */
    clear(): Promise<void>;
    /** Whether a token set exists, without loading the token values. */
    hasTokens(): Promise<boolean>;
}
