import z from '@deepseek-ai/schemastery';
import { Client } from '@modelcontextprotocol/client';
import { DshOAuthProvider, OAuthCallbackListener, ensureAuthorized } from './oauth.js';
import { TokenStore } from './store.js';
import { createTransport } from './transport.js';
import { syncTools } from './tools.js';
export { DshOAuthProvider, OAuthCallbackListener, ensureAuthorized } from './oauth.js';
export { TokenStore, dshHome } from './store.js';
export { buildChildEnv, createTransport } from './transport.js';
export { publicToolName, syncTools } from './tools.js';
/** Valid `serverName`: short, filesystem-safe, unique per server. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/**
 * Build a Cordis plugin for one MCP server.
 *
 * The returned object carries the four names the harness loader reads, so a
 * service package only needs to re-export them.
 */
export function createMcpPlugin(preset) {
    const Config = z.object({
        serverName: z.string().default(preset.serverName).pattern(SERVER_NAME_PATTERN),
        transport: z.string().default(preset.transport),
        auth: z.string().default(preset.auth ?? 'none'),
        url: z.string().default(preset.url ?? ''),
        headers: z.dict(String).default({}),
        bearerTokenEnv: z.string().default(preset.bearerTokenEnv ?? ''),
        command: z.string().default(preset.command ?? ''),
        args: z.array(String).default(preset.args ?? []),
        env: z.dict(String).default({}),
        cwd: z.string().default(''),
        scope: z.string().default(preset.scope ?? ''),
        clientId: z.string().default(''),
        clientSecret: z.string().default(''),
        authorizationParams: z.dict(String).default({}),
        tokenEndpointAuthMethod: z.string().default(''),
        toolCallTimeoutMs: z.number().default(120_000),
        authTimeoutMs: z.number().default(300_000),
        failOnStartupError: z.boolean().default(false),
    });
    async function apply(ctx, config) {
        const label = `mcp-oauth(${config.serverName})`;
        const disposers = new Map();
        const listener = new OAuthCallbackListener();
        let client;
        let tornDown = false;
        const teardown = () => {
            if (tornDown)
                return;
            tornDown = true;
            listener.close();
            for (const dispose of disposers.values())
                dispose();
            disposers.clear();
            const current = client;
            client = undefined;
            void current?.close().catch(() => { });
        };
        ctx.effect(() => teardown, 'mcp-oauth.connection');
        try {
            if (config.transport === 'stdio') {
                if (config.command.length === 0)
                    throw new Error(`${label}: "command" is required for the stdio transport`);
                const connected = newClient();
                try {
                    await connected.connect(createTransport({
                        transport: 'stdio',
                        command: config.command,
                        args: config.args,
                        env: config.env,
                        cwd: config.cwd,
                    }));
                }
                catch (error) {
                    await connected.close().catch(() => { });
                    throw error;
                }
                client = connected;
            }
            else {
                if (config.url.length === 0)
                    throw new Error(`${label}: "url" is required for the streamable-http transport`);
                const url = new URL(config.url);
                let provider;
                if (config.auth === 'oauth') {
                    const redirectUrl = await listener.start();
                    provider = new DshOAuthProvider({
                        serverName: config.serverName,
                        redirectUrl,
                        store: new TokenStore(config.serverName),
                        scope: config.scope.length > 0 ? config.scope : undefined,
                        clientId: config.clientId.length > 0 ? config.clientId : undefined,
                        clientSecret: config.clientSecret.length > 0 ? config.clientSecret : undefined,
                        authorizationParams: config.authorizationParams,
                        tokenEndpointAuthMethod: config.tokenEndpointAuthMethod.length > 0
                            ? config.tokenEndpointAuthMethod
                            : undefined,
                        log: (message) => ctx.logger.info(message),
                    });
                    ctx.logger.info(`${label}: OAuth client ready (redirect ${redirectUrl})`);
                }
                const headers = { ...config.headers };
                if (config.auth === 'bearer') {
                    const variable = config.bearerTokenEnv;
                    const token = variable.length > 0 ? process.env[variable] : undefined;
                    if (token === undefined || token.length === 0) {
                        throw new Error(`${label}: bearer auth needs ${variable.length > 0 ? variable : 'a token'} in the environment`);
                    }
                    headers.Authorization = `Bearer ${token}`;
                }
                try {
                    client = await connectRemote(url, headers, provider);
                }
                catch (error) {
                    const needsAuthorization = provider !== undefined && (isUnauthorized(error) || !(await provider.tokens()));
                    if (!needsAuthorization)
                        throw error;
                    ctx.logger.info(`${label}: no usable token, starting the OAuth flow`);
                    await ensureAuthorized({
                        serverUrl: url,
                        provider: provider,
                        listener,
                        timeoutMs: config.authTimeoutMs,
                        log: (message) => ctx.logger.info(message),
                    });
                    client = await connectRemote(url, headers, provider);
                }
            }
            const connectedClient = client;
            if (connectedClient === undefined)
                throw new Error(`${label}: connection was not established`);
            const count = await syncTools(connectedClient, ctx, { serverName: config.serverName, toolCallTimeoutMs: config.toolCallTimeoutMs }, disposers);
            ctx.logger.info(`${label}: connected, ${count} tool(s) registered`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.error(`${label}: startup failed: ${message}`);
            if (config.failOnStartupError)
                throw error;
        }
    }
    async function connectRemote(url, headers, provider) {
        const connected = newClient();
        try {
            await connected.connect(createTransport({
                transport: 'streamable-http',
                url: url.toString(),
                headers,
                ...(provider !== undefined ? { authProvider: provider } : {}),
            }));
        }
        catch (error) {
            await connected.close().catch(() => { });
            throw error;
        }
        return connected;
    }
    return {
        name: 'mcp-oauth',
        inject: ['tools'],
        Config,
        apply,
    };
}
/**
 * One MCP client generation.
 *
 * A Protocol instance is bound to one transport for life, so every reconnect
 * builds a fresh client. `versionNegotiation: auto` keeps the bridge usable
 * across MCP protocol revisions instead of pinning one.
 */
function newClient() {
    const options = {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => { } } },
    };
    return new Client({ name: 'dsh-mcp-oauth', version: '0.1.0' }, options);
}
/** Whether a connect failure is the server telling us to authenticate first. */
function isUnauthorized(error) {
    if (error === null || typeof error !== 'object')
        return false;
    const candidate = error;
    if (candidate.code === 401 || candidate.status === 401)
        return true;
    if (candidate.name === 'UnauthorizedError')
        return true;
    return typeof candidate.message === 'string' && candidate.message.includes('401');
}
