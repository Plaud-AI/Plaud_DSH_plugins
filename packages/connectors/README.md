# @plaudai/dsh-plugin-connectors

一个插件接入全部数据源，不用为每个服务单独装包。

| 服务 | 默认 | 说明 |
|---|---|---|
| `notion` | 开 | Notion 官方远程 MCP，75 个工具（搜索、读页面、建页面、传文件…） |
| `slackIndex` | 开 | 不用 Slack 令牌检索 Slack 频道历史（复用 Notion 的 Slack 连接器） |
| `plaud` | 关 | PLAUD 官方 stdio MCP，需先登录一次 |
| `custom` | 空 | 任意额外 MCP：Google Drive / Docs 等 |

## 安装

```
https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.0-connectors/plaudai-dsh-plugin-connectors-0.1.0.tgz
```

装之前请先**卸载或关掉** `@plaudai/dsh-plugin-notion`、`@plaudai/dsh-plugin-plaud-mcp`，
否则同名工具会冲突（宿主的工具注册表是全局的）。

## Notion

零配置。第一次调用任意 Notion 工具时弹浏览器授权，令牌存在
`~/.dsh/mcp-oauth/notion.json`。装过旧 Notion 插件的机器直接复用，不会二次弹窗。

## Slack 索引

工具：`slack_index_search`

```json
{ "question": "firmware-release 最近发布了哪些版本",
  "keywords": "firmware-release 发布 V1.2.0",
  "lookback": "14d" }
```

前提：Notion 工作区已由管理员开启 **Slack 连接器**，且当前账号有权限。
返回的是索引命中的片段（带 `slack://` 深链和 `channel_id`），不是逐条完整历史。
要精确全量历史，用 Slack 官方 MCP（`@plaudai/dsh-plugin-slack`）。

## PLAUD

打开开关前先登录一次：

```powershell
npx -y @plaud-ai/mcp@latest install
```

然后在插件配置里把 `plaud: true`。

## 自定义服务（Google Drive / Docs 等）

Google 目前没有官方 MCP，社区实现都能通过 `custom` 接进来，不用改插件：

```yaml
custom:
  - serverName: gdrive
    transport: stdio
    command: npx
    args: ['-y', '某个-google-drive-mcp']
```

远程 + Bearer 的形式：

```yaml
custom:
  - serverName: gdocs
    transport: streamable-http
    url: https://example.com/mcp
    auth: bearer
    bearerTokenEnv: GDRIVE_MCP_TOKEN
```

工具名会自动带 `mcp__<serverName>__` 前缀，所以多个服务互不冲突。

## 配置全貌

```yaml
notion: true
slackIndex: true
plaud: false
custom: []
```
