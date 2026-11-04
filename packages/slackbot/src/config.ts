/**
 * 配置解析：全部懒加载。
 *
 * 缺凭据【不失败】——插件照常加载，工具调用时再给出可操作的报错。这样一次
 * 配错不会把整个 DSH 的插件树拖垮（对比 MCP 连接器的启动即连）。
 */

/** 运行期配置：token 与 allowedChannels 决定能做什么。 */
export interface SlackBotConfig {
  /** 机器人令牌（xoxb-）或用户令牌（xoxp-）。 */
  token: string
  /** App-Level Token（xapp-）；有它才会启动 Socket Mode 收消息。 */
  appToken: string
  /** 未指定频道时的默认目标，如 #general。 */
  defaultChannel: string
  /** 允许操作的频道（id 或名字）。为空表示不限制。 */
  allowedChannels: string[]
}

/** 用户令牌（xoxp-）的环境变量名；只读场景优先用它。 */
export const ENV_USER_TOKEN = 'DSH_SLACK_USER_TOKEN'
/** 机器人令牌（xoxb-）的环境变量名。 */
export const ENV_TOKEN = 'DSH_SLACK_BOT_TOKEN'
/** appToken 的环境变量名。 */
export const ENV_APP_TOKEN = 'DSH_SLACK_APP_TOKEN'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter((item) => item !== '')
  const single = text(value)
  return single === '' ? [] : [single]
}

/** 先看用户令牌，再看机器人令牌；两个都没配就是空。 */
function tokenFromEnv(): string {
  return text(process.env[ENV_USER_TOKEN]) || text(process.env[ENV_TOKEN])
}

/** 解析原始配置：config 优先，环境变量兜底；形状不对就用空值。 */
export function parseConfig(raw: unknown): SlackBotConfig {
  const source = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const token = text(source.token) || tokenFromEnv()
  const appToken = text(source.appToken) || text(process.env[ENV_APP_TOKEN])
  return {
    token,
    appToken,
    defaultChannel: text(source.defaultChannel),
    allowedChannels: list(source.allowedChannels),
  }
}

/** 频道是否在允许列表内：空列表等于不限制。 */
export function isChannelAllowed(config: SlackBotConfig, channel: string): boolean {
  if (config.allowedChannels.length === 0) return true
  const normalized = channel.trim().replace(/^#/, '').toLowerCase()
  return config.allowedChannels.some((entry) => {
    const candidate = entry.trim().replace(/^#/, '').toLowerCase()
    return candidate === normalized || candidate === channel.trim().toLowerCase()
  })
}

/** 取 token；缺失时抛出可操作的错误。 */
export function requireToken(config: SlackBotConfig): string {
  if (config.token === '') {
    throw new Error(
      'Slack 令牌未配置：只读请用用户令牌（xoxp-，设 DSH_SLACK_USER_TOKEN）；只发消息用机器人令牌（xoxb-，设 DSH_SLACK_BOT_TOKEN）。设完要完全退出并重启 DSH。',
    )
  }
  return config.token
}

/** 取 appToken；只接受 xapp- 前缀。 */
export function resolveAppToken(config: SlackBotConfig): string {
  return config.appToken.startsWith('xapp-') ? config.appToken : ''
}
