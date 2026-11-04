import { Client } from '@modelcontextprotocol/client'
import z from '@deepseek-ai/schemastery'
import {
  DshOAuthProvider,
  OAuthCallbackListener,
  TokenStore,
  createMcpPlugin,
  createTransport,
  type McpPluginPreset,
  type ResolvedConfig,
} from '@plaudai/dsh-mcp-oauth'

/** 宿主注入的最小作用域（只用到这几项）。 */
export interface PluginContext {
  tools: { register(definition: unknown): void | (() => void) }
  logger?: { info?(message: string): void; warn?(message: string): void }
  effect?: (fn: () => void, label?: string) => void
}

export const Config = z.object({
  /** Notion 官方远程 MCP（OAuth；首次调用自动弹授权，无需预注册）。 */
  notion: z.boolean().default(true),
  /** Slack 索引检索：复用 Notion 里的 Slack 连接器，不需要 Slack 令牌。 */
  slackIndex: z.boolean().default(true),
  /** PLAUD 官方 stdio MCP（需先登录一次：npx -y @plaud-ai/mcp@latest install）。 */
  plaud: z.boolean().default(false),
  /** 任意额外 MCP，例如 Google Drive / Docs。 */
  custom: z
    .array(
      z.object({
        serverName: z.string().default(''),
        transport: z.string().default('streamable-http'),
        url: z.string().default(''),
        command: z.string().default(''),
        args: z.array(String).default([]),
        auth: z.string().default('none'),
        bearerTokenEnv: z.string().default(''),
        headers: z.dict(String).default({}),
        env: z.dict(String).default({}),
      }),
    )
    .default([]),
})

export type ConnectorsConfig = ReturnType<typeof Config>

interface Builtin {
  key: 'notion' | 'plaud'
  preset: McpPluginPreset
}

const BUILTINS: Builtin[] = [
  {
    key: 'notion',
    preset: {
      serverName: 'notion',
      transport: 'streamable-http',
      auth: 'oauth',
      url: 'https://mcp.notion.com/mcp',
      scope: '',
    },
  },
  {
    key: 'plaud',
    preset: {
      serverName: 'plaud',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@plaud-ai/mcp@latest'],
    },
  },
]

/** 预设 + 覆盖项 → 宿主要求的完整配置（schemastery 会补齐默认值）。 */
function resolve(preset: McpPluginPreset, overrides: Record<string, unknown>): ResolvedConfig {
  const schema = createMcpPlugin(preset).Config as unknown as (input: unknown) => ResolvedConfig
  return schema(overrides)
}

/** Notion 官方远程 MCP：把工作区已连接的 Slack 索引暴露成 connector-search。 */
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp'
const CONNECTOR_SEARCH = 'notion-connector-search'

