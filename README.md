# Plaud_DSH_plugins

给 **DeepSeek Harness** 补上它缺的那一层：**MCP OAuth 客户端**。

DSH 自带的 `@deepseek-ai/dsh-mcp-client` 只做传输层（stdio / streamable-http）和静态 header 注入，没有 OAuth。而 Notion、Linear、Slack 的官方 Remote MCP 都默认走标准授权流程（401 → 发现元数据 → DCR → PKCE → 浏览器回调）。本仓库把这层做进插件，宿主进程里运行的仍然是 **MCP 官方 SDK 的 OAuth 实现**，没有自研协议。

| 包 | 服务 | 端点 | 认证 | 需要预注册 |
|---|---|---|---|---|
| `@plaud/dsh-plugin-notion` | Notion | `https://mcp.notion.com/mcp` | OAuth（DCR + PKCE） | 否 |
| `@plaud/dsh-plugin-linear` | Linear | `https://mcp.linear.app/mcp` | OAuth（DCR + PKCE）或 API key | 否 |
| `@plaud/dsh-plugin-slack` | Slack | `https://mcp.slack.com/mcp` | OAuth（confidential client） | **是** |
| `@plaud/dsh-plugin-plaud` | PLAUD 内部服务 | 由 `PLAUD_MCP_URL` 指定 | Bearer token | 否 |
| `@plaud/dsh-plugin-feishu` | 飞书 / Lark | `npx @larksuiteoapi/lark-mcp` | App ID + Secret | 是 |
| `@plaud/dsh-mcp-oauth` | —（共享核心） | — | — | — |

## 结构

```
packages/
  core/     @plaud/dsh-mcp-oauth    OAuth provider + 回调服务器 + 凭据存储 + 工具桥接
  notion/   @plaud/dsh-plugin-notion
  linear/   @plaud/dsh-plugin-linear
  slack/    @plaud/dsh-plugin-slack
  plaud/    @plaud/dsh-plugin-plaud
  feishu/   @plaud/dsh-plugin-feishu
```

每个服务包都是**独立的 Cordis 插件**（导出 `name` / `inject` / `Config` / `apply`），其 `cordis.patch.yml` 只引用自己的包名，因此不需要任何全局安装或路径技巧。核心包只被它们 `import`，不会单独出现在 profile 的补丁里。

## 构建与发布

```powershell
pnpm install
pnpm build          # 每个包 tsc 到 lib/

# 发布到公司私有 registry（先配好 .npmrc）
pnpm -r publish --access restricted
```

> 依赖用了 pnpm 的 `workspace:^` 协议，`pnpm publish` 会把它改写成真实版本号。**不要用 `npm publish`**。

## 安装（每位同事）

```powershell
dsh plugin --profile web add @plaud/dsh-plugin-notion
dsh plugin --profile web add @plaud/dsh-plugin-linear
dsh plugin --profile web add @plaud/dsh-plugin-slack
dsh plugin --profile web add @plaud/dsh-plugin-plaud
dsh plugin --profile web add @plaud/dsh-plugin-feishu
```

装完重启 DSH。每个连接器会在 profile 里插入一条 `mcp-*` 条目，工具名沿用宿主约定 `mcp__<serverName>__<tool>`，所以已有的权限规则和会话记录不用改。

## 各服务前置条件

### Notion（零配置）

首次调用任何 Notion 工具时：连接返回 401 → SDK 自动注册客户端 → 浏览器弹出 Notion 授权页 → 回调 `127.0.0.1` → token 落地。授权身份是**当前用户自己的 Notion 账号**，权限天然逐人隔离。

要求：workspace 里 MCP 没被管理员禁掉；账号是 member（guest 不行）。

### Linear（零配置，或 API key）

同上走 DCR。想用静态 key 就在 profile 补丁里改成：

```yaml
config:
  serverName: linear
  auth: bearer
  bearerTokenEnv: LINEAR_API_KEY
```

### Slack（必须先建 App）

Slack 不支持 DCR，必须预注册一个 confidential client：

1. 在 `api.slack.com/apps` 建 app，启用 MCP；
2. 把 client id / secret / app id 写进宿主环境：

```powershell
$env:SLACK_MCP_CLIENT_ID = "..."
$env:SLACK_MCP_CLIENT_SECRET = "..."
$env:SLACK_MCP_APP_ID = "..."
```

3. `cordis.patch.yml` 已通过 `!!js` 从环境读取，并在授权 URL 上附加 `app_id`。

