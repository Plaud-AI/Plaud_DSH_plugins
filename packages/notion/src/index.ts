import { createMcpPlugin } from '@plaud/dsh-mcp-oauth'

/**
 * Notion — official hosted Remote MCP.
 *
 * Notion publishes `https://mcp.notion.com/mcp` and supports Dynamic Client
 * Registration, so there is nothing to pre-register: the first tool call
 * triggers a browser authorization against the user's own Notion account.
 */
const plugin = createMcpPlugin({
  serverName: 'notion',
  transport: 'streamable-http',
  auth: 'oauth',
  url: 'https://mcp.notion.com/mcp',
  scope: '',
})

export const name = plugin.name
export const inject = plugin.inject
export const Config = plugin.Config
export const apply = plugin.apply
