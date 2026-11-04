import { createFeishuClient, type FeishuClient, type FeishuConfig } from './http.js'
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
}

export const name = 'feishu-read'
export const inject = ['tools']

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter((item) => item !== '')
  const raw = typeof value === 'string' ? value : ''
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/** 配置优先，环境变量兜底；缺凭据不报错，调用时才提示。 */
function parseConfig(raw: unknown): FeishuConfig {
  const source = (
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}
  ) as Record<string, unknown>
  const domain = text(source.domain) || text(process.env.FEISHU_DOMAIN) || 'open.feishu.cn'
  return {
    appId: text(source.appId) || text(process.env.FEISHU_APP_ID),
    appSecret: text(source.appSecret) || text(process.env.FEISHU_APP_SECRET),
    domain: domain.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    allowedChats: list(source.allowedChats).length > 0 ? list(source.allowedChats) : list(process.env.FEISHU_ALLOWED_CHATS),
  }
}

/**
 * 插件入口。
 *
 * 只读工具：token 在首次调用时获取并缓存，凭据缺失只影响调用结果，不影响
 * 插件加载。生命周期挂在 ctx.effect 上只是为了将来可扩展（当前无长连接）。
 */
export function apply(ctx: PluginContext, rawConfig: unknown): void {
  const config = parseConfig(rawConfig)
  const log = (message: string): void => {
    ctx.logger?.info?.(`[feishu-read] ${message}`)
  }

  const client: FeishuClient = createFeishuClient(() => parseConfig(rawConfig))

  if (config.appId === '' || config.appSecret === '') {
    ctx.logger?.warn?.(
      '[feishu-read] 未配置应用凭据：设置 FEISHU_APP_ID / FEISHU_APP_SECRET，或填插件配置里的 appId / appSecret。',
    )
  }

  const tools: ToolDefinition[] = buildTools({
    config: () => parseConfig(rawConfig),
    client: () => client,
  })

  for (const tool of tools) ctx.tools.register(tool)
  log(`已注册 ${tools.length} 个只读工具：${tools.map((tool) => tool.name).join(', ')}`)
}

export type { FeishuConfig }
