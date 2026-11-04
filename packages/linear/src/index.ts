import { createMcpPlugin } from '@plaudai/dsh-mcp-oauth'

/**
 * Linear — official hosted MCP server.
 *
 * Linear supports Dynamic Client Registration, so the browser flow needs no
 * pre-registered app. Teams that prefer a static key can set
 * `auth: bearer` + `bearerTokenEnv: LINEAR_API_KEY` in the profile patch.
 */
const plugin = createMcpPlugin({
  serverName: 'linear',
  transport: 'streamable-http',
  auth: 'oauth',
  url: 'https://mcp.linear.app/mcp',
})

export const name = plugin.name
export const inject = plugin.inject
export const Config = plugin.Config
export const apply = plugin.apply
