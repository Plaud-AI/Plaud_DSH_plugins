import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { auth } from '@modelcontextprotocol/client';
import { openBrowser } from './browser.js';
/**
 * OAuth 2.0 client provider backed by the host's credential store.
 *
 * The MCP SDK owns discovery, DCR, PKCE, issuer validation and refresh; this
 * class only answers "what do we know" and "where should the browser go".
 * That split is what keeps the flow standard rather than per-vendor.
 */
export class DshOAuthProvider {
    #codeVerifier;
    #state;
    #authorizationUrl;
    options;
    constructor(options) {
        this.options = options;
    }
    /** Loopback redirect URI, known before the first request so DCR can register it. */
    get redirectUrl() {
        return this.options.redirectUrl;
    }
    /** Last authorization URL handed to the browser, for diagnostics and retries. */
    get authorizationUrl() {
        return this.#authorizationUrl;
    }
    get clientMetadata() {
        const confidential = Boolean(this.options.clientSecret);
        const metadata = {
            client_name: `DeepSeek Harness · ${this.options.serverName}`,
            redirect_uris: [this.options.redirectUrl],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: this.options.tokenEndpointAuthMethod ?? (confidential ? 'client_secret_post' : 'none'),
            ...(this.options.scope ? { scope: this.options.scope } : {}),
        };
        return metadata;
    }
    /** CSRF state for the authorization request; constant for one flow. */
    async state() {
        this.#state ??= randomBytes(32).toString('base64url');
        return this.#state;
    }
    /** Pre-registered client wins over anything discovered through DCR. */
    async clientInformation(ctx) {
        const { clientId, clientSecret } = this.options;
        if (clientId !== undefined && clientId.length > 0) {
            const information = {
                client_id: clientId,
                token_endpoint_auth_method: this.clientMetadata.token_endpoint_auth_method,
            };
            if (clientSecret !== undefined && clientSecret.length > 0)
                information.client_secret = clientSecret;
            return information;
        }
        return this.options.store.client(ctx);
    }
    /** Persist a DCR result; a pre-registered client is never overwritten. */
    async saveClientInformation(information, ctx) {
        const { clientId } = this.options;
        if (clientId !== undefined && clientId.length > 0)
            return;
        await this.options.store.putClient(ctx, information);
    }
    async tokens(ctx) {
        return this.options.store.tokens(ctx);
    }
    async saveTokens(tokens, ctx) {
        await this.options.store.putTokens(ctx, tokens);
    }
    async saveCodeVerifier(codeVerifier) {
        this.#codeVerifier = codeVerifier;
    }
    async codeVerifier() {
        if (this.#codeVerifier === undefined) {
            throw new Error(`mcp-oauth(${this.options.serverName}): no PKCE verifier recorded — restart the authorization flow`);
        }
        return this.#codeVerifier;
    }
    /** Append vendor-required parameters, then open the browser. */
    async redirectToAuthorization(authorizationUrl) {
        const target = new URL(authorizationUrl.toString());
        for (const [name, value] of Object.entries(this.options.authorizationParams ?? {})) {
            if (value.length > 0)
                target.searchParams.set(name, value);
        }
        this.#authorizationUrl = target;
        this.options.log?.(`mcp-oauth(${this.options.serverName}): opening browser for authorization`);
        openBrowser(target.toString());
    }
}
/**
 * Single-use loopback listener for the OAuth redirect.
 *
 * Binds `127.0.0.1` on an ephemeral port so two servers (or two harness
 * processes) never fight over a fixed callback port. A callback that arrives
 * before anyone awaits is queued, not dropped.
 */
