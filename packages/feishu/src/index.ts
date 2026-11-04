import { createMcpPlugin } from '@plaud/dsh-mcp-oauth'

/**
 * Feishu / Lark — official OpenAPI MCP server.
 *
 * Lark ships `@larksuiteoapi/lark-mcp` as a stdio server, so this connector
 * spawns it with `npx` and passes app credentials as command arguments. They
 * cannot ride in `env`: the host strips credential-shaped environment names
 * from child processes, and so does this bridge.
 */
const plugin = createMcpPlugin({
  serverName: 'feishu',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@larksuiteoapi/lark-mcp', 'mcp'],
})

export const name = plugin.name
export const inject = plugin.inject
export const Config = plugin.Config
export const apply = plugin.apply
