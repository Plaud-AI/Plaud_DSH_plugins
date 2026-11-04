# @plaudai/dsh-plugin-plaud-official（PLAUD 官方 MCP）

把 PLAUD 的官方 MCP 服务器接进 DSH：查录音、看转写、读 AI 摘要、搜关键词。

和仓库里的 `@plaudai/dsh-plugin-plaud` 的区别：

| | 本插件（官方 MCP） | `@plaudai/dsh-plugin-plaud` |
| --- | --- | --- |
| 连接 | stdio，`npx -y @plaud-ai/mcp@latest` | 内部 HTTP MCP 端点 |
| 认证 | PLAUD 账号登录（浏览器点一下） | Bearer token（`PLAUD_MCP_TOKEN`） |
| 配置 | 零配置 | 要填 URL + token |
| 适用 | 你自己的账号、个人录音 | 公司内部部署 |

## 先登录一次（重要）

这个 MCP 的认证发生在它自己内部，不经过 DSH，所以**先在外面登录**：

```powershell
npx -y @plaud-ai/mcp@latest install
```

浏览器会打开，点 **Authorize**，凭据由它自己保存。之后 DSH 里的子进程直接用。

也可以装官方 CLI 登录：

```powershell
npm install -g @plaud-ai/cli
plaud login
plaud me        # 确认已登录
```

## 安装插件

```
https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.0-plaud-mcp/plaudai-dsh-plugin-plaud-mcp-0.1.0.tgz
```

或命令行：

```powershell
dsh plugin --profile web add @plaudai/dsh-plugin-plaud-mcp
```

装完重启 DSH。

## 工具

装好后会有一组 `mcp__plaud__*` 工具，大致是：

| 工具 | 作用 |
| --- | --- |
| `list_files` | 列录音（分页、可按时间/关键词过滤） |
| `get_file` | 读单个录音的详情、转写、摘要 |
| 其他 | 以实际 `listTools` 返回为准，装完让它自己列一遍 |

## 排除问题

| 现象 | 原因 |
| --- | --- |
| 工具没出现 | 没登录过 → 先跑上面那条 `install` 或 `plaud login` |
| 报 `npx` 找不到 | Node.js < 20 或 PATH 里没有 npx |
| 首次调用很慢 | `npx` 在下载 `@plaud-ai/mcp`，第二次就快了 |

## 说明

- 这个包只是「MCP stdio 桥」：真正干活的是 PLAUD 官方的 `@plaud-ai/mcp`
- 不往磁盘写任何凭据；登录态由官方包自己管理
- 官方包更新会自动生效（`@latest`），想锁版本就把 patch 里的 `@latest` 改成具体版本号
