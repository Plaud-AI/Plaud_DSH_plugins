/**
 * 飞书 OpenAPI 的最小客户端：进程内缓存 tenant_access_token，失效时刷新一次。
 *
 * 只用内置 fetch，不引入第三方依赖。
 */

/** 运行期配置。 */
export interface FeishuConfig {
  appId: string
  appSecret: string
  /** open.feishu.cn（中国）或 open.larksuite.com（国际）。 */
  domain: string
  /** 会话白名单（chat_id 或群名）；空表示不限制。 */
  allowedChats: string[]
}

/** 飞书业务错误。 */
export class FeishuError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'FeishuError'
    this.code = code
  }
}

/** 需要重新取 token 的错误码。 */
const TOKEN_ERRORS = new Set([99991661, 99991663, 99991668, 20005])

/** 把飞书错误码翻译成可操作的提示，绝不回显凭据。 */
export function describeFeishuError(code: number, message: string): string {
  switch (code) {
    case 10003:
    case 10014:
      return `飞书参数错误（${code}）：${message}`
    case 10001:
    case 10002:
      return `飞书应用凭据无效（${code}）：检查 App ID / App Secret 是否复制完整，应用是否已发布。`
    case 99991672:
      return `飞书权限不足（${code}）：到开发者后台「权限管理」给应用开通对应的只读权限，等待几分钟生效。`
    case 1061004:
    case 131005:
      return `没有该文档的访问权限（${code}）：把文档共享给这个应用，或把应用加入文档所在的群。`
    case 131006:
    case 1061045:
      return `文档或节点不存在（${code}）：检查链接是否失效、token 是否完整。`
    case 230002:
    case 230027:
      return `应用不在该群（${code}）：把机器人拉进群后再读消息。`
    default:
      if (TOKEN_ERRORS.has(code)) return `飞书令牌失效（${code}）：已尝试自动刷新，仍失败请检查应用凭据。`
      return `飞书调用失败（${code}）：${message}`
  }
}

/** JSON 结构里的宽松取值。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 客户端接口。 */
export interface FeishuClient {
  /** 发一个请求并返回 data 字段。 */
  request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    options?: { query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T>
  /** token 的有效期状态，用于健康检查。 */
  tokenStatus(): { hasToken: boolean; expiresInSeconds: number }
}

export function createFeishuClient(getConfig: () => FeishuConfig): FeishuClient {
  let token = ''
  let expiresAt = 0
  let issuedAt = 0

  const base = (): string => `https://${getConfig().domain}`

  const fetchToken = async (): Promise<string> => {
    const config = getConfig()
    const response = await fetch(`${base()}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    })
    const payload = asRecord(await response.json().catch(() => ({})))
    const code = typeof payload.code === 'number' ? payload.code : -1
    if (code !== 0) {
      const message = typeof payload.msg === 'string' ? payload.msg : `HTTP ${response.status}`
      throw new FeishuError(code, describeFeishuError(code, message))
    }
    const value = typeof payload.tenant_access_token === 'string' ? payload.tenant_access_token : ''
    if (value === '') throw new FeishuError(code, '飞书没有返回 tenant_access_token，请检查应用凭据。')
    const expire = typeof payload.expire === 'number' ? payload.expire : 7200
    token = value
    issuedAt = Date.now()
    expiresAt = Date.now() + Math.max(60, expire - 300) * 1000
    return token
  }

  const ensureToken = async (): Promise<string> => {
    if (token !== '' && Date.now() < expiresAt) return token
    return fetchToken()
  }

  const request = async <T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> => {
    const attempt = async (): Promise<T> => {
      const current = await ensureToken()
      const url = new URL(`${base()}${path}`)
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
      }
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${current}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        ...(method === 'POST' && options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      })
      const payload = asRecord(await response.json().catch(() => ({})))
      const code = typeof payload.code === 'number' ? payload.code : response.ok ? 0 : -1
      if (code !== 0) {
        const message = typeof payload.msg === 'string' ? payload.msg : `HTTP ${response.status}`
        throw new FeishuError(code, describeFeishuError(code, message))
      }
      return (payload.data ?? {}) as T
    }

    try {
      return await attempt()
    } catch (error) {
      if (error instanceof FeishuError && TOKEN_ERRORS.has(error.code) && Date.now() - issuedAt > 5_000) {
        token = ''
        expiresAt = 0
        return attempt()
      }
      throw error
    }
  }

  return {
    request,
    tokenStatus: () => ({
      hasToken: token !== '' && Date.now() < expiresAt,
      expiresInSeconds: Math.max(0, Math.round((expiresAt - Date.now()) / 1000)),
    }),
  }
}
