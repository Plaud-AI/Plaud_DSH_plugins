import { createMcpPlugin } from '@plaud/dsh-mcp-oauth';
/**
 * Slack — official hosted MCP server.
 *
 * Slack does **not** support Dynamic Client Registration: the client must be a
 * Slack app with a fixed app id, and the token endpoint requires a confidential
 * client. So this connector ships with `auth: oauth` but expects
 * `clientId` / `clientSecret` (and usually `authorizationParams.app_id`) to be
 * supplied by the profile patch from the environment.
 */
const plugin = createMcpPlugin({
    serverName: 'slack',
    transport: 'streamable-http',
    auth: 'oauth',
    url: 'https://mcp.slack.com/mcp',
});
export const name = plugin.name;
export const inject = plugin.inject;
export const Config = plugin.Config;
export const apply = plugin.apply;
