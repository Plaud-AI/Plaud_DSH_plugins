[简体中文](README.md) · **English**

# PLAUD DSH Connectors

**Bring Notion, Linear, Slack, Feishu and PLAUD into DeepSeek Harness.**

Install once, authorize once in the browser, and your assistant can read pages, file issues and send messages.

## What's inside

| Package | Service | Auth | Pre-registration | Install |
| --- | --- | --- | --- | --- |
| `@plaudai/dsh-plugin-notion` | Notion | OAuth (DCR + PKCE) | No | [0.1.2](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-notion-0.1.2.tgz) |
| `@plaudai/dsh-plugin-linear` | Linear | OAuth or API key | No | [0.1.2](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-linear-0.1.2.tgz) |
| `@plaudai/dsh-plugin-slack` | Slack | OAuth | Yes | [0.1.2](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-slack-0.1.2.tgz) |
| `@plaudai/dsh-plugin-feishu` | Feishu / Lark | App ID + Secret | Yes | [0.1.2](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-feishu-0.1.2.tgz) |
| `@plaudai/dsh-plugin-plaud` | PLAUD internal | Bearer token | No | [0.1.2](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-plaud-0.1.2.tgz) |

The last column links straight to the installable `.tgz`; the full addresses are also spelled out under [Install](#install). All five share one core package, `@plaudai/dsh-mcp-oauth`, which fills in the layer DeepSeek Harness leaves out: **MCP authorization**.

## Features

- Talks to the official remote MCP servers — no wrapping, no proxy, no protocol changes.
- One browser authorization; tokens refresh on their own.
- Tool names keep the `mcp__<server>__<tool>` convention, so existing permission rules still apply.
- Tokens stay on the local machine, partitioned per authorization server, mode `0600`.
- Every secret comes from the environment, so config files are safe to share.

## Install

Open the desktop **Plugins** panel and paste one whole address from the table below — no login, no registry configuration:

| Plugin | Install URL |
| --- | --- |
| Notion | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-notion-0.1.2.tgz` |
| Linear | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-linear-0.1.2.tgz` |
| Slack | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-slack-0.1.2.tgz` |
| PLAUD | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-plaud-0.1.2.tgz` |
| Feishu | `https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-feishu-0.1.2.tgz` |

Each address points at a `.tgz` on GitHub Releases, so the version is whatever the file name says and the local lockfile cannot hold it back. Bump the `v0.1.2` segment to move to another tag listed under [Releases](https://github.com/Plaud-AI/Plaud_DSH_plugins/releases).

The same packages are on public npm under the `@plaudai` scope, so a package name works too:

| Plugin | Package |
| --- | --- |
| Notion | `@plaudai/dsh-plugin-notion` |
| Linear | `@plaudai/dsh-plugin-linear` |
| Slack | `@plaudai/dsh-plugin-slack` |
| PLAUD | `@plaudai/dsh-plugin-plaud` |
| Feishu | `@plaudai/dsh-plugin-feishu` |

> With a package name, a profile whose `package.json` still carries an older range (say `^0.1.1`) keeps the locked version and silently installs the old code. Uninstall first before reinstalling, or use the `.tgz` addresses above.

For the web build and headless profiles both forms work:

```powershell
dsh plugin --profile web add @plaudai/dsh-plugin-notion
dsh plugin --profile web add https://github.com/Plaud-AI/Plaud_DSH_plugins/releases/download/v0.1.2/plaudai-dsh-plugin-notion-0.1.2.tgz
```

Then restart DSH. Requires `@deepseek-ai/dsh` 0.2.0-rc.2 or newer.

The `desktop` profile belongs to the app and the CLI refuses to touch it, so desktop installs go through the panel.

To test a local change, clone the repo, run `pnpm install && pnpm -r build`, then paste the absolute package directory — each connector inlines the core at build time, so **one package is enough**. For registry-based distribution see the [private registry](docs/REGISTRY.en.md).

## Getting started

1. Install only the connectors you need.
2. Notion and Linear work out of the box — the first tool call opens a browser and authorizes with your own account.
3. Slack, Feishu and PLAUD need credentials first; see [reference](docs/REFERENCE.en.md#per-service-setup).
4. Once authorized, just ask in the session.

Try saying:

> Check the current status of "Q3 roadmap" in Notion and summarize it in three lines.

> List the P1 Linear issues assigned to me, sorted by due date.

## Before you start

- You need your own company account; what you can see is what your account can see.
- Never share one token across people — audit logs will not tell you who did what.
- Tools only: resources, prompts and server instructions are not bridged yet.
- No settings page yet; sign out by deleting the files under `~/.dsh/mcp-oauth/`.
- No automatic reconnect in v0.1 — restart the host.

## What happens after install

```
connect → 401 → discover metadata → register client → browser authorization
        → callback on 127.0.0.1 → store tokens → reconnect → tools live
```

## Docs

- [Per-service setup, security model, known limits](docs/REFERENCE.en.md)
- [Private registry: deploy, publish, upgrade](docs/REGISTRY.en.md)
- [Development and build](docs/REFERENCE.en.md#development)

## Contributing

Internal plugin. Open an issue for problems, a PR for changes; include version and steps to reproduce, and strip credentials.

## License

UNLICENSED, internal use only. Third-party trademarks belong to their owners.
