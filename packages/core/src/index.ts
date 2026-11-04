import z from '@deepseek-ai/schemastery'
import { Client } from '@modelcontextprotocol/client'
import { DshOAuthProvider, OAuthCallbackListener, ensureAuthorized } from './oauth.js'
import { TokenStore } from './store.js'
import { createTransport } from './transport.js'
import { syncTools, type PluginContext } from './tools.js'

export { DshOAuthProvider, OAuthCallbackListener, ensureAuthorized } from './oauth.js'
export { TokenStore, dshHome } from './store.js'
export { buildChildEnv, createTransport } from './transport.js'
export { publicToolName, syncTools } from './tools.js'
export type { CallbackResult, ProviderOptions } from './oauth.js'
export type { PluginContext, PluginLogger } from './tools.js'

/** Valid `serverName`: short, filesystem-safe, unique per server. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Per-service defaults baked into a connector package. */
export interface McpPluginPreset {
  /** Namespace for tool names and the credential file. */
  serverName: string
  /** `streamable-http` for remote servers, `stdio` for child processes. */
  transport: 'streamable-http' | 'stdio'
  /** How the remote server authenticates. Ignored for stdio. */
  auth?: 'oauth' | 'bearer' | 'none' | undefined
  /** Remote MCP endpoint. */
  url?: string | undefined
  /** Local command for stdio servers. */
  command?: string | undefined
  /** Default argument vector for stdio servers. */
  args?: string[] | undefined
  /** Environment variable that carries a bearer token. */
  bearerTokenEnv?: string | undefined
  /** Default scope request. */
  scope?: string | undefined
}

/** Resolved plugin configuration after schemastery defaults are applied. */
export interface ResolvedConfig {
  serverName: string
  transport: string
  auth: string
  url: string
  headers: Record<string, string>
  bearerTokenEnv: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  scope: string
  clientId: string
  clientSecret: string
  authorizationParams: Record<string, string>
  tokenEndpointAuthMethod: string
  callbackPort: number
  toolCallTimeoutMs: number
  authTimeoutMs: number
  failOnStartupError: boolean
}

/**
 * Build a Cordis plugin for one MCP server.
 *
 * The returned object carries the four names the harness loader reads, so a
 * service package only needs to re-export them.
 */
