**简体中文** · [English](README.en.md)

# PLAUD DSH Connectors

**把 Notion、Linear、Slack、飞书和 PLAUD 接进 DeepSeek Harness。**

装一次，浏览器授权一次，助手就能直接查页面、改任务、发消息。

## 包含哪些连接器

| 插件 | 服务 | 认证 | 需要预注册 | 安装地址 |
| --- | --- | --- | --- | --- |
| `@plaudai/dsh-plugin-notion` | Notion | OAuth（DCR + PKCE） | 否 | [0.1.4](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-notion-0.1.4.tgz) |
| `@plaudai/dsh-plugin-linear` | Linear | OAuth 或 API key | 否 | [0.1.4](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-linear-0.1.4.tgz) |
| `@plaudai/dsh-plugin-slack` | Slack | OAuth | 是 | [0.1.4](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-slack-0.1.4.tgz) |
| `@plaudai/dsh-plugin-feishu` | 飞书 / Lark | App ID + Secret | 是 | [0.1.4](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-feishu-0.1.4.tgz) |
| `@plaudai/dsh-plugin-plaud` | PLAUD 内部服务 | Bearer token | 否 | [0.1.4](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-plaud-0.1.4.tgz) |

最后一列是直接可装的 `.tgz` 地址，点开复制即可；完整地址也列在[安装](#安装)一节。五个连接器共用一个核心包 `@plaudai/dsh-mcp-oauth`，补的是 DSH 自己没做的那一层：**MCP 授权**。

## 功能

- 连官方 Remote MCP，不封装、不代理、不改协议。
- 浏览器授权一次，令牌自动刷新。
- 工具名沿用 `mcp__<服务>__<工具>`，已有权限规则不用改。
- 令牌只存本机，按授权服务器分区，权限 `0600`。
- 配置里的密钥全部走环境变量，配置文件可以安全分享。

## 安装

打开 DSH 桌面版「插件」，把下表里那一整条地址粘进去，不需要登录、不需要配置源：

| 插件 | 安装地址 |
| --- | --- |
| Notion | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-notion-0.1.4.tgz` |
| Linear | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-linear-0.1.4.tgz` |
| Slack（官方 MCP） | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-slack-0.1.4.tgz` |
| Slack（Bot 版） | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.2.1-slackbot/plaudai-dsh-plugin-slackbot-0.2.1.tgz` |
| PLAUD | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-plaud-0.1.4.tgz` |
| PLAUD（官方 MCP） | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.0-plaud-mcp/plaudai-dsh-plugin-plaud-mcp-0.1.0.tgz` |
| 飞书（官方 MCP） | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-feishu-0.1.4.tgz` |
| 飞书（只读版） | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.0-feishu-read/plaudai-dsh-plugin-feishu-read-0.1.0.tgz` |

三组"双胞胎"插件按需选一个：

- **Slack**：官方 MCP 版走 `mcp.slack.com`（19 个工具、用户 OAuth、要预注册 App）；Bot 版直连 Web API + Socket Mode（5+3 个工具、免回调、一个 `xoxb-` 即可）
- **飞书**：官方 MCP 版走 `lark-mcp`（全量工具、能写）；只读版直连 OpenAPI（8 个只读工具、零依赖、写不了）
- **PLAUD**：内部版是 HTTP MCP + Bearer token（公司部署）；官方版是 stdio MCP（`npx -y @plaud-ai/mcp@latest`），用你自己的 PLAUD 账号登录后读录音、转写、摘要

地址指向 GitHub Release 上的 `.tgz`，版本由文件名决定，不受本地锁文件影响。要换版本就改地址里的 tag，可用的 tag 见 [Releases](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases)。

这些包同时也发在公共 npm 的 `@plaudai` scope 下，也可以直接填包名：

| 插件 | 包名 |
| --- | --- |
| Notion | `@plaudai/dsh-plugin-notion` |
| Linear | `@plaudai/dsh-plugin-linear` |
| Slack（官方 MCP） | `@plaudai/dsh-plugin-slack` |
| Slack（Bot 版） | `@plaudai/dsh-plugin-slackbot` |
| PLAUD | `@plaudai/dsh-plugin-plaud` |
| PLAUD（官方 MCP） | `@plaudai/dsh-plugin-plaud-mcp` |
| 飞书（官方 MCP） | `@plaudai/dsh-plugin-feishu` |
| 飞书（只读版） | `@plaudai/dsh-plugin-feishu-read` |

> 用包名时，如果 profile 的 `package.json` 里已经是旧范围（例如 `^0.1.1`），pnpm 会沿用锁文件里的旧版本而不升级，装完仍是老代码。要升级请**先卸载再装**，或者直接用上面的 `.tgz` 地址。

网页版和 headless 用命令行，两种写法都行：

```powershell
dsh plugin --profile web add @plaudai/dsh-plugin-notion
dsh plugin --profile web add https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.4/plaudai-dsh-plugin-notion-0.1.4.tgz
```

装完重启 DSH。宿主要求：`@deepseek-ai/dsh` 0.2.0-rc.2 及以上。

`desktop` 这个 profile 由桌面应用独占，命令行不能操作它，桌面版只能走面板。

想装本地改动就克隆仓库、`pnpm install && pnpm -r build`，然后在面板里填包的绝对目录路径——每个连接器构建时已把核心包内联进来，**装一个就够**。要换 registry 分发见[私有 registry](docs/REGISTRY.zh.md)。

## 开始使用

1. 只装你需要的那个连接器，不必全装。
2. Notion、Linear 装好即用——第一次调用工具时弹浏览器授权，用的是你自己的账号。
3. Slack、飞书、PLAUD 要先准备凭据，见[详细说明](docs/REFERENCE.zh.md#各服务配置)。
4. 授权完成后，在会话里直接说需求。

可以这样说：

> 帮我查一下 Notion 里「Q3 路线图」的当前状态，把结论整理成三条。

> 把 Linear 里分配给我的 P1 任务列出来，按截止时间排序。

## 开始前要知道

- 需要自己的企业账号；能看到什么，取决于你自己的权限。
- 不要多人共用一个 token，否则审计日志查不出是谁。
- 只桥接工具，不接管资源、提示词和服务器指令。
- 当前没有设置页，登出要手动删 `~/.dsh/mcp-oauth/` 下的文件。
- 断线不会自动重连，v0.1 需要重启宿主。

## 安装后发生什么

```
connect → 401 → 发现元数据 → 注册客户端 → 浏览器授权
        → 回调 127.0.0.1 → 存令牌 → 重连 → 工具可用
```

## 文档

- [各服务配置、安全模型、已知限制](docs/REFERENCE.zh.md)
- [私有 registry：部署、发布、升级](docs/REGISTRY.zh.md)
- [开发与构建](docs/REFERENCE.zh.md#开发)

## 反馈与贡献

内部插件。问题提 Issue，代码走 PR；反馈时附版本、复现步骤，并移除凭据。

## License

UNLICENSED，公司内部使用。第三方商标归各自所有者。
