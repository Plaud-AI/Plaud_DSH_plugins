import { asRecord, describeFeishuError, FeishuError, type FeishuClient, type FeishuConfig } from './http.js'
import { flattenValue, formatTime, parseTarget, renderMessageBody } from './format.js'

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

export interface ToolDeps {
  config(): FeishuConfig
  client(): FeishuClient
}

function block(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function required(args: Record<string, unknown>, key: string): string {
  const value = text(args[key])
  if (value === '') throw new Error(`缺少必填参数 ${key}。`)
  return value
}

function clamp(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(1, Math.trunc(value)))
}

function items(value: unknown): Array<Record<string, unknown>> {
  const shaped = asRecord(value)
  return Array.isArray(shaped.items) ? (shaped.items as Array<Record<string, unknown>>) : []
}

/** 统一把飞书错误转成可读文案。 */
async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof FeishuError) throw new Error(error.message)
    throw new Error(`飞书调用失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 把 open_id 批量换成姓名；没有通讯录权限时保持原样。 */
async function resolveUsers(client: FeishuClient, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const unique = [...new Set(ids.filter((id) => id !== ''))]
  for (let index = 0; index < unique.length; index += 50) {
    const batch = unique.slice(index, index + 50)
    try {
      const data = asRecord(
        await client.request('GET', '/open-apis/contact/v3/users/batch', {
          query: { user_ids: batch.join(','), user_id_type: 'open_id' },
        }),
      )
      for (const user of Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []) {
        const id = text(user.open_id) || text(user.user_id)
        const name = text(user.name)
        if (id !== '' && name !== '') names.set(id, name)
      }
    } catch {
      break
    }
  }
  return names
}

/** 会话白名单：空=不限。 */
function chatAllowed(config: FeishuConfig, chatId: string, chatName: string): boolean {
  if (config.allowedChats.length === 0) return true
  return config.allowedChats.some((entry) => {
    const wanted = entry.trim()
    return wanted === chatId || wanted === chatName
  })
}

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  return [
    {
      name: 'feishu_status',
      description: '诊断飞书连接：应用凭据是否有效、token 剩余时间、能否读到会话。排查问题时先调这个。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            detail: { type: 'string' },
            tokenExpiresInSeconds: { type: 'integer' },
          },
          required: ['ok', 'detail', 'tokenExpiresInSeconds'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          return block(`飞书：${String(shaped.detail ?? '')}（token 剩余 ${String(shaped.tokenExpiresInSeconds ?? 0)} 秒）`)
        },
      },
      timeoutMs: 20_000,
      async execute() {
        const config = deps.config()
        const source = config.source ?? 'none'
        if (config.appId === '' || config.appSecret === '') {
          return {
            ok: false,
            detail: `未找到应用凭据（来源 ${source}）：设置 FEISHU_APP_ID / FEISHU_APP_SECRET，或在 DSH 设置里配飞书机器人让插件自动复用。`,
            tokenExpiresInSeconds: 0,
          }
        }
        try {
          const data = asRecord(await deps.client().request('GET', '/open-apis/im/v1/chats', { query: { page_size: 1 } }))
          const status = deps.client().tokenStatus()
          const total = Array.isArray(data.items) ? data.items.length : 0
          return {
            ok: true,
            detail: total > 0 ? '连接正常，能读到会话。' : '连接正常，但应用看不到任何会话（还没被拉进群）。',
            tokenExpiresInSeconds: status.expiresInSeconds,
          }
        } catch (error) {
          return {
            ok: false,
            detail: error instanceof Error ? error.message : describeFeishuError(-1, String(error)),
            tokenExpiresInSeconds: 0,
          }
        }
      },
    },

    {
      name: 'feishu_chats',
      description: '列出应用所在的飞书群（群名、chat_id、成员数）。读群消息前先用它拿 chat_id。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '最多几个，默认 50，上限 100。', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            chats: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  chat_id: { type: 'string' },
                  name: { type: 'string' },
                  memberCount: { type: 'integer' },
                },
                required: ['chat_id', 'name'],
                additionalProperties: false,
              },
            },
          },
          required: ['chats'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const chats = Array.isArray(shaped.chats) ? shaped.chats : []
          if (chats.length === 0) return block('应用当前不在任何群里：把机器人拉进群后再试。')
          return block(
            chats
              .map((item) => {
                const chat = asRecord(item)
                const members = typeof chat.memberCount === 'number' ? `（${chat.memberCount} 人）` : ''
                return `${String(chat.name ?? '')} ${String(chat.chat_id ?? '')}${members}`
              })
              .join('\n'),
          )
        },
      },
      timeoutMs: 30_000,
      async execute(args) {
        const limit = clamp(asRecord(args).limit, 50, 100)
        const data = await call(() =>
          deps.client().request('GET', '/open-apis/im/v1/chats', { query: { page_size: limit } }),
        )
        const config = deps.config()
        const chats = items(data)
          .map((chat) => ({
            chat_id: text(chat.chat_id),
            name: text(chat.name) || text(chat.chat_id),
            ...(typeof chat.member_count === 'number' ? { memberCount: chat.member_count } : {}),
          }))
          .filter((chat) => chat.chat_id !== '' && chatAllowed(config, chat.chat_id, chat.name))
        return { chats }
      },
    },

    {
      name: 'feishu_messages',
      description: '读取某个群最近的聊天消息（从新到旧）。chat_id 来自 feishu_chats；返回作者、时间与正文。',
      parameters: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: '群的 chat_id（oc_ 开头）。' },
          limit: { type: 'integer', description: '最多几条，默认 20，上限 50。', minimum: 1, maximum: 50 },
          resolve_names: {
            type: 'boolean',
            description: '是否把作者 open_id 解析成姓名，默认 true（需要通讯录只读权限，没有就显示 ID）。',
          },
        },
        required: ['chat_id'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string' },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'string' },
                  sender: { type: 'string' },
                  text: { type: 'string' },
                },
                required: ['time', 'sender', 'text'],
                additionalProperties: false,
              },
            },
          },
          required: ['chat_id', 'messages'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const messages = Array.isArray(shaped.messages) ? shaped.messages : []
          if (messages.length === 0) return block('这个群没有读到消息。')
          return block(
            messages
              .map((item) => {
                const message = asRecord(item)
                return `[${String(message.time ?? '')}] ${String(message.sender ?? '')}: ${String(message.text ?? '')}`
              })
              .join('\n'),
          )
        },
      },
      timeoutMs: 40_000,
      async execute(args) {
        const shaped = asRecord(args)
        const chatId = required(shaped, 'chat_id')
        const config = deps.config()
        if (!chatAllowed(config, chatId, chatId)) throw new Error(`群 ${chatId} 不在允许列表内（allowedChats）。`)
        const limit = clamp(shaped.limit, 20, 50)
        const data = await call(() =>
          deps.client().request('GET', '/open-apis/im/v1/messages', {
            query: {
              container_id_type: 'chat',
              container_id: chatId,
              page_size: limit,
              sort_type: 'ByCreateTimeDesc',
            },
          }),
        )
        const raw = items(data)
        const ids = raw.map((item) => text(asRecord(item.sender).id))
        const names = shaped.resolve_names === false ? new Map<string, string>() : await resolveUsers(deps.client(), ids)
        const messages = raw.map((item) => {
          const sender = asRecord(item.sender)
          const id = text(sender.id)
          return {
            time: formatTime(item.create_time),
            sender: names.get(id) ?? (id !== '' ? id : text(sender.sender_type) || 'unknown'),
            text: renderMessageBody(text(item.msg_type), asRecord(item.body).content),
          }
        })
        return { chat_id: chatId, messages }
      },
    },

    {
      name: 'feishu_doc',
      description:
        '读取飞书云文档的纯文本正文。可以直接粘文档链接（/docx/ 或 /wiki/ 都行），也可以给 document_id。',
      parameters: {
        type: 'object',
        properties: {
          document: { type: 'string', description: '文档链接或 document_id。' },
        },
        required: ['document'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            document_id: { type: 'string' },
            characters: { type: 'integer' },
            content: { type: 'string' },
          },
          required: ['document_id', 'characters', 'content'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const content = String(shaped.content ?? '')
          if (content === '') return block('文档是空的，或者没有读取权限。')
          return block(content)
        },
      },
      timeoutMs: 40_000,
      async execute(args) {
        const shaped = asRecord(args)
        const target = parseTarget(required(shaped, 'document'))
        let documentId = target.token
        if (target.kind === 'wiki') {
          const nodeData = asRecord(
            await call(() =>
              deps.client().request('GET', '/open-apis/wiki/v2/spaces/get_node', {
                query: { token: documentId, obj_type: 'wiki' },
              }),
            ),
          )
          const node = asRecord(nodeData.node)
          const objType = text(node.obj_type)
          if (objType !== '' && objType !== 'docx' && objType !== 'doc') {
            throw new Error(`这个知识库节点是 ${objType} 类型，请用对应的工具读取。`)
          }
          documentId = text(node.obj_token)
          if (documentId === '') throw new Error('知识库节点没有返回文档 token。')
        }
        const data = await call(() =>
          deps.client().request(
            'GET',
            `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,
          ),
        )
        const content = text(asRecord(data).content)
        return { document_id: documentId, characters: content.length, content }
      },
    },

    {
      name: 'feishu_wiki',
      description: '浏览知识库：不给 space_id 就列出所有知识空间；给了就列出该空间下的节点（含子节点标记）。',
      parameters: {
        type: 'object',
        properties: {
          space_id: { type: 'string', description: '知识空间 ID（省略=列出所有空间）。' },
          parent_node_token: { type: 'string', description: '只看某个节点下的子节点（可选）。' },
          limit: { type: 'integer', description: '最多几条，默认 50，上限 100。', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  type: { type: 'string' },
                },
                required: ['id', 'title', 'type'],
                additionalProperties: false,
              },
            },
          },
          required: ['mode', 'entries'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const entries = Array.isArray(shaped.entries) ? shaped.entries : []
          if (entries.length === 0) return block('没有读到知识库内容。')
          return block(
            entries
              .map((item) => {
                const entry = asRecord(item)
                return `${String(entry.title ?? '')}（${String(entry.type ?? '')}，${String(entry.id ?? '')}）`
              })
              .join('\n'),
          )
        },
      },
      timeoutMs: 30_000,
      async execute(args) {
        const shaped = asRecord(args)
        const spaceId = text(shaped.space_id)
        const limit = clamp(shaped.limit, 50, 100)
        if (spaceId === '') {
          const data = await call(() =>
            deps.client().request('GET', '/open-apis/wiki/v2/spaces', { query: { page_size: limit } }),
          )
          const entries = items(data)
            .map((space) => ({
              id: text(space.space_id),
              title: text(space.name) || '(无名空间)',
              type: 'space',
            }))
            .filter((entry) => entry.id !== '')
          return { mode: 'spaces', entries }
        }
        const parent = text(shaped.parent_node_token)
        const data = await call(() =>
          deps.client().request('GET', `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
            query: { page_size: limit, ...(parent !== '' ? { parent_node_token: parent } : {}) },
          }),
        )
        const entries = items(data)
          .map((node) => ({
            id: text(node.node_token),
            title: text(node.title) || '(无标题)',
            type: text(node.obj_type) || 'node',
          }))
          .filter((entry) => entry.id !== '')
        return { mode: 'nodes', entries }
      },
    },

    {
      name: 'feishu_bitable',
      description:
        '读取多维表格：给 app_token（表格链接里的 /base/ 后那段）不带 table_id 列出所有数据表；带 table_id 则读取记录。',
      parameters: {
        type: 'object',
        properties: {
          app_token: { type: 'string', description: '多维表格链接或 app_token。' },
          table_id: { type: 'string', description: '数据表 ID（省略=只列表）。' },
          limit: { type: 'integer', description: '最多几条记录，默认 20，上限 100。', minimum: 1, maximum: 100 },
        },
        required: ['app_token'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
            tables: {
              type: 'array',
              items: {
                type: 'object',
                properties: { table_id: { type: 'string' }, name: { type: 'string' } },
                required: ['table_id', 'name'],
                additionalProperties: false,
              },
            },
            records: {
              type: 'array',
              items: {
                type: 'object',
                properties: { record_id: { type: 'string' }, fields: { type: 'string' } },
                required: ['record_id', 'fields'],
                additionalProperties: false,
              },
            },
          },
          required: ['mode'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const tables = Array.isArray(shaped.tables) ? shaped.tables : []
          if (tables.length > 0) {
            return block(
              tables
                .map((item) => {
                  const table = asRecord(item)
                  return `${String(table.name ?? '')} ${String(table.table_id ?? '')}`
                })
                .join('\n'),
            )
          }
          const records = Array.isArray(shaped.records) ? shaped.records : []
          if (records.length === 0) return block('这张表没有读到记录。')
          return block(
            records
              .map((item) => {
                const record = asRecord(item)
                return `${String(record.record_id ?? '')}: ${String(record.fields ?? '')}`
              })
              .join('\n\n'),
          )
        },
      },
      timeoutMs: 40_000,
      async execute(args) {
        const shaped = asRecord(args)
        const target = parseTarget(required(shaped, 'app_token'))
        const appToken = target.token
        const tableId = text(shaped.table_id)
        const limit = clamp(shaped.limit, 20, 100)
        if (tableId === '') {
          const data = await call(() =>
            deps.client().request(
              'GET',
              `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
              { query: { page_size: 100 } },
            ),
          )
          const tables = items(data)
            .map((table) => ({ table_id: text(table.table_id), name: text(table.name) }))
            .filter((table) => table.table_id !== '')
          return { mode: 'tables', tables }
        }
        const data = await call(() =>
          deps.client().request(
            'GET',
            `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
            { query: { page_size: limit } },
          ),
        )
        const records = items(data).map((record) => {
          const fields = asRecord(record.fields)
          const rendered = Object.entries(fields)
            .map(([key, value]) => `${key}=${flattenValue(value)}`)
            .join(' | ')
          return { record_id: text(record.record_id), fields: rendered }
        })
        return { mode: 'records', records }
      },
    },

    {
      name: 'feishu_sheet',
      description:
        '读取电子表格：给 spreadsheet（链接或 token），带 range 读单元格（如 `Sheet1!A1:C10`）；不带 range 只列出所有工作表。',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet: { type: 'string', description: '表格链接或 spreadsheet_token。' },
          range: { type: 'string', description: '读取范围，如 Sheet1!A1:C10。' },
        },
        required: ['spreadsheet'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
            sheets: {
              type: 'array',
              items: {
                type: 'object',
                properties: { sheet_id: { type: 'string' }, title: { type: 'string' } },
                required: ['sheet_id', 'title'],
                additionalProperties: false,
              },
            },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
            },
          },
          required: ['mode'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const sheets = Array.isArray(shaped.sheets) ? shaped.sheets : []
          if (sheets.length > 0) {
            return block(
              sheets
                .map((item) => {
                  const sheet = asRecord(item)
                  return `${String(sheet.title ?? '')} ${String(sheet.sheet_id ?? '')}`
                })
                .join('\n'),
            )
          }
          const rows = Array.isArray(shaped.rows) ? shaped.rows : []
          if (rows.length === 0) return block('这个范围没有数据。')
          return block(
            rows
              .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')).join(' | ') : ''))
              .join('\n'),
          )
        },
      },
      timeoutMs: 40_000,
      async execute(args) {
        const shaped = asRecord(args)
        const spreadsheet = parseTarget(required(shaped, 'spreadsheet')).token
        const range = text(shaped.range)
        if (range === '') {
          const data = await call(() =>
            deps.client().request(
              'GET',
              `/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheet)}/sheets/query`,
            ),
          )
          const sheets = items(data)
            .map((sheet) => ({ sheet_id: text(sheet.sheet_id), title: text(sheet.title) }))
            .filter((sheet) => sheet.sheet_id !== '')
          return { mode: 'sheets', sheets }
        }
        const data = await call(() =>
          deps.client().request(
            'GET',
            `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheet)}/values/${encodeURIComponent(range)}`,
          ),
        )
        const valueRange = asRecord(asRecord(data).valueRange)
        const values = Array.isArray(valueRange.values) ? valueRange.values : []
        const rows = values.map((row) =>
          Array.isArray(row) ? row.map((cell) => flattenValue(cell)) : [flattenValue(row)],
        )
        return { mode: 'values', rows }
      },
    },

    {
      name: 'feishu_drive',
      description: '列出云空间某个文件夹里的文件和文档（folder_token 省略=我的空间根目录）。',
      parameters: {
        type: 'object',
        properties: {
          folder_token: { type: 'string', description: '文件夹 token，省略=根目录。' },
          limit: { type: 'integer', description: '最多几个，默认 50，上限 100。', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['token', 'name', 'type'],
                additionalProperties: false,
              },
            },
          },
          required: ['files'],
          additionalProperties: false,
        },
        render: (_args, value) => {
          const shaped = asRecord(value)
          const files = Array.isArray(shaped.files) ? shaped.files : []
          if (files.length === 0) return block('这个目录是空的，或者没有访问权限。')
          return block(
            files
              .map((item) => {
                const file = asRecord(item)
                return `${String(file.name ?? '')}（${String(file.type ?? '')}，${String(file.token ?? '')}）`
              })
              .join('\n'),
          )
        },
      },
      timeoutMs: 30_000,
      async execute(args) {
        const shaped = asRecord(args)
        const folder = text(shaped.folder_token)
        const limit = clamp(shaped.limit, 50, 100)
        const data = await call(() =>
          deps.client().request('GET', '/open-apis/drive/v1/files', {
            query: { page_size: limit, ...(folder !== '' ? { folder_token: folder } : {}) },
          }),
        )
        const files = (Array.isArray(asRecord(data).files) ? (asRecord(data).files as Array<Record<string, unknown>>) : [])
          .map((file) => ({
            token: text(file.token),
            name: text(file.name) || '(无名)',
            type: text(file.type) || 'file',
            ...(text(file.url) !== '' ? { url: text(file.url) } : {}),
          }))
          .filter((file) => file.token !== '')
        return { files }
      },
    },
  ]
}
