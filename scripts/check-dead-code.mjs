#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'coverage', 'target', '__tests__', 'markdown-explorer', 'vendor'].includes(entry.name)) walk(full, found)
      continue
    }
    if (SOURCE_EXTENSIONS.includes(path.extname(entry.name)) && !/\.(?:test|spec)\.tsx?$/.test(entry.name)) {
      found.push(path.resolve(full))
    }
  }
  return found
}

function resolveImport(importer, specifier, sourceSet) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(importer), specifier)
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ]
  return candidates.find((candidate) => sourceSet.has(candidate)) ?? null
}

export function findOrphanModules({ root = process.cwd(), sourceRoots, entrypoints }) {
  const absoluteRoot = path.resolve(root)
  const files = sourceRoots.flatMap((sourceRoot) => walk(path.resolve(absoluteRoot, sourceRoot)))
  const sourceSet = new Set(files)
  const incoming = new Map(files.map((file) => [file, 0]))

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    IMPORT_PATTERN.lastIndex = 0
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = resolveImport(file, match[1] ?? match[2], sourceSet)
      if (target) incoming.set(target, (incoming.get(target) ?? 0) + 1)
    }
  }

  const allowed = new Set(entrypoints.map((entry) => path.resolve(absoluteRoot, entry)))
  return files
    .filter((file) => (incoming.get(file) ?? 0) === 0 && !allowed.has(file))
    .map((file) => path.relative(absoluteRoot, file).replaceAll(path.sep, '/'))
    .sort()
}

export function checkRepository(root = process.cwd()) {
  const pluginEntries = fs.existsSync(path.join(root, 'plugins'))
    ? fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'markdown-explorer')
      .map((entry) => `plugins/${entry.name}/src/index.ts`)
    : []
  const orphans = findOrphanModules({
    root,
    sourceRoots: ['src', 'contract', 'plugins'],
    entrypoints: [
      'src/main.tsx',
      'src/testSetup.ts',
      'src/testUtils.tsx',
      'src/vite-env.d.ts',
      'contract/index.ts',
      ...pluginEntries,
    ],
  })
  if (orphans.length) {
    throw new Error(`Dead source modules (no runtime importer):\n${orphans.map((file) => `- ${file}`).join('\n')}`)
  }
  return 0
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  try {
    checkRepository()
    console.log('Dead-code audit: no orphan TS/TSX source modules found.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
