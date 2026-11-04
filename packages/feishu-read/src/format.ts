/**
 * 把飞书的链接、ID 和消息体规整成模型能直接用的文本。
 */

/** 链接里识别出的对象类型。 */
export type TargetKind = 'docx' | 'docs' | 'wiki' | 'base' | 'sheets' | 'token'

export interface Target {
  kind: TargetKind
  token: string
}

const PATTERNS: Array<{ kind: TargetKind; re: RegExp }> = [
  { kind: 'docx', re: /\/(?:docx|docs)\/([A-Za-z0-9_-]+)/ },
  { kind: 'wiki', re: /\/wiki\/([A-Za-z0-9_-]+)/ },
  { kind: 'base', re: /\/base\/([A-Za-z0-9_-]+)/ },
  { kind: 'sheets', re: /\/sheets\/([A-Za-z0-9_-]+)/ },
]

/**
 * 从链接或裸 token 里取出对象：用户粘链接比找 ID 容易得多。
 */
export function parseTarget(input: string): Target {
  const value = input.trim()
  for (const { kind, re } of PATTERNS) {
    const match = re.exec(value)
    if (match?.[1] !== undefined) return { kind, token: match[1] }
  }
  const bare = value.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '')
  return { kind: 'token', token: bare }
}

/** 毫秒时间戳（字符串或数字）→ `YYYY-MM-DD HH:mm`。 */
export function formatTime(raw: unknown): string {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 把消息体（JSON 字符串）渲染成纯文本。 */
export function renderMessageBody(msgType: string, rawBody: unknown): string {
  const text = typeof rawBody === 'string' ? rawBody : ''
  let content: Record<string, unknown> = {}
  try {
    content = JSON.parse(text) as Record<string, unknown>
  } catch {
    return text
  }
  switch (msgType) {
    case 'text':
      return typeof content.text === 'string' ? content.text : text
    case 'post': {
      const parts: string[] = []
      const title = typeof content.title === 'string' ? content.title : ''
      if (title !== '') parts.push(title)
      const lines = Array.isArray(content.content) ? content.content : []
      for (const line of lines) {
        if (!Array.isArray(line)) continue
        const pieces: string[] = []
        for (const node of line) {
          const shaped = node as { text?: unknown; tag?: unknown; href?: unknown; user_name?: unknown }
          if (typeof shaped.text === 'string') pieces.push(shaped.text)
          else if (typeof shaped.href === 'string') pieces.push(shaped.href)
          else if (typeof shaped.user_name === 'string') pieces.push(`@${shaped.user_name}`)
        }
        if (pieces.length > 0) parts.push(pieces.join(''))
      }
      return parts.join('\n')
    }
    case 'image':
      return '[图片]'
    case 'file':
      return typeof content.file_name === 'string' ? `[文件 ${content.file_name}]` : '[文件]'
    case 'audio':
      return '[语音]'
    case 'media':
      return '[视频]'
    case 'sticker':
      return '[表情]'
    case 'interactive':
      return '[卡片消息]'
    case 'share_chat':
      return '[群名片]'
    case 'share_user':
      return '[名片]'
    default:
      return text === '' ? `[${msgType}]` : text
  }
}

/** 单元格/字段取值的浅层展开：飞书字段常见是对象数组。 */
export function flattenValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenValue(item))
      .filter((item) => item !== '')
      .join(', ')
  }
  const shaped = value as Record<string, unknown>
  for (const key of ['text', 'name', 'link', 'value', 'full_address']) {
    if (typeof shaped[key] === 'string' && shaped[key] !== '') return shaped[key] as string
  }
  if (typeof shaped.en_name === 'string') return shaped.en_name
  return JSON.stringify(value)
}
