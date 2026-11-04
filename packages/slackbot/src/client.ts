import { WebClient } from '@slack/web-api'

/** 频道的最小信息。 */
export interface ChannelInfo {
  id: string
  name: string
  isPrivate: boolean
}

/** 发消息的回执。 */
export interface PostedMessage {
  ts: string
  channel: string
}

/** 一条消息（只保留读取场景需要的字段）。 */
export interface SlackMessage {
  ts: string
  user: string
  text: string
  threadTs?: string
  replyCount?: number
}

/** 搜索命中的一条消息。 */
export interface SearchMatch {
  channel: string
  channelName: string
  ts: string
  user: string
  text: string
  permalink?: string
}

/** Slack API 的调用面，测试可替换。 */
export interface SlackApi {
  postMessage(params: { channel: string; text: string; threadTs?: string }): Promise<PostedMessage>
  listChannels(): Promise<ChannelInfo[]>
  /** 读频道最近的消息。 */
  history(params: { channel: string; limit: number }): Promise<SlackMessage[]>
  /** 读某条消息的线程回复。 */
  replies(params: { channel: string; ts: string; limit: number }): Promise<SlackMessage[]>
  /** 全文搜索（需要用户令牌 + search:read）。 */
  search(params: { query: string; count: number }): Promise<{ matches: SearchMatch[]; total: number }>
  identity(): Promise<{ ok: boolean; team?: string; user?: string; teamId?: string }>
}

/** 把 Slack 错误码翻译成可操作的说明，绝不回显令牌。 */
export function describeSlackError(error: unknown): string {
  const shape = error as { data?: { error?: unknown }; code?: unknown; message?: unknown } | null | undefined
  const code = typeof shape?.data?.error === 'string' ? shape.data.error : ''
  switch (code) {
    case 'invalid_auth':
    case 'not_authed':
    case 'account_inactive':
    case 'token_revoked':
    case 'token_expired':
      return `Slack 认证失败（${code}）：令牌无效、已撤销或过期，请重新安装应用并更新令牌。`
    case 'not_in_channel':
      return '机器人不在该频道：先在 Slack 里把机器人邀请进这个频道（/invite @你的机器人）。'
    case 'channel_not_found':
      return '频道不存在或机器人看不到它：改用频道 ID，或把机器人邀请进该频道。'
    case 'is_archived':
      return '该频道已归档，不能发消息。'
    case 'missing_scope':
      return '令牌缺少权限：到 Slack App 的 OAuth & Permissions 补上需要的 scope（读取用 channels:history / groups:history / im:history / search:read，发送用 chat:write），重新安装应用后复制新令牌。'
    case 'not_allowed_token_type':
      return '这个接口不接受当前令牌类型：读取历史/搜索需要用户令牌（xoxp-），机器人令牌做不到。'
    case 'ratelimited':
    case 'rate_limited':
      return 'Slack 限流：请稍后重试。'
    case 'msg_too_long':
      return '消息太长，Slack 上限约 40000 字符。'
    default:
      break
  }
  const message = typeof shape?.message === 'string' ? shape.message : ''
  if (message !== '') return `Slack 调用失败：${message}`
  return 'Slack 调用失败：未知错误。'
}

/** 只保留读取需要的字段，过滤掉系统子类型（频道加入、编辑等）。 */
function normalizeMessages(raw: readonly unknown[] | undefined): SlackMessage[] {
  const messages: SlackMessage[] = []
  for (const item of raw ?? []) {
    const shaped = item as
      | { ts?: unknown; user?: unknown; text?: unknown; thread_ts?: unknown; reply_count?: unknown; subtype?: unknown; bot_id?: unknown }
      | undefined
    if (typeof shaped?.ts !== 'string' || shaped.ts === '') continue
    if (typeof shaped.subtype === 'string' && shaped.subtype !== '') continue
    const user =
      typeof shaped.user === 'string' && shaped.user !== ''
        ? shaped.user
        : typeof shaped.bot_id === 'string'
          ? `bot:${shaped.bot_id}`
          : ''
    messages.push({
      ts: shaped.ts,
      user,
      text: typeof shaped.text === 'string' ? shaped.text : '',
      ...(typeof shaped.thread_ts === 'string' && shaped.thread_ts !== shaped.ts ? { threadTs: shaped.thread_ts } : {}),
      ...(typeof shaped.reply_count === 'number' ? { replyCount: shaped.reply_count } : {}),
    })
  }
  return messages
}

/** 用官方 SDK 建一个客户端。 */
export function createSlackApi(token: string): SlackApi {
  const client = new WebClient(token, {
    timeout: 25_000,
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
  })

  return {
    async postMessage(params): Promise<PostedMessage> {
      const result = await client.chat.postMessage({
        channel: params.channel,
        text: params.text,
        ...(params.threadTs !== undefined ? { thread_ts: params.threadTs } : {}),
      })
      const ts = typeof result.ts === 'string' ? result.ts : ''
      if (ts === '') throw new Error('Slack 没有返回消息回执，发消息结果未知：请先在频道里确认再重试，避免重复发送。')
      return { ts, channel: params.channel }
    },

    async listChannels(): Promise<ChannelInfo[]> {
      const channels: ChannelInfo[] = []
      const seen = new Set<string>()
      let cursor = ''
      for (let page = 0; page < 20; page += 1) {
        const result = await client.conversations.list({
          types: 'public_channel,private_channel',
          limit: 200,
          exclude_archived: true,
          ...(cursor !== '' ? { cursor } : {}),
        })
        for (const channel of result.channels ?? []) {
          if (typeof channel.id !== 'string' || typeof channel.name !== 'string') continue
          if (seen.has(channel.id)) continue
          seen.add(channel.id)
          channels.push({ id: channel.id, name: channel.name, isPrivate: channel.is_private === true })
        }
        const next = result.response_metadata?.next_cursor
        if (typeof next !== 'string' || next === '' || next === cursor) break
        cursor = next
      }
      return channels
    },

    async history(params): Promise<SlackMessage[]> {
      const result = await client.conversations.history({ channel: params.channel, limit: params.limit })
      return normalizeMessages(result.messages)
    },

    async replies(params): Promise<SlackMessage[]> {
      const result = await client.conversations.replies({
        channel: params.channel,
        ts: params.ts,
        limit: params.limit,
      })
      return normalizeMessages(result.messages)
    },

    async search(params) {
      const result = await client.search.messages({
        query: params.query,
        count: params.count,
        sort: 'timestamp',
        sort_dir: 'desc',
      })
      const matches: SearchMatch[] = []
      for (const match of result.messages?.matches ?? []) {
        const channel = match.channel
        const channelId = typeof channel?.id === 'string' ? channel.id : ''
        const channelName = typeof channel?.name === 'string' ? channel.name : channelId
        if (channelId === '' || typeof match.ts !== 'string') continue
        matches.push({
          channel: channelId,
          channelName,
          ts: match.ts,
          user: typeof match.user === 'string' ? match.user : (typeof match.username === 'string' ? match.username : ''),
          text: typeof match.text === 'string' ? match.text : '',
          ...(typeof match.permalink === 'string' ? { permalink: match.permalink } : {}),
        })
      }
      return { matches, total: typeof result.messages?.total === 'number' ? result.messages.total : matches.length }
    },

    async identity() {      const result = await client.auth.test()
      return {
        ok: result.ok === true,
        ...(typeof result.team === 'string' ? { team: result.team } : {}),
        ...(typeof result.user === 'string' ? { user: result.user } : {}),
        ...(typeof result.team_id === 'string' ? { teamId: result.team_id } : {}),
      }
    },
  }
}
