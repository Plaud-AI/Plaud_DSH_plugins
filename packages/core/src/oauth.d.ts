import type { OAuthClientProvider } from '@modelcontextprotocol/client';
import type { ClientInformation, IssuerContext, TokenStore, Tokens } from './store.js';
/** Everything the provider needs that the host configuration supplies. */
export interface ProviderOptions {
    /** MCP server namespace, used only for diagnostics. */
    serverName: string;
    /** Loopback redirect URI the SDK registers and the authorization server calls back. */
    redirectUrl: string;
    /** Store that persists the client registration, tokens and issuer keys. */
    store: TokenStore;
    /** Space-delimited scopes to request; empty lets the server decide. */
    scope?: string | undefined;
    /** Pre-registered client id (Slack and other non-DCR servers). */
    clientId?: string | undefined;
    /** Pre-registered client secret (confidential clients only). */
    clientSecret?: string | undefined;
    /** How the client authenticates at the token endpoint. */
    tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post' | undefined;
    /** Extra query parameters appended to the authorization URL (e.g. Slack `app_id`). */
    authorizationParams?: Record<string, string> | undefined;
    /** Diagnostics sink; the host logger. */
    log?: ((message: string) => void) | undefined;
}
/**
 * OAuth 2.0 client provider backed by the host's credential store.
 *
 * The MCP SDK owns discovery, DCR, PKCE, issuer validation and refresh; this
 * class only answers "what do we know" and "where should the browser go".
 * That split is what keeps the flow standard rather than per-vendor.
 */
export declare class DshOAuthProvider implements OAuthClientProvider {
    #private;
    readonly options: ProviderOptions;
    constructor(options: ProviderOptions);
    /** Loopback redirect URI, known before the first request so DCR can register it. */
    get redirectUrl(): string;
    /** Last authorization URL handed to the browser, for diagnostics and retries. */
    get authorizationUrl(): URL | undefined;
    get clientMetadata(): ReturnType<() => OAuthClientProvider['clientMetadata']>;
    /** CSRF state for the authorization request; constant for one flow. */
    state(): Promise<string>;
    /** Pre-registered client wins over anything discovered through DCR. */
    clientInformation(ctx?: IssuerContext): Promise<ClientInformation | undefined>;
    /** Persist a DCR result; a pre-registered client is never overwritten. */
    saveClientInformation(information: ClientInformation, ctx?: IssuerContext): Promise<void>;
    tokens(ctx?: IssuerContext): Promise<Tokens | undefined>;
    saveTokens(tokens: Tokens, ctx?: IssuerContext): Promise<void>;
    saveCodeVerifier(codeVerifier: string): Promise<void>;
    codeVerifier(): Promise<string>;
    /** Append vendor-required parameters, then open the browser. */
    redirectToAuthorization(authorizationUrl: URL): Promise<void>;
}
/** One authorization callback captured from the loopback listener. */
export interface CallbackResult {
    code: string;
    iss?: string;
    state?: string;
}
/**
 * Single-use loopback listener for the OAuth redirect.
 *
 * Binds `127.0.0.1` on an ephemeral port so two servers (or two harness
 * processes) never fight over a fixed callback port. A callback that arrives
 * before anyone awaits is queued, not dropped.
 */
export declare class OAuthCallbackListener {
    #private;
    /** Redirect URI; only valid after {@link start}. */
    get redirectUrl(): string;
    /** Start listening and return the redirect URI to register. */
    start(): Promise<string>;
    /** Resolve with the next callback, or reject on timeout / listener failure. */
    wait(timeoutMs?: number): Promise<CallbackResult>;
    /** Stop listening; safe to call more than once. */
    close(): void;
}
/**
 * Drive the full interactive authorization flow for one server.
 *
 * First call runs discovery and either refreshes or redirects; when it
 * redirected, the callback is awaited and exchanged for tokens. Idempotent:
 * with a live token set it returns after the refresh check.
 */
export declare function ensureAuthorized(options: {
    serverUrl: URL;
    provider: DshOAuthProvider;
    listener: OAuthCallbackListener;
    timeoutMs?: number | undefined;
    log?: ((message: string) => void) | undefined;
}): Promise<void>;
