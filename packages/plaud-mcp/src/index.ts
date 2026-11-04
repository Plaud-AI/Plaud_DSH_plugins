import { createMcpPlugin } from '@plaudai/dsh-mcp-oauth'

/**
 * PLAUD — official MCP server.
 *
 * PLAUD ships the MCP server as an npm package that speaks stdio
 * (`npx -y @plaud-ai/mcp@latest`), and it authenticates through its own
 * sign-in flow rather than through the MCP layer. That means:
 *
 *   - no endpoint to configure, no API key in the DSH config;
 *   - the account sign-in happens once outside Harness (`plaud login` or the
 *     installer), and the CLI stores the token itself;
 *   - the exposed tools are recordings / transcripts / documents, which is the
 *     read-only surface we want.
 *
 * The package name is intentionally a single argv token so the child can be
 * launched without shell quoting on Windows.
 */
const plugin = createMcpPlugin({
  serverName: 'plaud',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@plaud-ai/mcp@latest'],
})

export const name = plugin.name
export const inject = plugin.inject
export const Config = plugin.Config
export const apply = plugin.apply
