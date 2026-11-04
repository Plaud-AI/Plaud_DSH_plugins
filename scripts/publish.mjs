#!/usr/bin/env node
/**
 * Publish every connector to a registry.
 *
 * The packages are self-contained (the core is inlined into each dist), so the
 * publish order does not matter and no private version coordination is needed.
 *
 * Usage:
 *   # company registry
 *   $env:NPM_REGISTRY = "http://registry.internal:4873"
 *   pnpm release
 *
 *   # public npm — clients then need no .npmrc at all
 *   pnpm release --public
 *
 * Authenticate once per machine with `npm login --registry <url>`; the token
 * lands in ~/.npmrc and pnpm picks it up from there.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = process.env.NPM_REGISTRY ?? (process.argv.includes('--public') ? 'https://registry.npmjs.org/' : 'http://localhost:4873')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const access = process.argv.includes('--public') ? 'public' : 'restricted'

const workspaces = ['core', 'notion', 'linear', 'slack', 'plaud', 'feishu']

function fail(message) {
  console.error(`publish: ${message}`)
  process.exit(1)
}

if (!process.env.NPM_REGISTRY && access !== 'public') {
  console.warn(`publish: NPM_REGISTRY is unset, falling back to ${registry}`)
}

const wanted = []
for (const name of workspaces) {
  const dir = join(root, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

  if (name !== 'core' && !existsSync(join(dir, 'dist', 'index.js'))) {
    fail(`packages/${name}/dist is missing — run \`pnpm -r build\` first`)
  }

  wanted.push(`${manifest.name}@${manifest.version}`)
}

console.log(`publish: registry ${registry} (access: ${access})`)
console.log(`publish: ${wanted.join(', ')}`)

// Windows cannot spawn a .cmd shim without a shell, and passing an argument
// array together with `shell: true` is deprecated (DEP0190), so build the
// command line explicitly and quote only what needs it.
const quote = (argument) => (/[\s"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument)
const passthrough = process.argv.slice(2).filter((argument) => argument !== '--public')
const commandLine = [
  pnpm,
  '-r',
  'publish',
  '--no-git-checks',
  '--access',
  access,
  '--registry',
  registry,
  ...passthrough,
]
  .map(quote)
  .join(' ')

const result = spawnSync(commandLine, { stdio: 'inherit', cwd: root, shell: true })

if (result.error) fail(result.error.message)
if (result.status !== 0) {
  fail(
    `pnpm publish exited with ${result.status}\n` +
      '  · 401/403 — authenticate: npm login --registry ' +
      registry +
      '\n  · "cannot publish over" — that version already exists; run `pnpm version:patch` first',
  )
}

console.log('publish: done — installed users update with `dsh plugin add <name>@latest`')
