[简体中文](REGISTRY.zh.md) · English

# Private registry

> The current distribution channel is tarballs on a GitHub Release — clients paste a URL, see the [README](../README.en.md#install). This document covers the optional registry route.

> Want zero client configuration? See [publish to public npm](#publish-to-public-npm-zero-client-config) — clients configure nothing at all.

Set it up once; after that everyone does exactly one thing — paste a package name into the plugin panel.

```
@plaudai/dsh-plugin-notion
@plaudai/dsh-plugin-linear
@plaudai/dsh-plugin-slack
@plaudai/dsh-plugin-plaud
@plaudai/dsh-plugin-feishu
```

## Why not GitHub Packages

GitHub Packages' npm registry requires the **package scope to equal the repository owner**. The repo lives under `Plaud-AI`, so the scope would have to be `@plaud-ai/*`, while everything here is `@plaudai/*` — publishing there means renaming every package and patch. Verdaccio has no such rule and needs no GitHub permissions.

## Publish to public npm (zero client config)

If publishing the code is fine, this is the least friction: **clients need no `.npmrc`, no token, no login** — paste the name into the panel and it installs.

Prerequisite: an npm account that owns the `@plaud` scope (create the org at [npmjs.com/org/create](https://www.npmjs.com/org/create), free). I checked: `scope:plaud` currently has **0 packages** on public npm, so the scope is clean.

```powershell
npm login                                   # your own npm account
pnpm -r build
pnpm release --public                       # --access public
```

After that, clients configure nothing:

```
@plaudai/dsh-plugin-notion
```

Worth knowing:

- **The code becomes public.** No secrets in here, only OAuth plumbing and five service presets, but accept that anyone can read it;
- the unscoped `dsh-mcp-oauth` is already taken (0.3.0), so the core package must stay under `@plaud` too — do not switch to an unscoped name;
- publishing to npm is not the same as being in the plugin market. `dshmarket` only installs from the [awesome-dsh-plugin](https://awesome-dsh-plugin.com) curated list; listing there means a PR to that repo;
- to roll back: `npm unpublish @plaudai/dsh-plugin-notion@0.1.0`; the version number is not reusable for 72 hours.

## Deploy a private registry (when the code must stay internal)

**Docker is optional** — Verdaccio is just a Node service:

```powershell
cd "D:\OfficeTools\deepseek\Deepseek Harness Desktop\Plaud_DSH_plugins"
npx -y verdaccio@6 --config deploy/verdaccio/local.yaml --listen 0.0.0.0:4873
```

With Docker (recommended: it can restart on boot):

```bash
docker compose -f deploy/docker-compose.yml up -d
curl http://localhost:4873/-/ping        # expect {"status":"ok"} and friends
```

Two configs, same contents, different paths:

| file | used by |
| --- | --- |
| [`deploy/verdaccio/config.yaml`](../deploy/verdaccio/config.yaml) | the container; storage is a named volume |
| [`deploy/verdaccio/local.yaml`](../deploy/verdaccio/local.yaml) | running it directly; storage lands in `.verdaccio-storage/` at the repo root (gitignored) |

Both are configured so that:

- `@plaudai/*`: **`access: $all`** — installing needs no login, while `publish: $authenticated` — only authenticated users can publish. Teammates configure nothing to install, and publishing stays locked down;
- everything else is proxied to npmjs, so a profile install can still resolve the MCP SDK and schemastery;
- `max_users: 5` (container) / `10` (local) — **change this or disable self-registration after rollout**; otherwise anyone who can reach the port can register and publish a package the whole company will install.

Create the first account (htpasswd exposes registration, and registering logs you in):

```bash
npm adduser --registry http://registry.internal:4873
```

Put it behind an `https://` reverse proxy — otherwise the publishing token travels in clear text.

## Publish (per release)

```powershell
cd "D:\OfficeTools\deepseek\Deepseek Harness Desktop\Plaud_DSH_plugins"

$env:NPM_REGISTRY = "http://registry.internal:4873"
npm login --registry $env:NPM_REGISTRY      # once per machine

pnpm version:patch                          # bump versions, no git tag
pnpm -r build                               # the core compiles first, then gets inlined
pnpm release                                # check the output, then publish each package
```

Run `pnpm release --dry-run` first if you want to see what would go out.

`pnpm release` refuses to start when a connector has no `dist/index.js` (you forgot to build), then calls `pnpm -r publish`. A 401 means you are not logged in; `cannot publish over` means the version already exists.

## How each person installs (one line, then paste names)

Installing needs no login — pnpm just has to know where the `@plaud` scope lives:

```powershell
"@plaud:registry=http://registry.internal:4873/" | Add-Content $env:USERPROFILE\.npmrc
```

Then open the DSH **Plugins** panel and paste `@plaudai/dsh-plugin-notion`. The CLI equivalent:

```powershell
dsh plugin --profile web add @plaudai/dsh-plugin-notion
```

> With a self-signed certificate, add
> `//registry.internal:4873/:strict-ssl=false` to the same `~/.npmrc` (internal networks only).

**Only publishing needs `npm login`.** Installing never needs a token.

## Upgrading

Publishing does **not** update anyone automatically — the profile's `pnpm-lock.yaml` pins the installed version. Either reinstall from the panel, or:

```powershell
dsh plugin --profile web add @plaudai/dsh-plugin-notion@latest
```

Release flow: `pnpm version:patch` → `pnpm -r build` → `pnpm release`, then tell everyone to update.

## Using a different registry

`pnpm release` only reads `NPM_REGISTRY`; any npm-compatible registry works:

| registry | works? | note |
| --- | --- | --- |
| Verdaccio (this doc) | ✅ | keeps the `@plaud` scope, no GitHub permissions |
| GitHub Packages | ⚠️ rename required | scope must be `@plaud-ai/*`; every dev needs a `read:packages` token |
| public npm | ❌ | world-readable, contradicts "internal only" |
| Nexus / Artifactory | ✅ | point it at the existing instance |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401 Unauthorized` (when publishing) | no `_authToken` for this registry in `~/.npmrc`; run `npm login` |
| `404 Not Found` on install | token is fine but the scope rules do not cover it; check `'@plaudai/*'` in the config |
| `cannot publish over the previously published versions` | version unchanged; run `pnpm version:patch` |
| `SELF_SIGNED_CERT_IN_CHAIN` | self-signed certificate; see `strict-ssl=false` above |
| panel says `not found` | confirm it published: `npm view @plaudai/dsh-plugin-notion --registry <url>` |
