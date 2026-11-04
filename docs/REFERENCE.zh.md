[简体中文](REFERENCE.zh.md) · [English](REFERENCE.en.md)

# 详细说明

面向维护者和排错。安装和日常使用看 [README](../README.md)。

## 为什么需要它

DSH 自带的 `@deepseek-ai/dsh-mcp-client` 只做传输层（stdio / streamable-http）和静态 header 注入：

```js
new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } })
```

它没有 `authProvider`，所以面对 401 只能失败。而 Notion、Linear、Slack 的官方 Remote MCP 都默认走标准授权（401 → 发现 → 注册 → PKCE → 浏览器回调）。

有意思的是**底层 SDK 早就有这套实现**：`@modelcontextprotocol/client@2` 自带 `OAuthClientProvider`、DCR、PKCE、issuer 校验和 401 重试，`StreamableHTTPClientTransport` 也接受 `authProvider`。缺的只是有人把它接上。

本仓库就是那个「接上」。

## 结构

```
packages/
  core/     @plaud/dsh-mcp-oauth   OAuth provider + 回调服务器 + 凭据存储 + 工具桥接
  notion/   @plaud/dsh-plugin-notion
  linear/   @plaud/dsh-plugin-linear
  slack/    @plaud/dsh-plugin-slack
  plaud/    @plaud/dsh-plugin-plaud
  feishu/   @plaud/dsh-plugin-feishu
```

每个服务包都是独立的 Cordis 插件（导出 `name` / `inject` / `Config` / `apply`），`cordis.patch.yml` 只引用自己的包名。核心包只被它们 `import`，不会单独出现在 profile 补丁里——这样加载器不需要解析任何嵌套路径。

**核心包在构建时被内联进每个连接器**：`scripts/bundle.mjs` 把 `dist/index.js` 里唯一一句 `from '@plaud/dsh-mcp-oauth'` 改写成 `from './core/index.js'`，再把 core 的编译产物拷进 `dist/core/`。结果是每个连接器自包含：

- 装一个包就够，不必先发核心包、也没有发布顺序问题；
- 不需要私有 registry 也能装；
- 五个连接器各自的暴露面独立，版本可以不同步。

没用 rollup：它的 Windows 版依赖原生二进制，在不少环境里装不上，而这里整个依赖图只有一处跨包 import。

`core` 支持三种连接方式：

| `auth` | 用途 | 令牌来源 |
| --- | --- | --- |
| `oauth` | Notion / Linear / Slack | 浏览器授权，自动刷新 |
| `bearer` | PLAUD 等内部服务 | 环境变量 |
| `none` | 公开 MCP 服务 | 无 |

## 各服务配置

### Notion

零配置。第一次调用任何 Notion 工具时弹浏览器，用的就是你自己的 Notion 账号。

要求：

- workspace 里没有禁用 MCP（Settings → Notion MCP）；
- 账号是 member，guest 连不上；
- MCP token 只有 Business/Enterprise 的 workspace owner 能建——但这里走的是 OAuth，不受这条限制。

### Linear

零配置，走 DCR。想改用 API key：

```yaml
- id: mcp-linear
  name: '@plaud/dsh-plugin-linear'
  config:
    serverName: linear
    auth: bearer
    bearerTokenEnv: LINEAR_API_KEY
```

### Slack

Slack 不支持 DCR，必须先注册 app：

1. 在 `api.slack.com/apps` 建 app，启用 MCP；
2. 导出三个值再启动 DSH：

```powershell
$env:SLACK_MCP_CLIENT_ID = "..."
$env:SLACK_MCP_CLIENT_SECRET = "..."
$env:SLACK_MCP_APP_ID = "..."
```

3. 补丁已通过 `!!js` 读取环境变量，并把 `app_id` 附加到授权 URL。

> `authorizationParams.app_id` 是本仓库对 SDK 的唯一「外挂」，需要真实 app 实测。若被拒绝，说明 Slack 要求把它放进客户端注册信息，需要改 provider。

### PLAUD 内部服务

```powershell
$env:PLAUD_MCP_URL = "https://mcp.example.internal/mcp"
$env:PLAUD_MCP_TOKEN = "..."
```

服务端将来支持 DCR 时，把 `auth` 改成 `oauth`、去掉 token 即可。

### 飞书 / Lark

用官方 `@larksuiteoapi/lark-mcp`（stdio）：

```powershell
$env:FEISHU_APP_ID = "cli_xxx"
$env:FEISHU_APP_SECRET = "xxx"
```

凭据通过**命令行参数**传递，因为宿主会从 MCP 子进程环境里剔掉名字匹配 `KEY|PASSWORD|SECRET|TOKEN` 的变量，本桥保持一致。代价是密钥在进程参数里可见（本机 `ps`），这是飞书官方 MCP 只接受 CLI 参数导致的。