> `app_id` 这个附加参数是本仓库对 SDK 的唯一“外挂”，需要实测确认 Slack 的授权端点接受它；如果被拒，说明 Slack 要求把它放在客户端注册信息里，需要再调。

### PLAUD 内部服务

```powershell
$env:PLAUD_MCP_URL = "https://mcp.example.internal/mcp"
$env:PLAUD_MCP_TOKEN = "..."
```

### 飞书 / Lark

1. 在开放平台建自建应用，开通需要的权限；
2. 设置环境变量：

```powershell
$env:FEISHU_APP_ID = "cli_xxx"
$env:FEISHU_APP_SECRET = "xxx"
```

凭据通过**命令行参数**传给 `@larksuiteoapi/lark-mcp`，因为宿主（以及本桥）会从子进程环境里剔掉名字匹配 `KEY|PASSWORD|SECRET|TOKEN` 的变量。代价是密钥会出现在进程参数里（本机 `ps` 可见），这是飞书官方 MCP 只接受 CLI 参数导致的。

## 授权时到底发生了什么

```
connect(url, authProvider)
  └─ 401 ──> SDK 读 WWW-Authenticate / .well-known/oauth-protected-resource
             └─> 授权服务器元数据（RFC 8414）
                 └─> DCR 注册（RFC 7591）或使用预注册 clientId
                     └─> PKCE + state → 打开浏览器
                         └─> 回调 127.0.0.1:<随机端口>/callback
                             └─> 校验 state → 换 token → 存盘
                                 └─> 重新连接，带 Authorization: Bearer
```

令牌过期时 SDK 自动用 refresh token 换新；刷新失败会重新走一次浏览器流程（`authTimeoutMs` 默认 5 分钟）。

## 凭据存放

```
$DSH_HOME/mcp-oauth/<serverName>.json   # 默认 C:\Users\<你>\.dsh\mcp-oauth\
```

- 按**授权服务器 issuer** 分区，防止 token 被重放到别的 issuer（RFC 9207 混用防护）；
- 写入用临时文件 + rename，权限 `0600`（Windows 上 chmod 语义有限，但文件不在共享盘）；
- **登出**：删掉对应文件即可；同时建议在服务端撤销授权（Notion：Settings → Notion MCP → 断开；Slack：撤销 app 授权）。

## 安全模型

| 项 | 做法 |
|---|---|
| 令牌落盘 | 仅本机 `$DSH_HOME/mcp-oauth/`，0600，不进 patch、不进 git |
| 配置里的密钥 | 全部通过 `!!js process.env.X` 读取，配置文件本身可安全分享 |
| 子进程环境 | 剔除 `KEY/PASSWORD/SECRET/TOKEN` 和 `DSH_*`，与宿主行为一致 |
| 代码可信度 | 只有本仓库代码进宿主进程；MCP 服务端只是对端 |
| 权限范围 | 取决于服务端工具集 + 用户自己的账号权限；**不要**共用单一 token 给多人 |
| 审计 | Notion/Slack/Linear 各自有审计日志；本地可用 `mcp__*` 工具名过滤会话 |

## 已知限制（v0.1）

- **没有设置页**：授权靠浏览器弹窗 + 日志，登出靠删文件；
- **只桥接 tools**：未实现 resources / prompts / server instructions；
- **没有自动重连**：DSH 内置桥有指数退避重连，本插件 v0.1 需要重启宿主；
- **Slack 未实测**：`authorizationParams.app_id` 这条路需要真实 app 验证；
- **需要 pnpm**：`workspace:^` 协议 npm 不支持；
- **仅在 Windows 上验证过构建路径**，macOS/Linux 逻辑一致但未跑。

## Roadmap

1. 把这层能力**上游化**：给 `@deepseek-ai/dsh-mcp-client` 提 PR，加 `authProvider` 注入（改动很小，见 `packages/core/src/transport.ts` 的注释）；
2. 设置页 + `登出/重新授权` 按钮；
3. resources / instructions 桥接；
4. 指数退避重连；
5. Slack 实测后固化参数。

## 开发

```powershell
pnpm build
pnpm typecheck

# 结构校验（不需要装依赖，只需要 NODE_PATH 上有 js-yaml）
node scripts/validate.cjs
```
# 本地试装（不发布）
npm pack --workspace @plaud/dsh-plugin-notion
dsh plugin --profile test add .\plaud-dsh-plugin-notion-0.1.0.tgz
```

调试时把宿主日志级别调到 info，连接器会打印 `OAuth client ready (redirect http://127.0.0.1:xxxxx/callback)` 和授权 URL。

## 许可

内部使用，未授权（UNLICENSED）。第三方商标归各自所有者。
