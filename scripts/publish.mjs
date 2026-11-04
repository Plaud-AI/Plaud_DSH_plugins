#!/usr/bin/env node
/**
 * Publish every package to a registry, one `npm publish` per package.
 *
 * Deliberately uses npm rather than `pnpm -r publish`: pnpm resolves the whole
 * workspace dependency graph first (and pnpm 10+ ignores `link-workspace-packages`
 * from .npmrc, so the workspace core is fetched from the registry and 404s), and
 * it runs a supply-chain lockfile check that aborts the run. npm publishes a
 * directory as-is, which is exactly what these self-contained packages need.
 *
 * Usage:
 *   # company registry
 *   $env:NPM_REGISTRY = "http://registry.internal:4873"
 *   pnpm release
 *
 *   # public npm — clients then need no .npmrc at all
 *   pnpm release --public
 *
 * npm requires 2FA for publishing: either answer the interactive OTP prompt or
 * pass `--otp <code>` (see https://www.npmjs.com/settings/~/security).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isPublic = process.argv.includes('--public')
const registry = process.env.NPM_REGISTRY ?? (isPublic ? 'https://registry.npmjs.org/' : 'http://localhost:4873')
const access = isPublic ? 'public' : 'restricted'

const workspaces = ['core', 'notion', 'linear', 'slack', 'plaud', 'feishu']

function fail(message) {
  console.error(`publish: ${message}`)
  process.exit(1)
}

if (!process.env.NPM_REGISTRY && !isPublic) {
  console.warn(`publish: NPM_REGISTRY is unset, falling back to ${registry}`)
}

const passthrough = process.argv.slice(2).filter((argument) => argument !== '--public')
const quote = (argument) => (/[\s"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument)

console.log(`publish: registry ${registry} (access: ${access})`)

for (const name of workspaces) {
  const dir = join(root, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

  if (name !== 'core' && !existsSync(join(dir, 'dist', 'index.js'))) {
    fail(`packages/${name}/dist is missing — run \`pnpm -r build\` first`)
  }

  const commandLine = ['npm', 'publish', '--access', access, '--registry', registry, ...passthrough]
    .map(quote)
    .join(' ')

  console.log(`publish: ${manifest.name}@${manifest.version}`)
  const result = spawnSync(commandLine, { stdio: 'inherit', cwd: dir, shell: true })

  if (result.error) fail(result.error.message)
  if (result.status !== 0) {
    fail(
      `npm publish exited with ${result.status} for ${manifest.name}\n` +
        '  · E403 about 2FA — publishing requires two-factor auth: answer the prompt, or pass --otp <code>\n' +
        '  · E403 about permission — the account must be a member of the scope\'s org\n' +
        '  · E402 "cannot publish over" — that version exists; bump it first',
    )
  }
}

console.log('publish: done — installed users update with `dsh plugin add <name>@latest`')
