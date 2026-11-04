[简体中文](REFERENCE.zh.md) · English

# Reference

For maintainers and troubleshooting. For install and daily use, see the [README](../README.en.md).

## Why this exists

DeepSeek Harness ships `@deepseek-ai/dsh-mcp-client`, which handles transport (stdio / streamable-http) and static header injection:

```js
new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } })
```

There is no `authProvider`, so a 401 is terminal. Yet the official remote MCP servers for Notion, Linear and Slack all expect the standard flow: 401 → discovery → registration → PKCE → browser callback.

The amusing part: **the SDK already implements all of it**. `@modelcontextprotocol/client@2` carries `OAuthClientProvider`, DCR, PKCE, issuer validation and 401 retries, and `StreamableHTTPClientTransport` accepts an `authProvider`. Nobody had wired it up.

This repository wires it up.

## Layout

```
packages/
  core/     @plaud/dsh-mcp-oauth   OAuth provider + callback server + token store + tool bridge
  notion/   @plaud/dsh-plugin-notion
  linear/   @plaud/dsh-plugin-linear
  slack/    @plaud/dsh-plugin-slack
  plaud/    @plaud/dsh-plugin-plaud
  feishu/   @plaud/dsh-plugin-feishu
```

Every service package is a standalone Cordis plugin (`name` / `inject` / `Config` / `apply`) whose `cordis.patch.yml` references only its own package name. The core package is imported by them and never appears in a profile patch on its own — so the loader never has to resolve a nested path.

`core` supports three connection modes:

| `auth` | Used for | Token source |
| --- | --- | --- |
| `oauth` | Notion / Linear / Slack | Browser authorization, refreshed automatically |
| `bearer` | PLAUD and other internal servers | Environment variable |
| `none` | Public MCP servers | None |

## Per-service setup

### Notion

Nothing to configure. The first Notion tool call opens a browser and authorizes with your own Notion account.

Requirements:

- MCP is not disabled for the workspace (Settings → Notion MCP);
- the account is a member — guests cannot connect;
- MCP tokens are restricted to Business/Enterprise workspace owners, but this path uses OAuth and is not affected.

### Linear

Nothing to configure; DCR does the work. To use an API key instead:

```yaml
- id: mcp-linear
  name: '@plaud/dsh-plugin-linear'
  config:
    serverName: linear
    auth: bearer
    bearerTokenEnv: LINEAR_API_KEY
```

### Slack

Slack has no DCR, so you must register an app first:

1. Create an app at `api.slack.com/apps` with MCP enabled.
2. Export three values before starting the harness:

```powershell
$env:SLACK_MCP_CLIENT_ID = "..."
$env:SLACK_MCP_CLIENT_SECRET = "..."
$env:SLACK_MCP_APP_ID = "..."
```

3. The patch reads them through `!!js` and appends `app_id` to the authorization URL.

> `authorizationParams.app_id` is the one place this repository reaches around the SDK specification. It needs a real app to verify; if Slack rejects it, the parameter belongs in the client registration instead.

### PLAUD internal server

```powershell
$env:PLAUD_MCP_URL = "https://mcp.example.internal/mcp"
$env:PLAUD_MCP_TOKEN = "..."
```

When the server supports DCR, switch `auth` to `oauth` and drop the token.

### Feishu / Lark

Uses the official `@larksuiteoapi/lark-mcp` over stdio:

```powershell
$env:FEISHU_APP_ID = "cli_xxx"
$env:FEISHU_APP_SECRET = "xxx"
```

Credentials travel as command arguments because the host strips names matching `KEY|PASSWORD|SECRET|TOKEN` from MCP child environments, and this bridge does the same. The tradeoff is that the secret is visible in process arguments (`ps`) on the local machine — a constraint of Feishu's official MCP server, which only accepts CLI flags.

## Authorization flow

```
connect(url, authProvider)
  └─ 401 ──> WWW-Authenticate / .well-known/oauth-protected-resource
             └─> authorization server metadata (RFC 8414)
                 └─> DCR registration (RFC 7591) or pre-registered clientId
                     └─> PKCE + state → open browser
                         └─> callback on 127.0.0.1:<ephemeral port>/callback
                             └─> verify state → exchange code → persist tokens
                                 └─> reconnect with Authorization: Bearer
```

Expired tokens are refreshed with the refresh token. A failed refresh repeats the browser flow, with a 5 minute default timeout (`authTimeoutMs`).

## Where credentials live

```
$DSH_HOME/mcp-oauth/<serverName>.json    # default C:\Users\<you>\.dsh\mcp-oauth\
```

- Partitioned by **authorization server issuer**, so a token cannot be replayed against a different issuer (RFC 9207).
- Written via temp file + rename, mode `0600` (Windows chmod semantics are limited, but the file is not on a share).
- **Sign out**: delete the file and revoke the grant server-side (Notion: Settings → Notion MCP → disconnect; Slack: revoke the app).

## Security model

| Item | Approach |
| --- | --- |
| Tokens at rest | Only `$DSH_HOME/mcp-oauth/`, `0600`, never in a patch or in git |
| Secrets in config | Always `!!js process.env.X`, so config files stay shareable |
| Child environment | `KEY\|PASSWORD\|SECRET\|TOKEN` and `DSH_*` stripped, matching the host |
| Code trust | Only this repository's code runs in the host process; MCP servers stay on the other side of the wire |
| Permission scope | The server's tool set plus the user's own account permissions |
| Audit | Notion / Linear / Slack logs; locally filter sessions by `mcp__*` tool names |

## Known limits

- No settings page: authorization is a browser popup, sign-out deletes files.
- Tools only: resources, prompts and server instructions are not bridged.
- No automatic reconnect: the built-in bridge backs off exponentially, this one needs a restart in v0.1.
- Slack's `app_id` injection is unverified.
- `workspace:^` means `pnpm publish` is required; `npm publish` fails.
- Only the Windows build path has been exercised; macOS / Linux should behave the same but are untested.

## Development

```powershell
pnpm install
pnpm build
pnpm typecheck

# Structural validation (no install needed, just js-yaml)
node scripts/validate.cjs
```

Publish to the company registry:

```powershell
pnpm -r publish --access restricted
```

Try a local build:

```powershell
npm pack --workspace @plaud/dsh-plugin-notion
dsh plugin --profile test add .\plaud-dsh-plugin-notion-0.1.0.tgz
```

The installer takes exactly three spec forms — never a full command line:

| Form | Example |
| --- | --- |
| Package name | `@plaud/dsh-plugin-notion` |
| Git repository | `github:Plaud-AI/Plaud_DSH_plugins` |
| Absolute path | `D:\...\Plaud_DSH_plugins\packages\notion` or `D:\...\plaud-dsh-plugin-notion-0.1.0.tgz` |

The `desktop` profile belongs to the desktop app; `dsh plugin --profile desktop ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. Install through the Plugins panel there.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| No tools appear | The `mcp-oauth(<server>)` startup failed line in the host log |
| Browser never opens | The authorization URL in the log; open it manually |
| Still 401 after authorizing | Whether `~/.dsh/mcp-oauth/<server>.json` exists, and whether the issuer changed |
| Slack rejects the grant | The `app_id` parameter and client secret |
| Feishu fails to start | Whether `npx @larksuiteoapi/lark-mcp` runs on its own |

## Roadmap

1. Upstream it: a PR adding `authProvider` injection to `@deepseek-ai/dsh-mcp-client`.
2. Settings page with sign-out and re-authorize.
3. Bridge resources and instructions.
4. Exponential-backoff reconnect.
5. Verify Slack and pin the parameters.