## 授权流程

```
connect(url, authProvider)
  └─ 401 ──> 读 WWW-Authenticate / .well-known/oauth-protected-resource
             └─> 授权服务器元数据（RFC 8414）
                 └─> DCR 注册（RFC 7591）或使用预注册 clientId
                     └─> PKCE + state → 打开浏览器
                         └─> 回调 127.0.0.1:<随机端口>/callback
                             └─> 校验 state → 换 token → 落盘
                                 └─> 重连，带 Authorization: Bearer
```

令牌过期时用 refresh token 换新；刷新失败会再走一次浏览器流程，默认 5 分钟超时（`authTimeoutMs`）。

## 凭据存放

```
$DSH_HOME/mcp-oauth/<serverName>.json    # 默认 C:\Users\<你>\.dsh\mcp-oauth\
```

- 按**授权服务器 issuer** 分区，防止令牌被重放到别的 issuer（RFC 9207）；
- 临时文件 + rename 写入，权限 `0600`（Windows 的 chmod 语义有限，但文件不在共享盘）；
- **登出**：删掉对应文件，同时去服务端撤销授权（Notion：Settings → Notion MCP → 断开；Slack：撤销 app 授权）。

## 安全模型

| 项 | 做法 |
| --- | --- |
| 令牌落盘 | 仅本机 `$DSH_HOME/mcp-oauth/`，`0600`，不进补丁、不进 git |
| 配置里的密钥 | 一律 `!!js process.env.X`，配置文件可安全分享 |
| 子进程环境 | 剔除 `KEY\|PASSWORD\|SECRET\|TOKEN` 和 `DSH_*`，与宿主一致 |
| 代码可信度 | 只有本仓库代码进宿主进程；MCP 服务端只是对端 |
| 权限范围 | 服务端工具集 + 用户自己的账号权限 |
| 审计 | Notion / Linear / Slack 各自的日志；本地按 `mcp__*` 工具名过滤会话 |

## 已知限制

- 没有设置页：授权靠浏览器弹窗，登出靠删文件。
- 只桥接 tools：resources、prompts、server instructions 未接。
- 没有自动重连：DSH 内置桥有指数退避，本插件 v0.1 需要重启。
- Slack 的 `app_id` 注入方式未实测。
- `dist/` 只有运行时代码，不带类型声明；类型只在仓库内开发时用（`lib/` 里的 `.d.ts`）。
- 只在 Windows 上走过构建路径，macOS / Linux 逻辑一致但未跑。
## 开发

```powershell
pnpm install
pnpm -r build        # core 先编译，再逐个内联进连接器
pnpm -r typecheck

# 结构校验（不装依赖，只要有 js-yaml）
node scripts/validate.cjs
```

`.npmrc` 里开了 `node-linker=hoisted`：隔离布局（符号链接 + 虚拟仓库）会让「依赖的依赖」在解析时依赖链接器行为，扁平布局没这个坑，和 npm 的产物一致。

发布到公司私有 registry：

```powershell
pnpm -r publish --access restricted
```

本地试装：

```powershell
npm pack --workspace @plaud/dsh-plugin-notion
dsh plugin --profile test add .\plaud-dsh-plugin-notion-0.1.0.tgz
```

安装入口只接受三种 spec，不要粘整条命令：

| 形式 | 例子 |
| --- | --- |
| 包名 | `@plaud/dsh-plugin-notion` |
| Git 仓库 | `github:Plaud-AI/Plaud_DSH_plugins` |
| 绝对路径 | `D:\...\Plaud_DSH_plugins\packages\notion` 或 `D:\...\plaud-dsh-plugin-notion-0.1.0.tgz` |

`desktop` profile 由桌面应用独占，`dsh plugin --profile desktop ...` 会被拒绝（`profile "desktop" is managed exclusively by the Electron application`）。桌面版只能在「插件」面板里装。

## 排错

| 现象 | 先看 |
| --- | --- |
| 工具没出现 | 宿主日志里 `mcp-oauth(<server>)` 的 startup failed 行 |
| 浏览器没弹 | 日志里的授权 URL，手动打开 |
| 授权后仍 401 | `~/.dsh/mcp-oauth/<server>.json` 是否存在、issuer 是否变了 |
| Slack 授权被拒 | `app_id` 参数、client secret 是否正确 |
| 飞书启动失败 | `npx @larksuiteoapi/lark-mcp` 能否独立跑起来 |

## Roadmap

1. 上游化：给 `@deepseek-ai/dsh-mcp-client` 提 PR，加 `authProvider` 注入。
2. 设置页 + 登出 / 重新授权按钮。
3. resources、instructions 桥接。
4. 指数退避重连。
5. Slack 实测后固化参数。
