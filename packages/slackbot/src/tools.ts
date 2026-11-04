import type { ChannelInfo, SlackApi } from './client.js'
import { describeSlackError } from './client.js'
import { isChannelAllowed, requireToken, type SlackBotConfig } from './config.js'
import type { InboxQueue } from './inbox.js'
import type { SocketHandle } from './socket.js'

/** 模型可见的文本内容块。 */
interface ContentBlock {
  type: 'text'
  text: string
}

/** 工具定义（宿主 ToolDefinition 的结构子集）。 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): ContentBlock[]
  }
  timeoutMs?: number
  execute(args: unknown, exec?: { signal?: AbortSignal }): Promise<unknown>
}

/** 工具依赖，全部懒加载：没令牌也能注册，调用时才报错。 */
export interface ToolDeps {
  config(): SlackBotConfig
  api(): SlackApi
  inbox(): InboxQueue
  socket(): SocketHandle | undefined
}

function block(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 解析频道目标：显式参数 > 默认频道，并过白名单。 */
function targetChannel(deps: ToolDeps, args: Record<string, unknown>): string {
  const config = deps.config()
  const explicit = optionalText(args.channel)
  const channel = explicit !== '' ? explicit : config.defaultChannel
  if (channel === '') {
    throw new Error('没有频道目标：请传 channel（频道名或 ID），或在插件配置里设置 defaultChannel。')
  }
  if (!isChannelAllowed(config, channel)) {
    throw new Error(
      `频道 ${channel} 不在允许列表内（allowedChannels）。到插件配置里加上它，或改用允许的频道。`,
    )
  }
  return channel
}

/** 校验必填文本。 */
function requiredText(args: Record<string, unknown>, key: string): string {
  const value = optionalText(args[key])
  if (value === '') throw new Error(`缺少必填参数 ${key}。`)
  return value
}

/** 一次调用统一捕获 Slack 错误。 */
async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw new Error(describeSlackError(error))
  }
}

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  return [
    {
      name: 'slack_notify',
      description:
        '向 Slack 频道（或已有线程）发送一条消息。返回消息 ts，可用作 slack_reply 的 thread_ts 继续在该线程里回复。',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: '频道名（如 #general）或频道 ID；省略时用配置里的 defaultChannel。' },
          text: { type: 'string', description: '消息正文，支持 Slack 的 Markdown 语法。' },
          thread_ts: { type: 'string', description: '可选：回复到某条消息所在的线程，值为该消息的 ts。' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { ts: { type: 'string' }, channel: { type: 'string' } },
          required: ['ts', 'channel'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          return block(`已发送到 ${String(shaped.channel ?? '')}（消息 ts：${String(shaped.ts ?? '')}）。`)
        },
      },
      timeoutMs: 30_000,
      async execute(args) {
        const shaped = asRecord(args)
        const channel = targetChannel(deps, shaped)
        const text = requiredText(shaped, 'text')
        const threadTs = optionalText(shaped.thread_ts)
        return call(() =>
          deps.api().postMessage({ channel, text, ...(threadTs !== '' ? { threadTs } : {}) }),
        )
      },
    },

    {
      name: 'slack_reply',
      description: '在指定频道的某条消息线程里回复。用于把结果发回发起讨论的那条线程。',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: '频道名或频道 ID。' },
          thread_ts: { type: 'string', description: '父消息的 ts（slack_notify 或 slack_inbox 返回）。' },
          text: { type: 'string', description: '回复正文。' },
        },
        required: ['thread_ts', 'text'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { ts: { type: 'string' }, channel: { type: 'string' }, thread_ts: { type: 'string' } },
          required: ['ts', 'channel', 'thread_ts'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          return block(`已在 ${String(shaped.channel ?? '')} 的线程 ${String(shaped.thread_ts ?? '')} 下回复（ts：${String(shaped.ts ?? '')}）。`)
        },
      },
      timeoutMs: 30_000,
      async execute(args) {
        const shaped = asRecord(args)
        const channel = targetChannel(deps, shaped)
        const threadTs = requiredText(shaped, 'thread_ts')
        const text = requiredText(shaped, 'text')
        const posted = await call(() => deps.api().postMessage({ channel, text, threadTs }))
        return { ...posted, thread_ts: threadTs }
      },
    },

    {
      name: 'slack_channels',
      description: '列出机器人可见的 Slack 频道（名称、ID、是否私有）。用于找到要发送的目标频道。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            channels: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  isPrivate: { type: 'boolean' },
                },
                required: ['id', 'name', 'isPrivate'],
                additionalProperties: false,
              },
            },
          },
          required: ['channels'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const channels = Array.isArray(shaped.channels) ? (shaped.channels as ChannelInfo[]) : []
          if (channels.length === 0) return block('机器人当前看不到任何频道。')
          return block(
            channels
              .map((channel) => `${channel.isPrivate ? '🔒' : '#'} ${channel.name}（${channel.id}）`)
              .join('\n'),
          )
        },
      },
      timeoutMs: 30_000,
      async execute() {
        const channels = await call(() => deps.api().listChannels())
        return { channels }
      },
    },

    {
      name: 'slack_inbox',
      description:
        '取走机器人收到的 Slack 消息（需要 App-Level Token 与 Socket Mode）。每条包含频道、用户、正文与 ts，消费后即从队列移除。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '最多取几条，默认 10。', minimum: 1, maximum: 50 },
          channel: { type: 'string', description: '只看这个频道的消息（频道 ID）。' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ts: { type: 'string' },
                  channel: { type: 'string' },
                  user: { type: 'string' },
                  text: { type: 'string' },
                },
                required: ['ts', 'channel', 'user', 'text'],
                additionalProperties: false,
              },
            },
            remaining: { type: 'integer' },
            receiving: { type: 'boolean' },
          },
          required: ['messages', 'remaining', 'receiving'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const messages = Array.isArray(shaped.messages) ? shaped.messages : []
          if (shaped.receiving !== true) {
            return block('收件箱未启用：没有配置 App-Level Token（xapp-）或 Socket Mode 没连上。')
          }
          if (messages.length === 0) return block('暂时没有新消息。')
          const lines = messages.map((item) => {
            const message = asRecord(item)
            return `<${String(message.channel ?? '')}> ${String(message.user ?? '')}: ${String(message.text ?? '')}（ts ${String(message.ts ?? '')}）`
          })
          return block(lines.join('\n'))
        },
      },
      timeoutMs: 15_000,
      async execute(args) {
        const shaped = asRecord(args)
        const rawLimit = shaped.limit
        const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 10
        const channel = optionalText(shaped.channel)
        const messages = deps.inbox().take(limit, channel !== '' ? channel : undefined)
        const socket = deps.socket()
        return {
          messages: messages.map((message) => ({
            ts: message.ts,
            channel: message.channel,
            user: message.user,
            text: message.text,
          })),
          remaining: deps.inbox().size,
          receiving: socket !== undefined && socket.state() === 'connected',
        }
      },
    },

    {
      name: 'slack_status',
      description: '诊断 Slack 连接：令牌是否有效、Socket Mode 连接状态、收件箱积压。排查问题时先调这个。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            token: { type: 'string', enum: ['ok', 'invalid', 'missing'] },
            team: { type: 'string' },
            user: { type: 'string' },
            socket: { type: 'string' },
            socketAttempts: { type: 'integer' },
            inbox: { type: 'integer' },
            detail: { type: 'string' },
          },
          required: ['token', 'socket', 'socketAttempts', 'inbox', 'detail'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          return block(
            [
              `令牌：${String(shaped.token ?? '')}`,
              shaped.team !== undefined ? `工作区：${String(shaped.team)}` : '',
              shaped.user !== undefined ? `身份：${String(shaped.user)}` : '',
              `Socket Mode：${String(shaped.socket ?? '')}`,
              `收件箱：${String(shaped.inbox ?? 0)} 条`,
              String(shaped.detail ?? ''),
            ]
              .filter((line) => line !== '')
              .join('\n'),
          )
        },
      },
      timeoutMs: 20_000,
      async execute() {
        const config = deps.config()
        const socket = deps.socket()
        const socketState = socket?.state() ?? 'idle'
        const socketAttempts = socket?.attempts() ?? 0
        const inbox = deps.inbox().size
        if (config.token === '') {
          return {
            token: 'missing',
            socket: socketState,
            socketAttempts,
            inbox,
            detail: '未配置令牌：设置 DSH_SLACK_BOT_TOKEN 或插件配置里的 token。',
          }
        }
        try {
          requireToken(config)
          const identity = await deps.api().identity()
          return {
            token: identity.ok ? 'ok' : 'invalid',
            ...(identity.team !== undefined ? { team: identity.team } : {}),
            ...(identity.user !== undefined ? { user: identity.user } : {}),
            socket: socketState,
            socketAttempts,
            inbox,
            detail: identity.ok ? '连接正常。' : '令牌被 Slack 拒绝。',
          }
        } catch (error) {
          return {
            token: 'invalid',
            socket: socketState,
            socketAttempts,
            inbox,
            detail: describeSlackError(error),
          }
        }
      },
    },
  ]
}
