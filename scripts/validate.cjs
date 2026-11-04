#!/usr/bin/env node
/**
 * Structural validation for this monorepo.
 *
 * Checks, without installing anything:
 *   - every JSON file parses
 *   - every cordis.patch.yml parses (with the harness `!!js` tag stripped)
 *   - a bundle's `dsh.bundle.patch` points at an existing file
 *   - every patch entry that names a package resolves to the bundle itself or
 *     one of its declared dependencies
 *
 * Requires js-yaml on NODE_PATH, e.g.:
 *   NODE_PATH=~/.dsh/profiles/web/node_modules node scripts/validate.cjs
 */
const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs')
const { join, dirname, relative } = require('node:path')

const yaml = require('js-yaml')

const root = join(__dirname, '..')
const skip = new Set([
  'node_modules',
  'lib',
  'dist',
  '.git',
  '.tools',
  '.npm-cache',
  '.pnpm-store',
  '.pnpm-home',
  '.cache',
  '.verdaccio-storage',
])

let errors = 0
let checks = 0

function fail(message) {
  errors += 1
  console.error(`  FAIL ${message}`)
}

function walk(directory, visit) {
  for (const name of readdirSync(directory)) {
    if (skip.has(name)) continue
    const full = join(directory, name)
    const stats = statSync(full)
    if (stats.isDirectory()) walk(full, visit)
    else visit(full)
  }
}

function stripHarnessTags(source) {
  // The harness supports `!!js <expr>` in patches; plain YAML parsers do not.
  return source.replace(/!!js\s+/g, '')
}

console.log('JSON files')
walk(root, (file) => {
  if (!file.endsWith('.json')) return
  checks += 1
  try {
    JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`${relative(root, file)}: ${error.message}`)
  }
})

console.log('YAML patches')
const nonPatchYaml = new Set(['pnpm-workspace.yaml', 'pnpm-lock.yaml'])
walk(root, (file) => {
  if (!file.endsWith('.yml') && !file.endsWith('.yaml')) return
  if (nonPatchYaml.has(relative(root, file))) return
  checks += 1
  let document
  try {
    document = yaml.load(stripHarnessTags(readFileSync(file, 'utf8')))
  } catch (error) {
    fail(`${relative(root, file)}: ${error.message}`)
    return
  }
  if (!Array.isArray(document)) {
    // Deployment manifests (docker compose, Verdaccio config) are YAML but not
    // patches; parsing successfully is the whole check for them.
    if (relative(root, file).startsWith('deploy')) return
    fail(`${relative(root, file)}: expected a YAML array of patch operations`)
    return
  }
  for (const operation of document) {
    if (operation === null || typeof operation !== 'object') {
      fail(`${relative(root, file)}: patch operation is not an object`)
      continue
    }
    const inserts = operation.insert
    if (inserts === undefined) continue
    if (!Array.isArray(inserts)) {
      fail(`${relative(root, file)}: "insert" must be an array`)
      continue
    }
    for (const entry of inserts) {
      if (typeof entry?.id !== 'string' || entry.id.length === 0) {
        fail(`${relative(root, file)}: insert entry without a string "id"`)
      }
      if (typeof entry?.name !== 'string' || entry.name.length === 0) {
        fail(`${relative(root, file)}: insert entry "${entry?.id}" without a string "name"`)
      }
    }
  }
})

console.log('Bundles')
walk(root, (file) => {
  if (!file.endsWith('package.json')) return
  if (dirname(file) === root) return
  checks += 1
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  const patch = manifest?.dsh?.bundle?.patch
  const directory = dirname(file)
  const label = relative(root, file)

  if (patch === undefined) return
  if (typeof patch !== 'string') {
    fail(`${label}: dsh.bundle.patch must be a string`)
    return
  }
  const patchFile = join(directory, patch)
  if (!existsSync(patchFile)) {
    fail(`${label}: dsh.bundle.patch points at a missing file (${patch})`)
    return
  }

  const document = yaml.load(stripHarnessTags(readFileSync(patchFile, 'utf8')))
  const allowed = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  for (const operation of Array.isArray(document) ? document : []) {
    for (const entry of operation?.insert ?? []) {
      if (typeof entry?.name !== 'string') continue
      if (!allowed.has(entry.name)) {
        fail(
          `${label}: patch references "${entry.name}", which is neither the bundle itself nor a declared dependency`,
        )
      }
    }
  }
})

console.log(`\n${checks} file(s) checked, ${errors} problem(s)`)
process.exit(errors === 0 ? 0 : 1)
