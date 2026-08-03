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

function walkRust(dir, found = []) {
  if (!fs.existsSync(dir)) return found
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['target', 'vendor', 'tests'].includes(entry.name)) walkRust(full, found)
      continue
    }
    if (entry.name.endsWith('.rs') && !entry.name.endsWith('_tests.rs')) found.push(path.resolve(full))
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

// Replace comments and string/character literals with spaces while preserving offsets. This keeps
// brace matching stable without mistaking documentation examples or format strings for Rust syntax.
function maskRustNonCode(source) {
  const out = [...source]
  let index = 0
  let blockDepth = 0
  let state = 'code'
  let rawHashes = 0

  const blank = (at) => {
    if (out[at] !== '\n' && out[at] !== '\r') out[at] = ' '
  }

  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]

    if (state === 'line-comment') {
      blank(index)
      if (current === '\n') state = 'code'
      index += 1
      continue
    }
    if (state === 'block-comment') {
      blank(index)
      if (current === '/' && next === '*') {
        blank(index + 1)
        blockDepth += 1
        index += 2
      } else if (current === '*' && next === '/') {
        blank(index + 1)
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) state = 'code'
      } else {
        index += 1
      }
      continue
    }
    if (state === 'string' || state === 'character') {
      blank(index)
      if (current === '\\') {
        blank(index + 1)
        index += 2
      } else if ((state === 'string' && current === '"') || (state === 'character' && current === "'")) {
        state = 'code'
        index += 1
      } else {
        index += 1
      }
      continue
    }
    if (state === 'raw-string') {
      blank(index)
      if (current === '"' && source.slice(index + 1, index + 1 + rawHashes) === '#'.repeat(rawHashes)) {
        for (let offset = 1; offset <= rawHashes; offset += 1) blank(index + offset)
        index += rawHashes + 1
        state = 'code'
      } else {
        index += 1
      }
      continue
    }

    if (current === '/' && next === '/') {
      blank(index)
      blank(index + 1)
      state = 'line-comment'
      index += 2
      continue
    }
    if (current === '/' && next === '*') {
      blank(index)
      blank(index + 1)
      state = 'block-comment'
      blockDepth = 1
      index += 2
      continue
    }
    if (current === '"') {
      blank(index)
      state = 'string'
      index += 1
      continue
    }
    if (current === "'") {
      // A lifetime such as `'a` is code, while a quoted scalar such as `'{'` is a character literal.
      const close = source.indexOf("'", index + 1)
      if (close > index + 1 && close - index <= 6) {
        blank(index)
        state = 'character'
      }
      index += 1
      continue
    }
    if (current === 'r') {
      const raw = source.slice(index).match(/^r(#{0,16})"/)
      if (raw) {
        rawHashes = raw[1].length
        for (let offset = 0; offset < raw[0].length; offset += 1) blank(index + offset)
        index += raw[0].length
        state = 'raw-string'
        continue
      }
    }
    index += 1
  }
  return out.join('')
}

function matchingBrace(source, openIndex) {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
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

export function findOrphanRustModules({
  root = process.cwd(),
  sourceRoot = 'src-tauri/src',
  entrypoints = ['lib.rs', 'main.rs'],
} = {}) {
  const absoluteRoot = path.resolve(root)
  const absoluteSourceRoot = path.resolve(absoluteRoot, sourceRoot)
  const files = walkRust(absoluteSourceRoot)
  const sourceSet = new Set(files)
  const incoming = new Map(files.map((file) => [file, 0]))

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const pathModules = new Set()
    const pathPattern = /#\s*\[\s*path\s*=\s*['"]([^'"]+)['"]\s*\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_]\w*\s*;/g
    for (const match of source.matchAll(pathPattern)) {
      const target = path.resolve(path.dirname(file), match[1])
      pathModules.add(match[0])
      if (sourceSet.has(target)) incoming.set(target, (incoming.get(target) ?? 0) + 1)
    }

    const withoutPathModules = [...pathModules].reduce((text, declaration) => text.replace(declaration, ''), source)
    const masked = maskRustNonCode(withoutPathModules)
    const modulePattern = /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/g
    for (const match of masked.matchAll(modulePattern)) {
      const candidates = [
        path.resolve(path.dirname(file), `${match[1]}.rs`),
        path.resolve(path.dirname(file), match[1], 'mod.rs'),
      ]
      const target = candidates.find((candidate) => sourceSet.has(candidate))
      if (target) incoming.set(target, (incoming.get(target) ?? 0) + 1)
    }
  }

  const allowed = new Set(entrypoints.map((entry) => path.resolve(absoluteSourceRoot, entry)))
  return files
    .filter((file) => (incoming.get(file) ?? 0) === 0 && !allowed.has(file))
    .map((file) => path.relative(absoluteRoot, file).replaceAll(path.sep, '/'))
    .sort()
}

