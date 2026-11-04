# @plaudai/dsh-plugin-feishu（只读版）

给 DeepSeek Harness 的飞书**只读**工具：直连飞书 OpenAPI，不走 MCP、不需要回调地址、不需要 OAuth 跳转。

只需要一个**企业自建应用**的 App ID / App Secret，权限只勾只读。

和仓库里的 `@plaudai/dsh-plugin-feishu`（官方 `lark-mcp` 版）的区别：

| | 本插件（只读直连） | `@plaudai/dsh-plugin-feishu`（官方 MCP） |
| --- | --- | --- |
| 依赖 | 无（内置 fetch） | `npx @larksuiteoapi/lark-mcp` |
| 权限面 | 8 个只读工具 | 官方全量工具 |
| 能写吗 | **不能**（没有任何写接口） | 能 |
| 配置 | 2 个环境变量 | 2 个环境变量 |

## 工具

| 工具 | 作用 |
| --- | --- |
| `feishu_status` | 诊断：凭据是否有效、token 剩余、能否读到会话 |
| `feishu_chats` | 列出应用所在的群（群名、chat_id、成员数） |
| `feishu_messages` | 读某个群最近的聊天消息（作者、时间、正文） |
| `feishu_doc` | 读云文档正文（粘 `/docx/` 或 `/wiki/` 链接即可） |
| `feishu_wiki` | 浏览知识空间与节点 |
| `feishu_bitable` | 多维表格：列数据表 / 读记录 |
| `feishu_sheet` | 电子表格：列工作表 / 读单元格范围 |
| `feishu_drive` | 列云空间目录里的文件 |

所有工具只读：`slack_notify` 那种写入能力在这个包里根本不存在，模型不可能误发。

## 安装

面板里粘地址：

```
https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.0-feishu-read/plaudai-dsh-plugin-feishu-read-0.1.0.tgz
```

或命令行：

```powershell
dsh plugin --profile web add @plaudai/dsh-plugin-feishu-read
```

## 配置

```powershell
setx FEISHU_APP_ID "cli_xxxxxxxx"
setx FEISHU_APP_SECRET "xxxxxxxx"
setx FEISHU_DOMAIN "open.feishu.cn"        # 国际版用 open.larksuite.com，可省略
setx FEISHU_ALLOWED_CHATS "oc_xxx,oc_yyy"  # 可选：会话白名单
```

`setx` 之后要**完全退出并重开 DSH**。

也可以在 profile 的 `cordis.patch.yml` 里按 id `feishu-read` 覆盖 `appId` / `appSecret` / `domain` / `allowedChats`。

## 建应用（只读，5 分钟）

1. <https://open.feishu.cn/app> → 创建企业自建应用
2. **权限管理** → 只勾这些只读权限（按需）：

   | 要读什么 | 权限点 |
   | --- | --- |
   | 群列表 | `im:chat:readonly` |
   | 群消息 | `im:message:readonly` |
   | 云文档 | `docx:document:readonly` |
   | 知识库 | `wiki:wiki:readonly` |
   | 多维表格 | `bitable:app:readonly` |
   | 电子表格 | `sheets:spreadsheet:readonly` |
   | 云空间目录 | `drive:drive:readonly` |
   | 作者姓名 | `contact:user.base:readonly`（可选） |

3. **版本管理与发布** → 创建版本 → 申请发布（企业内自建应用一般管理员点一下即可）
4. **凭证与基础信息** → 复制 App ID / App Secret
5. 把机器人拉进要读的群；文档/表格要**共享给这个应用**（或放在应用可访问的共享空间）

## 设计取舍

- **没有写接口**：不是靠权限挡，而是这个包没实现任何写 API
- **凭据缺失不失败**：插件照常加载，调用时提示去哪配
- **token 自动续期**：缓存 tenant_access_token，过期前 5 分钟刷新，失效自动重试一次
- **错误可操作**：10003/10014/99991672/131005 等都翻译成「下一步做什么」
- **不落盘**：token 只在内存里，不写任何文件
- **白名单**：`FEISHU_ALLOWED_CHATS` 一填，读消息只限这些群

## 已知边界

- 只读 `docx` 类型文档；老版 `doc`/表格里的多级内容会用对应工具读
- 读消息需要机器人**在群里**；文档需要**共享给应用**
- 国际版（Lark）要设 `FEISHU_DOMAIN=open.larksuite.com`
