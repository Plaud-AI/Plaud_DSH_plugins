#!/usr/bin/env node
/**
 * Fold the shared core into one connector package.
 *
 * Rollup would do this, but it needs a native binary on Windows; the graph here
 * is a handful of ESM files with exactly one cross-package specifier, so a copy
 * plus a single-import rewrite is enough — and it has no dependencies at all.
 *
 * Result:
 *   dist/index.js      the connector entry, import of the core rewritten
 *   dist/core/*.js     the core's compiled modules, next to the entry
 *
 * The core's own imports (MCP SDK, schemastery, the host tool bridge) stay bare,
 * because the connector declares them as dependencies and the host resolves
 * them once at install time.
 *
 * Usage: node scripts/bundle.mjs <package-name>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORE_SPECIFIER = '@plaud/dsh-mcp-oauth'
const CORE_IMPORT = './core/index.js'

const name = process.argv[2]
if (!name) {
  console.error('usage: node scripts/bundle.mjs <package-name>')
  process.exit(2)
}

const packageDir = join(root, 'packages', name)
const entry = join(packageDir, 'lib', 'index.js')
const coreLib = join(root, 'packages', 'core', 'lib')
const outDir = join(packageDir, 'dist')

if (!existsSync(entry)) {
  console.error(`bundle(${name}): ${entry} is missing — run tsc for this package first`)
  process.exit(1)
}
if (!existsSync(join(coreLib, 'index.js'))) {
  console.error('bundle: the core package has not been built — run tsc for packages/core first')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const source = readFileSync(entry, 'utf8')
const rewritten = source
  .split(`'${CORE_SPECIFIER}'`).join(`'${CORE_IMPORT}'`)
  .split(`"${CORE_SPECIFIER}"`).join(`"${CORE_IMPORT}"`)

if (rewritten.includes(CORE_SPECIFIER)) {
  console.error(`bundle(${name}): could not rewrite every reference to ${CORE_SPECIFIER}`)
  process.exit(1)
}

writeFileSync(join(outDir, 'index.js'), rewritten)

const coreOut = join(outDir, 'core')
mkdirSync(coreOut, { recursive: true })
let copied = 0
for (const file of readdirSync(coreLib)) {
  if (!file.endsWith('.js')) continue
  cpSync(join(coreLib, file), join(coreOut, file))
  copied += 1
}

console.log(`bundle(${name}): dist/index.js + ${copied} core module(s)`)
