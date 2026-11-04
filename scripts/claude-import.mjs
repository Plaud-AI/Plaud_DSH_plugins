#!/usr/bin/env node
/**
 * Claude 网页端导出 → DSH 工作区 Markdown。
 *
 * claude.ai 没有开放"读我的对话"接口，唯一的正规出口是
 * Settings → Privacy → Export data 发到邮箱的那份 JSON。这个脚本把
 * conversations.json 拆成一堆可检索的 Markdown，放进 DSH 工作区，
 * 之后 grep / read / 让模型总结都能直接用。
 *
 * 用法：
 *   node scripts/claude-import.mjs <conversations.json> [输出目录]
 *
 * 默认输出到 <cwd>/claude-import。重复导入会覆盖同名文件，不会产生副本。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [, , inputArg, outputArg] = process.argv
if (!inputArg) {
  console.error('用法: node scripts/claude-import.mjs <conversations.json> [输出目录]')
  process.exit(2)
}

const input = resolve(inputArg)
const output = resolve(outputArg ?? 'claude-import')

/** 导出文件的顶层有时是数组，有时是 { conversations: [...] }。 */
function loadConversations(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw.conversations ?? [])
  if (!Array.isArray(list)) throw new Error(`${path} 里没有找到 conversations 数组`)
  return list
}

/** 消息正文可能散在 text 或 content[] 里。 */
function messageText(message) {
  if (typeof message.text === 'string' && message.text.trim() !== '') return message.text.trim()
  const content = message.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (typeof block?.text === 'string') return block.text
        if (typeof block?.content === 'string') return block.content
        return ''
      })
      .filter((part) => part.trim() !== '')
      .join('\n\n')
      .trim()
  }
  return ''
}

function speaker(message) {
  const sender = String(message.sender ?? message.role ?? '').toLowerCase()
  if (sender === 'human' || sender === 'user') return 'Human'
  if (sender === 'assistant' || sender === 'ai') return 'Assistant'
  return sender === '' ? 'Unknown' : sender
}

/** 文件名要跨平台安全，且保持稳定（同一会话重复导入落到同一个文件）。 */
function slug(value, fallback) {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return cleaned === '' ? fallback : cleaned
}

function stamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const conversations = loadConversations(input)
mkdirSync(output, { recursive: true })

const rows = []
let messages = 0

for (const conversation of conversations) {
  const uuid = String(conversation.uuid ?? conversation.id ?? '')
  const title = slug(conversation.name ?? conversation.title, 'untitled')
  const date = stamp(conversation.created_at ?? conversation.updated_at)
  const shortId = uuid.slice(0, 8) || 'unknown'
  const fileName = `${date || '0000-00-00'}-${title}-${shortId}.md`.replace(/\s+/g, '-')

  const list = Array.isArray(conversation.chat_messages)
    ? conversation.chat_messages
    : Array.isArray(conversation.messages)
      ? conversation.messages
      : []

  const body = []
  for (const message of list) {
    const text = messageText(message)
    if (text === '') continue
    messages += 1
    body.push(`### ${speaker(message)} · ${message.created_at ?? ''}`.trim(), '', text, '')
  }

  const frontmatter = [
    '---',
    `title: "${String(conversation.name ?? conversation.title ?? 'untitled').replace(/"/g, "'")}"`,
    `uuid: "${uuid}"`,
    `created: "${conversation.created_at ?? ''}"`,
    `updated: "${conversation.updated_at ?? ''}"`,
    `messages: ${list.length}`,
    'source: claude.ai export',
    '---',
    '',
  ].join('\n')

  writeFileSync(join(output, fileName), `${frontmatter}# ${conversation.name ?? conversation.title ?? 'untitled'}\n\n${body.join('\n')}`)
  rows.push({ date: date || '0000-00-00', title: String(conversation.name ?? conversation.title ?? 'untitled'), fileName, count: list.length })
}

rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

const index = [
  '# Claude 对话索引',
  '',
  `导入时间：${new Date().toISOString()}`,
  `来源文件：${input}`,
  `会话数：${rows.length}　消息数：${messages}`,
  '',
  '| 日期 | 标题 | 消息 | 文件 |',
  '| --- | --- | --- | --- |',
  ...rows.map((row) => `| ${row.date} | ${row.title.replace(/\|/g, '/')} | ${row.count} | [${row.fileName}](./${row.fileName}) |`),
  '',
].join('\n')

writeFileSync(join(output, 'index.md'), index)

console.log(`导入完成：${rows.length} 个会话、${messages} 条消息`)
console.log(`输出目录：${output}`)
console.log(`索引：${join(output, 'index.md')}`)
