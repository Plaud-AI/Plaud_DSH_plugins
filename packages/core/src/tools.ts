import { createHash } from 'node:crypto'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'

/** Logger surface the host exposes to plugins. */
export interface PluginLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** The subset of the Cordis plugin context this bridge depends on. */
export interface PluginContext {
  tools: { register(definition: unknown): () => void }
  logger: PluginLogger
  effect(callback: () => (() => void) | void, label?: string): unknown
}

/** Budget for the public tool name, matching the host bridge's convention. */
const MAX_PUBLIC_NAME_LENGTH = 64
const HASH_LENGTH = 8

/**
 * Public tool name for one upstream tool: `mcp__<server>__<tool>`.
 *
 * Mirrors the host bridge's naming so permission rules, transcripts and
 * allowlists written for the built-in client keep working unchanged. Over-long
 * names collapse to a truncated form plus a stable hash.
 */
export function publicToolName(serverName: string, rawName: string): string {
  const sanitized = rawName.replace(/[^A-Za-z0-9_-]+/g, '_')
  const full = `mcp__${serverName}__${sanitized}`
  if (full.length <= MAX_PUBLIC_NAME_LENGTH) return full
  const digest = createHash('sha256').update(`${serverName}\u0000${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${full.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${digest}`
}

/** The connected MCP client as far as this bridge needs to see it. */
interface McpClientLike {
  getServerCapabilities(): { tools?: unknown } | undefined
  listTools(params: undefined, options: { cacheMode: 'refresh' }): Promise<{ tools: readonly McpToolLike[] }>
  callTool(
    request: { name: string; arguments: Record<string, unknown> },
    options: Record<string, unknown>,
  ): Promise<unknown>
}

interface McpToolLike {
  name: string
  description?: string | undefined
  inputSchema: unknown
  outputSchema?: unknown
  execution?: { taskSupport?: string | undefined } | undefined
}

export interface SyncOptions {
  serverName: string
  toolCallTimeoutMs: number
}

/**
 * Publish one MCP server's tool list on `ctx.tools`.
 *
 * Fetch first, swap second: a failed discovery leaves the previous generation
 * registered instead of half-replacing it.
 *
 * @returns number of tools registered for this server.
 */
export async function syncTools(
  client: McpClientLike,
  ctx: PluginContext,
  options: SyncOptions,
  live: Map<string, () => void>,
): Promise<number> {
  const capabilities = client.getServerCapabilities()
  const response =
    capabilities?.tools === undefined
      ? { tools: [] as readonly McpToolLike[] }
      : await client.listTools(undefined, { cacheMode: 'refresh' })

  const definitions = new Map<string, unknown>()
  for (const tool of response.tools) {
    const name = publicToolName(options.serverName, tool.name)
    if (definitions.has(name)) {
      throw new Error(
        `mcp-oauth(${options.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`,
      )
    }
    definitions.set(
      name,
      createMcpToolDefinition(ctx as never, {
        name,
        rawName: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        taskRequired: tool.execution?.taskSupport === 'required',
        call: (args: Record<string, unknown>, execution: { signal: AbortSignal }) =>
          client.callTool(
            { name: tool.name, arguments: args },
            { signal: execution.signal, timeout: options.toolCallTimeoutMs, toolDefinition: tool },
          ),
      } as never),
    )
  }

  for (const dispose of live.values()) dispose()
  live.clear()

  const registered = new Map<string, () => void>()
  try {
    for (const [name, definition] of definitions) {
      registered.set(name, ctx.tools.register(definition))
    }
  } catch (error) {
    for (const dispose of registered.values()) dispose()
    ctx.logger.error(`mcp-oauth(${options.serverName}): tool registration failed, no tools registered: ${String(error)}`)
    throw error
  }
  for (const [name, dispose] of registered) live.set(name, dispose)
  return registered.size
}