export function createMcpPlugin(preset: McpPluginPreset): {
  name: string
  inject: string[]
  Config: unknown
  apply(ctx: PluginContext, config: ResolvedConfig): Promise<void>
} {
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
    callbackPort: z.number().min(0).max(65_535).default(0),
    toolCallTimeoutMs: z.number().default(120_000),
    authTimeoutMs: z.number().default(300_000),
    failOnStartupError: z.boolean().default(false),
  })

  async function apply(ctx: PluginContext, config: ResolvedConfig): Promise<void> {
    const label = `mcp-oauth(${config.serverName})`
    const disposers = new Map<string, () => void>()
    const listener = new OAuthCallbackListener()
    let client: Client | undefined
    let tornDown = false

    const teardown = (): void => {
      if (tornDown) return
      tornDown = true
      listener.close()
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
      const current = client
      client = undefined
      void current?.close().catch(() => {})
    }
    ctx.effect(() => teardown, 'mcp-oauth.connection')

    try {
      if (config.transport === 'stdio') {
        if (config.command.length === 0) throw new Error(`${label}: "command" is required for the stdio transport`)
        const connected = newClient()
        try {
          await connected.connect(
            createTransport({
              transport: 'stdio',
              command: config.command,
              args: config.args,
              env: config.env,
              cwd: config.cwd,
            }) as never,
          )
        } catch (error) {
          await connected.close().catch(() => {})
          throw error
        }
        client = connected
      } else {
        if (config.url.length === 0) throw new Error(`${label}: "url" is required for the streamable-http transport`)
        const url = new URL(config.url)

        let provider: DshOAuthProvider | undefined
        if (config.auth === 'oauth') {
          const redirectUrl = await listener.start(config.callbackPort)
          provider = new DshOAuthProvider({
            serverName: config.serverName,
            redirectUrl,
            store: new TokenStore(config.serverName),
            scope: config.scope.length > 0 ? config.scope : undefined,
            clientId: config.clientId.length > 0 ? config.clientId : undefined,
            clientSecret: config.clientSecret.length > 0 ? config.clientSecret : undefined,
            authorizationParams: config.authorizationParams,
            tokenEndpointAuthMethod:
              config.tokenEndpointAuthMethod.length > 0
                ? (config.tokenEndpointAuthMethod as ProviderAuthMethod)
                : undefined,
            log: (message) => ctx.logger.info(message),
          })
          ctx.logger.info(`${label}: OAuth client ready (redirect ${redirectUrl})`)
        }

        const headers = { ...config.headers }
        if (config.auth === 'bearer') {
          const variable = config.bearerTokenEnv
          const token = variable.length > 0 ? process.env[variable] : undefined
          if (token === undefined || token.length === 0) {
            throw new Error(`${label}: bearer auth needs ${variable.length > 0 ? variable : 'a token'} in the environment`)
          }
          headers.Authorization = `Bearer ${token}`
        }

        try {
          client = await connectRemote(url, headers, provider)
        } catch (error) {
          const needsAuthorization =
            provider !== undefined && (isUnauthorized(error) || !(await provider.tokens()))
          if (!needsAuthorization) throw error
          ctx.logger.info(`${label}: no usable token, starting the OAuth flow`)
          await ensureAuthorized({
            serverUrl: url,
            provider: provider as DshOAuthProvider,
            listener,
            timeoutMs: config.authTimeoutMs,
            log: (message) => ctx.logger.info(message),
          })
          client = await connectRemote(url, headers, provider)
        }
      }

      const connectedClient = client
      if (connectedClient === undefined) throw new Error(`${label}: connection was not established`)
      const count = await syncTools(
        connectedClient as never,
        ctx,
        { serverName: config.serverName, toolCallTimeoutMs: config.toolCallTimeoutMs },
        disposers,
      )
      ctx.logger.info(`${label}: connected, ${count} tool(s) registered`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.error(`${label}: startup failed: ${message}`)
      if (config.failOnStartupError) throw error
    }
  }

  async function connectRemote(
    url: URL,
    headers: Record<string, string>,
    provider: DshOAuthProvider | undefined,
  ): Promise<Client> {
    const connected = newClient()
    try {
      await connected.connect(
        createTransport({
          transport: 'streamable-http',
          url: url.toString(),
          headers,
          ...(provider !== undefined ? { authProvider: provider } : {}),
        }) as never,
      )
    } catch (error) {
      await connected.close().catch(() => {})
      throw error
    }
    return connected
  }

  return {
    // Per-service identity, so five connectors loaded side by side stay
    // distinguishable in logs and in the host's plugin tree.
    name: `mcp-${preset.serverName}`,
    inject: ['tools'],
    Config,
    apply,
  }
}

type ProviderAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post'

/**
 * One MCP client generation.
 *
 * A Protocol instance is bound to one transport for life, so every reconnect
 * builds a fresh client. `versionNegotiation: auto` keeps the bridge usable
 * across MCP protocol revisions instead of pinning one.
 */
function newClient(): Client {
  const options = {
    capabilities: {},
    versionNegotiation: { mode: 'auto' },
    listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => {} } },
  }
  return new Client({ name: 'dsh-mcp-oauth', version: '0.1.0' }, options as never)
}

/** Whether a connect failure is the server telling us to authenticate first. */
function isUnauthorized(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown }
  if (candidate.code === 401 || candidate.status === 401) return true
  if (candidate.name === 'UnauthorizedError') return true
  return typeof candidate.message === 'string' && candidate.message.includes('401')
}
