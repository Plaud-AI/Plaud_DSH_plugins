# @plaudai/dsh-plugin-slack（Slack Bot 版）

给 DeepSeek Harness 用的 Slack 工具，**不走 MCP**：直接调 Slack Web API，用 Socket Mode 收消息，所以你不需要公网地址、不需要回调端口、不需要 OAuth 跳转。

和仓库里的 `@plaudai/dsh-plugin-slack`（官方 MCP 版）是两条独立的路，可以只装一个：

| | 本插件（bot 直连） | `@plaudai/dsh-plugin-slack`（官方 MCP） |
| --- | --- | --- |
| 身份 | 机器人（xoxb-）或用户（xoxp-）令牌 | 用户令牌（OAuth） |
| 能否收消息 | 能（Socket Mode） | 不能 |
| 要 OAuth / 回调 | 不用 | 要，且必须预注册 Slack App |
| 工具 | 5 个原生工具 | 官方 19 个 MCP 工具 |

## 工具

| 工具 | 作用 |
| --- | --- |
| `slackbot_notify` | 发消息到频道或线程，返回 `ts` |
| `slackbot_reply` | 在某条消息的线程里回复 |
| `slackbot_channels` | 列出机器人可见的频道 |
| `slackbot_history` | 读频道最近的消息（只读） |
| `slackbot_thread` | 读某条消息的线程（只读） |
| `slackbot_search` | 全文搜索（只读，需要 `xoxp-` + `search:read`） |
| `slackbot_inbox` | 取走 Socket Mode 收到的消息（消费即移除） |
| `slackbot_status` | 诊断：令牌是否有效、Socket 状态、队列积压 |

> 只想读、不想发：用一个**用户令牌**（`xoxp-`）+ `channels:history`、`channels:read`、`search:read` 就够，不需要 Socket Mode、不需要 `chat:write`、不需要 App-Level Token。发消息的工具会因为缺 `chat:write` 而失败，不影响读取。

## 安装

面板里粘地址（先卸载同名旧版）：

```
https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.2.2-slackbot/plaudai-dsh-plugin-slackbot-0.2.2.tgz
```

或命令行：

```powershell
dsh plugin --profile web add @plaudai/dsh-plugin-slackbot
```

## 配置

全部走环境变量（也可以在 profile 的 `cordis.patch.yml` 里按 id `slack-bot` 覆盖）：

| 变量 | 说明 |
| --- | --- |
| `DSH_SLACK_USER_TOKEN` | `xoxp-` 用户令牌。**只读优先用它**：能读你所在的所有频道，不用把机器人拉进群 |
| `DSH_SLACK_BOT_TOKEN` | `xoxb-` 机器人令牌。发消息用它；只能读机器人被拉进的频道 |
| `DSH_SLACK_APP_TOKEN` | `xapp-` App-Level Token。填了才会启动 Socket Mode 收消息 |
| `DSH_SLACK_DEFAULT_CHANNEL` | 不指定频道时的默认目标，如 `#general` |
| `DSH_SLACK_CHANNELS` | 频道白名单，逗号分隔，如 `#general,C0123456`。空=不限制 |

> 两个令牌至少要有一个；同时存在时**用户令牌优先**。

```powershell
setx DSH_SLACK_USER_TOKEN "xoxp-..."     # 只读
setx DSH_SLACK_BOT_TOKEN "xoxb-..."      # 发消息
setx DSH_SLACK_APP_TOKEN "xapp-..."      # 收消息
```

`setx` 之后要**完全退出并重开 DSH**。

## Slack App 怎么建

1. <https://api.slack.com/apps> → Create New App → From scratch
2. **OAuth & Permissions** → Bot Token Scopes：
   - 发消息：`chat:write`、`channels:read`
   - 收消息：再加 `channels:history`、`im:history`
3. 要收消息的话：**Socket Mode** 打开，并在 **Event Subscriptions** 订阅 `message.channels`（私聊加 `message.im`）
4. **Basic Information** → App-Level Tokens → 生成一个带 `connections:write` 的令牌 → `xapp-`
5. **Install to Workspace** → 复制 `xoxb-`
6. 把机器人邀请进要用的频道（`/invite @你的机器人`）

## 设计上的取舍

- **配置缺失不失败**：没令牌也能加载，调用工具时才报错，不会把整个插件树拖垮
- **白名单**：`DSH_SLACK_CHANNELS` 一填，`slackbot_notify` / `slackbot_reply` 只能往列表里的频道发，模型发不出去别的
- **收件箱有界**：最多留 200 条，满了丢最旧的；只收人来发的普通消息（忽略机器人、编辑、频道加入等）
- **不落盘**：本插件不写任何令牌到磁盘，也不含更新器、不注入前端代码
- **错误不泄密**：所有报错只描述错误码，不回显令牌

## 已知边界

- `slackbot_inbox` 的队列在内存里，重启 DSH 就清空
- 机器人看不到它没被邀请的频道
- 没配 `xapp-` 时只有单向能力（能发不能收）
