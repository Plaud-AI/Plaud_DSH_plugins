import { createSlackApi, type SlackApi } from './client.js'
import { parseConfig, requireToken, resolveAppToken, type SlackBotConfig } from './config.js'
import { InboxQueue, type InboxMessage } from './inbox.js'
import { startSocketMode, type SocketHandle } from './socket.js'
import { buildTools, type ToolDefinition } from './tools.js'

/** 日志面（宿主注入）。 */
export interface PluginLogger {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

/** 用到的宿主上下文子集。 */
export interface PluginContext {
  tools: { register(definition: unknown): () => void }
  logger?: PluginLogger
  effect?(callback: () => (() => void) | void, label?: string): unknown
  on?(event: string, listener: () => void): unknown
}

export const name = 'slack-bot'
export const inject = ['tools']

/** 从 Socket Mode 的载荷里取出真正的事件对象。 */
function extractEvent(payload: unknown): Record<string, unknown> | null {
  const shaped = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const inner = shaped.event
  if (typeof inner === 'object' && inner !== null) return inner as Record<string, unknown>
  const body = shaped.body
  if (typeof body === 'object' && body !== null) {
    const event = (body as Record<string, unknown>).event
    if (typeof event === 'object' && event !== null) return event as Record<string, unknown>
  }
  if (typeof shaped.type === 'string') return shaped
  return null
}

/** 只保留人类发的普通消息，其余（机器人、编辑、加入频道等）全部丢弃。 */
function toInboxMessage(payload: unknown): InboxMessage | null {
  const event = extractEvent(payload)
  if (event === null) return null
  if (event.type !== 'message') return null
  if (typeof event.subtype === 'string' && event.subtype !== '') return null
  if (typeof event.bot_id === 'string' && event.bot_id !== '') return null
  const ts = typeof event.ts === 'string' ? event.ts : ''
  const channel = typeof event.channel === 'string' ? event.channel : ''
  const user = typeof event.user === 'string' ? event.user : ''
  const text = typeof event.text === 'string' ? event.text : ''
  if (ts === '' || channel === '' || user === '' || text === '') return null
  const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : undefined
  return {
    ts,
    channel,
    channelType: typeof event.channel_type === 'string' ? event.channel_type : 'channel',
    user,
    text,
    ...(threadTs !== undefined && threadTs !== ts ? { threadTs } : {}),
  }
}

/**
 * 插件入口。
 *
 * 配置缺失不失败：工具照常注册，调用时给出可操作的报错；有 App-Level Token
 * 才启动 Socket Mode，生命周期挂在 ctx.effect 上，插件卸载即断开。
 */
export function apply(ctx: PluginContext, rawConfig: unknown): void {
  const log = (message: string): void => {
    ctx.logger?.info?.(`[slack-bot] ${message}`)
  }
  const warn = (message: string): void => {
    ctx.logger?.warn?.(`[slack-bot] ${message}`)
  }

  const config = parseConfig(rawConfig)
  const inbox = new InboxQueue()

  let api: SlackApi | undefined
  let apiToken = ''
  const apiProvider = (): SlackApi => {
    const current = parseConfig(rawConfig)
    // 先校验再建客户端：空令牌会让 Slack 回 not_authed，看着像“令牌失效”，
    // 实际是没配，报错会误导人。
    requireToken(current)
    if (api === undefined || current.token !== apiToken) {
      api = createSlackApi(current.token)
      apiToken = current.token
    }
    return api
  }

  let socket: SocketHandle | undefined
  const appToken = resolveAppToken(config)
  if (appToken !== '') {
    const start = (): (() => void) => {
      socket = startSocketMode(appToken, {
        onLog: (message) => log(message),
        onEvent: (payload) => {
          const message = toInboxMessage(payload)
          if (message === null) return
          const latest = parseConfig(rawConfig)
          if (latest.allowedChannels.length > 0 && !latest.allowedChannels.includes(message.channel)) return
          inbox.push(message)
        },
      })
      return () => {
        socket?.dispose()
        socket = undefined
      }
    }
    if (typeof ctx.effect === 'function') ctx.effect(start, 'slack-bot socket')
    else {
      const dispose = start()
      ctx.on?.('dispose', dispose)
    }
  } else {
    warn('未配置 App-Level Token（xapp-）：只支持发消息，slackbot_inbox 会一直是空的。')
  }

  if (config.token === '') {
    warn('未配置 Slack 令牌：工具会注册但调用时报错。设置 DSH_SLACK_BOT_TOKEN 或插件配置里的 token。')
  }

  const tools: ToolDefinition[] = buildTools({
    config: () => parseConfig(rawConfig),
    api: apiProvider,
    inbox: () => inbox,
    socket: () => socket,
  })

  for (const tool of tools) {
    ctx.tools.register(tool)
  }
  log(`已注册 ${tools.length} 个工具：${tools.map((tool) => tool.name).join(', ')}`)
}

export type { SlackBotConfig }