export class OAuthCallbackListener {
    #server;
    #port = 0;
    #queued;
    #pending;
    /** Redirect URI; only valid after {@link start}. */
    get redirectUrl() {
        return `http://127.0.0.1:${this.#port}/callback`;
    }
    /** Start listening and return the redirect URI to register. */
    async start() {
        if (this.#server !== undefined)
            return this.redirectUrl;
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.#port}`);
            if (url.pathname !== '/callback') {
                respond(response, 404, 'Not found');
                return;
            }
            const error = url.searchParams.get('error');
            if (error !== null) {
                const description = url.searchParams.get('error_description') ?? '';
                respond(response, 400, `Authorization failed: ${error} ${description}`);
                this.#settle(new Error(`authorization failed: ${error} ${description}`.trim()));
                return;
            }
            const code = url.searchParams.get('code');
            if (code === null || code.length === 0) {
                respond(response, 400, 'Missing authorization code');
                this.#settle(new Error('authorization callback carried no code'));
                return;
            }
            const result = {
                code,
                ...(url.searchParams.get('iss') !== null ? { iss: url.searchParams.get('iss') } : {}),
                ...(url.searchParams.get('state') !== null ? { state: url.searchParams.get('state') } : {}),
            };
            respond(response, 200, '授权完成，可以关闭这个页面并回到 DeepSeek Harness。');
            this.#settle(result);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', reject);
                resolve();
            });
        });
        const address = server.address();
        this.#port = typeof address === 'object' && address !== null ? address.port : 0;
        if (this.#port === 0) {
            server.close();
            throw new Error('mcp-oauth: loopback listener bound to port 0');
        }
        this.#server = server;
        return this.redirectUrl;
    }
    /** Resolve with the next callback, or reject on timeout / listener failure. */
    wait(timeoutMs = 300_000) {
        if (this.#queued !== undefined) {
            const queued = this.#queued;
            this.#queued = undefined;
            return Promise.resolve(queued);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending = undefined;
                reject(new Error(`mcp-oauth: authorization callback timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            timer.unref?.();
            this.#pending = {
                resolve: (result) => {
                    clearTimeout(timer);
                    this.#pending = undefined;
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    this.#pending = undefined;
                    reject(error);
                },
            };
        });
    }
    /** Stop listening; safe to call more than once. */
    close() {
        this.#pending?.reject(new Error('mcp-oauth: authorization listener closed'));
        this.#pending = undefined;
        const server = this.#server;
        this.#server = undefined;
        server?.close();
    }
    #settle(result) {
        if (this.#pending === undefined) {
            if (result instanceof Error)
                return;
            this.#queued = result;
            return;
        }
        if (result instanceof Error)
            this.#pending.reject(result);
        else
            this.#pending.resolve(result);
    }
}
function respond(response, status, message) {
    const body = `<!doctype html><meta charset="utf-8"><title>DeepSeek Harness</title><p>${escapeHtml(message)}</p>`;
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(body);
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : character === '"' ? '&quot;' : '&#39;');
}
/**
 * Drive the full interactive authorization flow for one server.
 *
 * First call runs discovery and either refreshes or redirects; when it
 * redirected, the callback is awaited and exchanged for tokens. Idempotent:
 * with a live token set it returns after the refresh check.
 */
export async function ensureAuthorized(options) {
    const { serverUrl, provider, listener } = options;
    const log = options.log ?? (() => { });
    log(`mcp-oauth(${provider.options.serverName}): starting authorization for ${serverUrl.toString()}`);
    await auth(provider, { serverUrl: serverUrl.toString() });
    if (await provider.tokens()) {
        log(`mcp-oauth(${provider.options.serverName}): authorization refreshed without user interaction`);
        return;
    }
    const authorizationUrl = provider.authorizationUrl;
    if (authorizationUrl !== undefined)
        log(`mcp-oauth(${provider.options.serverName}): authorize at ${authorizationUrl.toString()}`);
    const callback = await listener.wait(options.timeoutMs);
    if (callback.state !== undefined) {
        const expected = await provider.state();
        if (callback.state !== expected) {
            throw new Error(`mcp-oauth(${provider.options.serverName}): state mismatch on authorization callback`);
        }
    }
    await auth(provider, {
        serverUrl: serverUrl.toString(),
        authorizationCode: callback.code,
        ...(callback.iss !== undefined ? { iss: callback.iss } : {}),
    });
    if (!(await provider.tokens())) {
        throw new Error(`mcp-oauth(${provider.options.serverName}): authorization finished without tokens`);
    }
    log(`mcp-oauth(${provider.options.serverName}): authorized`);
}