interface SearchResult {
  question: string
  lookback: string
  results: Array<{ title: string; channel: string; snippet: string; link: string }>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 从 `slack://?…&channel_id=C0XXXX&message_id=…` 里取出频道 ID。 */
function channelOf(id: string): string {
  const match = /channel_id=([A-Z0-9]+)/.exec(id)
  return match?.[1] ?? ''
}

/**
 * Slack 索引检索工具。
 *
 * 不持有任何 Slack 凭据：内容来自 Notion 工作区里由管理员开启的 Slack 连接器。
 * 连接是懒的，OAuth 令牌与 Notion 服务共用 `~/.dsh/mcp-oauth/notion.json`，
 * 所以已经授权过 Notion 的机器不会二次弹窗。
 */
function registerSlackIndex(ctx: PluginContext): void {
  const log = (message: string): void => {
    ctx.logger?.info?.(`[connectors] slack-index: ${message}`)
  }

  let client: Client | undefined
  let listener: OAuthCallbackListener | undefined

  const disconnect = (): void => {
    listener?.close()
    listener = undefined
    const current = client
    client = undefined
    void current?.close().catch(() => {})
  }
  ctx.effect?.(disconnect, 'connectors.slack-index')

  const connect = async (): Promise<Client> => {
    if (client !== undefined) return client
    listener = new OAuthCallbackListener()
    const redirectUrl = await listener.start(0)
    const provider = new DshOAuthProvider({
      serverName: 'notion',
      redirectUrl,
      store: new TokenStore('notion'),
      scope: '',
      log,
    })
    const connected = new Client({ name: 'dsh-plugin-connectors', version: '0.1.0' })
    await connected.connect(
      createTransport({
        transport: 'streamable-http',
        url: NOTION_MCP_URL,
        authProvider: provider,
      }) as never,
    )
    client = connected
    return connected
  }

  ctx.tools.register({
    name: 'slack_index_search',
    description:
      '不用 Slack 令牌，直接检索 Slack 频道的历史内容（走 Notion 里已开启的 Slack 索引）。适合「某频道最近聊了什么」「某个版本哪天发布」这类问题。返回检索命中的片段，不是逐条完整历史。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '用一句话描述要找什么' },
        keywords: { type: 'string', description: '可选关键词，空格分隔，能提高命中率' },
        lookback: { type: 'string', description: '时间窗，如 1d / 7d / 14d / 30d，默认 14d' },
      },
      required: ['question'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          lookback: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                channel: { type: 'string' },
                snippet: { type: 'string' },
                link: { type: 'string' },
              },
              required: ['title', 'channel', 'snippet', 'link'],
              additionalProperties: false,
            },
          },
        },
        required: ['question', 'lookback', 'results'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown) => {
        const shaped = value as SearchResult
        if (shaped.results.length === 0) {
          return [
            {
              type: 'text',
              text: `Slack 索引没有命中（lookback ${shaped.lookback}）。换个关键词，或确认该频道已被 Notion 的 Slack 连接器索引。`,
            },
          ]
        }
        const lines = shaped.results.map(
          (item, index) =>
            `${index + 1}. ${item.title}${item.channel === '' ? '' : `（${item.channel}）`}\n   ${item.snippet}\n   ${item.link}`,
        )
        return [
          {
            type: 'text',
            text: `Slack 索引命中 ${shaped.results.length} 条（lookback ${shaped.lookback}）：\n\n${lines.join('\n\n')}`,
          },
        ]
      },
    },
    timeoutMs: 90_000,
    async execute(args: unknown): Promise<SearchResult> {
      const shaped = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const question = text(shaped.question)
      if (question === '') throw new Error('缺少 question：用一句话说明要找什么。')
      const lookback = text(shaped.lookback) || '14d'
      const keywords = text(shaped.keywords)
      const searchArgs: Record<string, unknown> = { question, lookback, sources: ['slack'] }
      if (keywords !== '') searchArgs.keywords = keywords

      const active = await connect()
      let response: unknown
      try {
        response = await active.callTool({ name: CONNECTOR_SEARCH, arguments: searchArgs })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Notion 检索失败（${message}）。确认 Notion 工作区已开启 Slack 连接器且有权限。`)
      }

      const content = (response as { content?: unknown }).content
      const blocks = Array.isArray(content) ? content : []
      const payload = blocks
        .map((block) => text((block as { text?: unknown }).text))
        .filter((value) => value !== '')
        .join('\n')

      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        throw new Error(`Notion 返回了非 JSON 内容：${payload.slice(0, 300)}`)
      }

      const rawResults = (parsed as { results?: unknown }).results
      const items = Array.isArray(rawResults) ? rawResults : []
      const results = items.map((item) => {
        const shapedItem = item as Record<string, unknown>
        const id = text(shapedItem.id)
        return {
          title: text(shapedItem.title) || '(未命名)',
          channel: channelOf(id),
          snippet: text(shapedItem.text) || text(shapedItem.snippet) || text(shapedItem.content),
          link: id,
        }
      })

      return { question, lookback, results }
    },
  })
}

/**
 * 一个插件装全部数据源。
 *
 * 每个下游服务都是独立的 MCP 客户端，工具名由核心包统一加 `mcp__<server>__`
 * 前缀，所以互不冲突；再新接一个服务只需在配置里加一条 `custom`，
 * 不用再发一个新插件。
 */
export async function apply(ctx: PluginContext, rawConfig: unknown): Promise<void> {
  const config = (typeof rawConfig === 'object' && rawConfig !== null ? rawConfig : {}) as Record<string, unknown>
  const parsed = Config(config) as ConnectorsConfig
  const hostCtx = ctx as never

  for (const builtin of BUILTINS) {
    const enabled = builtin.key === 'notion' ? parsed.notion : parsed.plaud
    if (!enabled) continue
    const plugin = createMcpPlugin(builtin.preset)
    try {
      await plugin.apply(hostCtx, resolve(builtin.preset, {}))
    } catch (error) {
      // 一个服务连不上不该拖垮整棵树：其余服务继续注册。
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.(`[connectors] ${builtin.key} 未连上：${message}`)
    }
  }

  for (const server of parsed.custom) {
    if (server.serverName === '') continue
    const preset: McpPluginPreset = {
      serverName: server.serverName,
      transport: server.transport === 'stdio' ? 'stdio' : 'streamable-http',
      auth: server.auth === 'oauth' ? 'oauth' : server.auth === 'bearer' ? 'bearer' : 'none',
      url: server.url,
      command: server.command,
      args: server.args,
      bearerTokenEnv: server.bearerTokenEnv,
    }
    try {
      await createMcpPlugin(preset).apply(hostCtx, resolve(preset, { ...server }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.(`[connectors] 自定义服务 ${server.serverName} 未连上：${message}`)
    }
  }

  if (parsed.notion && parsed.slackIndex) registerSlackIndex(ctx)
}

export const name = 'connectors'
export const inject = ['tools']
