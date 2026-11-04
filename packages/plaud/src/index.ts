import { createMcpPlugin } from '@plaud/dsh-mcp-oauth'

/**
 * PLAUD — internal MCP server.
 *
 * The endpoint is deployment-specific, so it comes from the profile patch
 * (`url`) rather than being baked in. Authentication is a static bearer token
 * read from the environment; swap `auth` to `oauth` once the server supports
 * Dynamic Client Registration.
 */
const plugin = createMcpPlugin({
  serverName: 'plaud',
  transport: 'streamable-http',
  auth: 'bearer',
  bearerTokenEnv: 'PLAUD_MCP_TOKEN',
  url: '',
})

export const name = plugin.name
export const inject = plugin.inject
export const Config = plugin.Config
export const apply = plugin.apply