export function findNoopTauriCommands({ root = process.cwd(), sourceRoots = ['src-tauri/src'] } = {}) {
  const absoluteRoot = path.resolve(root)
  const files = sourceRoots.flatMap((sourceRoot) => walkRust(path.resolve(absoluteRoot, sourceRoot)))
  const found = []
  const commandPattern = /#\s*\[\s*tauri::command(?:\s*\([^)]*\))?\s*\]\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)[^;{]*\{/g
  const constantResult = /^(?:return)?Ok\((?:\(\)|true|false|(?:serde_json::)?json!\(null\))\);?$/

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const masked = maskRustNonCode(source)
    commandPattern.lastIndex = 0
    for (const match of masked.matchAll(commandPattern)) {
      const openIndex = match.index + match[0].lastIndexOf('{')
      const closeIndex = matchingBrace(masked, openIndex)
      if (closeIndex < 0) continue
      const normalizedBody = masked.slice(openIndex + 1, closeIndex).replace(/\s+/g, '')
      if (constantResult.test(normalizedBody)) {
        const relative = path.relative(absoluteRoot, file).replaceAll(path.sep, '/')
        found.push(`${relative}:${match[1]}`)
      }
    }
  }
  return found.sort()
}


function invokedTauriCommands(source) {
  const commands = new Set()
  const invokePattern = /\binvoke\b/g
  for (const match of source.matchAll(invokePattern)) {
    let index = match.index + match[0].length
    while (/\s/.test(source[index] ?? '')) index += 1
    if (source[index] === '<') {
      let depth = 0
      while (index < source.length) {
        if (source[index] === '<') depth += 1
        if (source[index] === '>') {
          depth -= 1
          if (depth === 0) {
            index += 1
            break
          }
        }
        index += 1
      }
      while (/\s/.test(source[index] ?? '')) index += 1
    }
    if (source[index] !== '(') continue
    index += 1
    while (/\s/.test(source[index] ?? '')) index += 1
    const quote = source[index]
    if (quote !== "'" && quote !== '"') continue
    const end = source.indexOf(quote, index + 1)
    if (end > index + 1) commands.add(source.slice(index + 1, end))
  }
  return commands
}

export function findUnreferencedTauriCommands({
  root = process.cwd(),
  handlerFile = 'src-tauri/src/lib.rs',
  frontendRoots = ['src'],
} = {}) {
  const absoluteRoot = path.resolve(root)
  const handlerPath = path.resolve(absoluteRoot, handlerFile)
  if (!fs.existsSync(handlerPath)) return []

  const masked = maskRustNonCode(fs.readFileSync(handlerPath, 'utf8'))
  const handlerMatch = masked.match(/generate_handler!\s*\[([\s\S]*?)\]\s*\)/)
  if (!handlerMatch) return []
  const handlers = handlerMatch[1]
    .split(',')
    .map((entry) => entry.trim().match(/([A-Za-z_]\w*)$/)?.[1])
    .filter(Boolean)

  const invoked = new Set()
  for (const file of frontendRoots.flatMap((sourceRoot) => walk(path.resolve(absoluteRoot, sourceRoot)))) {
    for (const command of invokedTauriCommands(fs.readFileSync(file, 'utf8'))) invoked.add(command)
  }

  const relative = path.relative(absoluteRoot, handlerPath).replaceAll(path.sep, '/')
  return handlers
    .filter((handler) => !invoked.has(handler))
    .map((handler) => `${relative}:${handler}`)
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
  const rustOrphans = findOrphanRustModules({ root })
  const noopCommands = findNoopTauriCommands({ root })
  const unreferencedCommands = findUnreferencedTauriCommands({ root })
  const problems = []
  if (orphans.length) {
    problems.push(`Dead source modules (no runtime importer):\n${orphans.map((file) => `- ${file}`).join('\n')}`)
  }
  if (rustOrphans.length) {
    problems.push(`Dead Rust modules (outside the production module graph):\n${rustOrphans.map((file) => `- ${file}`).join('\n')}`)
  }
  if (noopCommands.length) {
    problems.push(`No-op Tauri commands (registered production IPC that only returns a constant):\n${noopCommands.map((command) => `- ${command}`).join('\n')}`)
  }
  if (unreferencedCommands.length) {
    problems.push(`Unreferenced Tauri commands (registered in Rust but never invoked by production TS/TSX):\n${unreferencedCommands.map((command) => `- ${command}`).join('\n')}`)
  }
  if (problems.length) throw new Error(problems.join('\n\n'))
  return 0
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  try {
    checkRepository()
    console.log('Dead-code audit: no orphan TS/TSX or Rust modules, no-op Rust commands, or unreferenced Rust commands found.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
