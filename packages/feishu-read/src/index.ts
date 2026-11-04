import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createFeishuClient, type FeishuClient, type FeishuConfig } from './http.js'
import { buildTools, type ToolDefinition } from './tools.js'

/** 日志面（宿主注入）。 */
export interface PluginLogger {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

/** 插件的可用作用域。 */
export interface PluginContext {
  tools: { register(definition: unknown): void | (() => void) }
  logger?: PluginLogger
  effect?: (fn: () => void) => void
}

/** 凭据来源，便于排查“到底读到了哪一份”。 */
export type CredentialSource = 'config' | 'env' | 'dsh-integration' | 'none'

export interface ResolvedConfig extends FeishuConfig {
  source: CredentialSource
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter((item) => item !== '')
  return []
}

/**
 * 从 DSH 已有的飞书集成里读凭据：设置里配过机器人，就不用再复制一遍。
 *
 * `~/.dsh/integrations/<id>/config.json` 里每个 bot 有 appId 与 secretRef，
 * secretRef 是环境变量名；DSH 启动集成时把密钥注入进程环境，所以同进程的
 * 插件能直接读到。读不到就返回 null，交给上层回退。
 */
export function discoverDshFeishu(root = join(homedir(), '.dsh', 'integrations')): { appId: string; appSecret: string } | null {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  for (const entry of entries) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(root, entry, 'config.json'), 'utf8'))
    } catch {
      continue
    }
    const bots = (parsed as { bots?: unknown }).bots
    if (!Array.isArray(bots)) continue
    for (const bot of bots) {
      const shaped = bot as Record<string, unknown>
      const appId = text(shaped.appId)
      if (appId === '') continue
      const secretRef = text(shaped.secretRef)
      const secret = secretRef === '' ? '' : text(process.env[secretRef])
      if (secret === '') continue
      return { appId, appSecret: secret }
    }
  }
  return null
}

function parseConfig(raw: unknown): ResolvedConfig {
  const shaped = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const configuredId = text(shaped.appId)
  const configuredSecret = text(shaped.appSecret)
  if (configuredId !== '' && configuredSecret !== '') {
    return { appId: configuredId, appSecret: configuredSecret, domain: domain(shaped), allowedChats: list(shaped.allowedChats), source: 'config' }
  }
  const envId = text(process.env.FEISHU_APP_ID)
  const envSecret = text(process.env.FEISHU_APP_SECRET)
  if (envId !== '' && envSecret !== '') {
    return { appId: envId, appSecret: envSecret, domain: domain(shaped), allowedChats: list(shaped.allowedChats), source: 'env' }
  }
  const discovered = discoverDshFeishu()
  if (discovered !== null) {
    return { ...discovered, domain: domain(shaped), allowedChats: list(shaped.allowedChats), source: 'dsh-integration' }
  }
  return {
    appId: envId || configuredId,
    appSecret: envSecret || configuredSecret,
    domain: domain(shaped),
    allowedChats: list(shaped.allowedChats),
    source: 'none',
  }
}

function domain(shaped: Record<string, unknown>): string {
  const raw = text(shaped.domain) || text(process.env.FEISHU_DOMAIN) || 'open.feishu.cn'
  return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

export const name = 'feishu-read'
export const inject = ['tools']

export function apply(ctx: PluginContext, rawConfig: unknown): void {
  const resolved = parseConfig(rawConfig)
  const client: FeishuClient = createFeishuClient(() => parseConfig(rawConfig))

  ctx.logger?.info?.(
    `[feishu-read] 凭据来源：${resolved.source}（appId ${resolved.appId === '' ? '空' : resolved.appId}）`,
  )
  if (resolved.source === 'none') {
    ctx.logger?.warn?.(
      '[feishu-read] 没有找到飞书应用凭据：填 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量，或在 DSH 设置里配置飞书机器人（会自动复用）。',
    )
  }

  const tools: ToolDefinition[] = buildTools({
    config: () => parseConfig(rawConfig) satisfies ResolvedConfig,
    client: () => client,
  })
  for (const tool of tools) ctx.tools.register(tool)
  ctx.logger?.info?.(`[feishu-read] 已注册 ${tools.length} 个只读工具`)
}
