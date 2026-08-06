#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_LIMITS = Object.freeze({
  '.ts': 400,
  '.tsx': 500,
  '.js': 350,
  '.css': 600,
  '.rs': 400,
})

const IGNORED_DIRECTORIES = new Set([
  '.git', '.worktrees', 'coverage', 'coverage-js', 'coverage-rust', 'dist',
  'node_modules', 'target', 'vendor', 'markdown-explorer',
])

export function countLines(content) {
  if (content.length === 0) return 0
  const normalized = content.replaceAll('\r\n', '\n')
  const count = normalized.split('\n').length
  return normalized.endsWith('\n') ? count - 1 : count
}

async function collectFiles(root, limits) {
  const files = []

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(fullPath)
      else if (entry.isFile() && Object.hasOwn(limits, path.extname(entry.name))) files.push(fullPath)
    }
  }

  await walk(root)
  return files.sort()
}

export async function checkLoc({ root = process.cwd(), limits = DEFAULT_LIMITS } = {}) {
  const absoluteRoot = path.resolve(root)
  const files = await collectFiles(absoluteRoot, limits)
  const violations = []

  for (const fullPath of files) {
    const relativePath = path.relative(absoluteRoot, fullPath).replaceAll(path.sep, '/')
    const extension = path.extname(fullPath)
    const limit = limits[extension]
    const lines = countLines(await readFile(fullPath, 'utf8'))
    if (lines > limit) {
      violations.push({
        path: relativePath,
        extension,
        lines,
        limit,
        reason: `${extension} hard limit exceeded`,
      })
    }
  }

  return {
    filesChecked: files.length,
    limits,
    violations: violations.sort((a, b) => a.path.localeCompare(b.path)),
  }
}

function parseArgs(argv) {
  const options = { root: process.cwd(), json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--root') options.root = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = await checkLoc({ root: options.root })

  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else if (result.violations.length === 0) {
    console.log(`LOC: checked ${result.filesChecked} files; all satisfy hard limits.`)
  } else {
    console.error(`LOC: ${result.violations.length} violation(s) across ${result.filesChecked} files:`)
    for (const item of result.violations) {
      console.error(`  ${item.path}: ${item.lines}/${item.limit} — ${item.reason}`)
    }
  }

  if (result.violations.length > 0) process.exitCode = 1
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
