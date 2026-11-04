**简体中文** · [English](README.en.md)

# PLAUD DSH Connectors

**把 Notion、Linear、Slack、飞书和 PLAUD 接进 DeepSeek Harness。**

装一次，浏览器授权一次，助手就能直接查页面、改任务、发消息。

## 包含哪些连接器

| 插件 | 服务 | 认证 | 需要预注册 |
| --- | --- | --- | --- |
| `@plaud/dsh-plugin-notion` | Notion | OAuth（DCR + PKCE） | 否 |
| `@plaud/dsh-plugin-linear` | Linear | OAuth 或 API key | 否 |
| `@plaud/dsh-plugin-slack` | Slack | OAuth | 是 |
| `@plaud/dsh-plugin-feishu` | 飞书 / Lark | App ID + Secret | 是 |
| `@plaud/dsh-plugin-plaud` | PLAUD 内部服务 | Bearer token | 否 |

五个连接器共用一个核心包 `@plaud/dsh-mcp-oauth`，补的是 DSH 自己没做的那一层：**MCP 授权**。

## 功能

- 连官方 Remote MCP，不封装、不代理、不改协议。
- 浏览器授权一次，令牌自动刷新。
- 工具名沿用 `mcp__<服务>__<工具>`，已有权限规则不用改。
- 令牌只存本机，按授权服务器分区，权限 `0600`。
- 配置里的密钥全部走环境变量，配置文件可以安全分享。

## 安装

在 DSH 桌面版「插件」面板逐个安装，或：

```powershell
dsh plugin --profile desktop add @plaud/dsh-plugin-notion
```

网页版把 `desktop` 改成 `web`。装完重启 DSH。宿主要求：`@deepseek-ai/dsh` 0.2.0-rc.2 及以上。

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
- [开发、构建与发布](docs/REFERENCE.zh.md#开发)

## 反馈与贡献

内部插件。问题提 Issue，代码走 PR；反馈时附版本、复现步骤，并移除凭据。

## License

UNLICENSED，公司内部使用。第三方商标归各自所有者。
