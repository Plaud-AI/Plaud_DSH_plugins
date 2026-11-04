[简体中文](README.md) · **English**

# PLAUD DSH Connectors

**Bring Notion, Linear, Slack, Feishu and PLAUD into DeepSeek Harness.**

Install once, authorize once in the browser, and your assistant can read pages, file issues and send messages.

## What's inside

| Package | Service | Auth | Pre-registration |
| --- | --- | --- | --- |
| `@plaud/dsh-plugin-notion` | Notion | OAuth (DCR + PKCE) | No |
| `@plaud/dsh-plugin-linear` | Linear | OAuth or API key | No |
| `@plaud/dsh-plugin-slack` | Slack | OAuth | Yes |
| `@plaud/dsh-plugin-feishu` | Feishu / Lark | App ID + Secret | Yes |
| `@plaud/dsh-plugin-plaud` | PLAUD internal | Bearer token | No |

All five share one core package, `@plaud/dsh-mcp-oauth`, which fills in the layer DeepSeek Harness leaves out: **MCP authorization**.

## Features

- Talks to the official remote MCP servers — no wrapping, no proxy, no protocol changes.
- One browser authorization; tokens refresh on their own.
- Tool names keep the `mcp__<server>__<tool>` convention, so existing permission rules still apply.
- Tokens stay on the local machine, partitioned per authorization server, mode `0600`.
- Every secret comes from the environment, so config files are safe to share.

## Install

Install each connector from the DSH desktop **Plugins** panel, or:

```powershell
dsh plugin --profile desktop add @plaud/dsh-plugin-notion
```

Use `web` instead of `desktop` for the web build, then restart DSH. Requires `@deepseek-ai/dsh` 0.2.0-rc.2 or newer.

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
- [Development, build and publish](docs/REFERENCE.en.md#development)

## Contributing

Internal plugin. Open an issue for problems, a PR for changes; include version and steps to reproduce, and strip credentials.

## License

UNLICENSED, internal use only. Third-party trademarks belong to their owners.
