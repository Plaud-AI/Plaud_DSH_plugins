[简体中文](REGISTRY.zh.md) · [English](REGISTRY.en.md)

# 私有 registry

搭一次，之后所有人只做一件事：在插件面板里填包名。

```
@plaud/dsh-plugin-notion
@plaud/dsh-plugin-linear
@plaud/dsh-plugin-slack
@plaud/dsh-plugin-plaud
@plaud/dsh-plugin-feishu
```

## 为什么不是 GitHub Packages

GitHub Packages 的 npm registry 要求**包 scope 等于仓库 owner**。仓库属于 `Plaud-AI`，那 scope 就得是 `@plaud-ai/*`，而我们全部是 `@plaud/*`——要发上去就得把所有包和补丁改一遍名。Verdaccio 没这个限制，也不占用 GitHub 的权限。

## 部署（一次，管理员做）

**没有 Docker 也能跑**，它就是个 Node 服务：

```powershell
cd "D:\OfficeTools\deepseek\Deepseek Harness Desktop\Plaud_DSH_plugins"
npx -y verdaccio@6 --config deploy/verdaccio/local.yaml --listen 0.0.0.0:4873
```

有 Docker 的话（推荐，能开机自启）：

```bash
docker compose -f deploy/docker-compose.yml up -d
curl http://localhost:4873/-/ping        # 期望 {"status":"ok"} 之类
```

配置有两份，内容一致，只有路径不同：

| 文件 | 用途 |
| --- | --- |
| [`deploy/verdaccio/config.yaml`](../deploy/verdaccio/config.yaml) | 容器里用，存储走命名卷 |
| [`deploy/verdaccio/local.yaml`](../deploy/verdaccio/local.yaml) | 直接跑用，存储落在仓库根的 `.verdaccio-storage/`（已 gitignore） |

两者都配成：

- `@plaud/*`：**`access: $all`**——装不需要登录，`publish: $authenticated`——只有登录用户能发。这样同事装插件零配置，发版权限还收得住；
- 其余包：代理到 npmjs，这样 profile 装插件时还能解析到 MCP SDK 和 schemastery；
- `max_users: 5`（容器版）/ `10`（本机版）——**上线后请改掉或直接关掉自助注册**，否则任何能访问该端口的人都能注册并发布一个全公司会安装的包。

创建第一个账号（htpasswd 自带注册接口，注册即登录）：

```bash
npm adduser --registry http://registry.internal:4873
```

如果部署在 `https://` 反代后面（推荐，否则发布时的 token 明文过网），把地址换成域名即可。

## 发布（每次发版）

```powershell
cd "D:\OfficeTools\deepseek\Deepseek Harness Desktop\Plaud_DSH_plugins"

$env:NPM_REGISTRY = "http://registry.internal:4873"
npm login --registry $env:NPM_REGISTRY      # 每台机器一次

pnpm version:patch                          # 版本号 +1，不发 git tag
pnpm -r build                               # core 先编译，再内联进每个包
pnpm release                                # 校验产物后逐个 publish
```

不确定会发什么时，先跑 `pnpm release --dry-run`。

`pnpm release` 会先检查每个包有没有 `dist/index.js`（忘了 build 会直接报错），再调 `pnpm -r publish`。401 是没登录，`cannot publish over` 是同版本已存在。

## 每个人怎么装（一行配置，之后填包名）

装不需要登录，只要告诉 pnpm 去哪找 `@plaud` 这个 scope：

```powershell
"@plaud:registry=http://registry.internal:4873/" | Add-Content $env:USERPROFILE\.npmrc
```

然后打开 DSH 的「插件」面板，粘贴包名 `@plaud/dsh-plugin-notion` 即可。命令行等价于：

```powershell
dsh plugin --profile web add @plaud/dsh-plugin-notion
```

> 如果 registry 用的是自签证书，还要在同一个 `~/.npmrc` 里加
> `//registry.internal:4873/:strict-ssl=false`（仅限内网，公网别这么干）。

**只有发布才需要 `npm login`**。装插件永远不需要 token。

## 升级

包发出去之后，同事那边**不是重启就自动更新**——profile 的 `pnpm-lock.yaml` 会钉住安装时的版本。要么在面板里重新安装一次，要么：

```powershell
dsh plugin --profile web add @plaud/dsh-plugin-notion@latest
```

发版流程：`pnpm version:patch` → `pnpm -r build` → `pnpm release`，然后通知大家更新。

## 换用别的 registry

`pnpm release` 只认环境变量 `NPM_REGISTRY`，换成任何兼容 npm 协议的 registry 都行：

| registry | 能不能用 | 说明 |
| --- | --- | --- |
| Verdaccio（本文） | ✅ | 保留 `@plaud` scope，不动 GitHub 权限 |
| GitHub Packages | ⚠️ 要改名 | scope 必须是 `@plaud-ai/*`；每人还要带 `read:packages` 的 token |
| 公共 npm | ❌ | 任何人都能看，与「仅公司内」冲突 |
| Nexus / Artifactory | ✅ | 公司已有的话直接指过去 |

## 排错

| 现象 | 原因 |
| --- | --- |
| `401 Unauthorized`（发布时） | `~/.npmrc` 里没有该 registry 的 `_authToken`，先 `npm login` |
| `404 Not Found` 装的时候 | token 有效但该 scope 的 access 规则没覆盖到；检查 config 里的 `'@plaud/*'` |
| `cannot publish over the previously published versions` | 版本号没改，先 `pnpm version:patch` |
| `SELF_SIGNED_CERT_IN_CHAIN` | 自签证书，见上面的 `strict-ssl=false` |
| 面板里填包名报 `not found` | 确认包已发布：`npm view @plaud/dsh-plugin-notion --registry <url>` |
