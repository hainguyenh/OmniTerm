import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const specsRoot = path.join(repoRoot, 'docs', 'specs')
const requiredDomains = ['architecture', 'components', 'contracts', 'designs', 'features']
const requiredFrontMatterKeys = ['id:', 'status:', 'area:', 'navigation:', 'platforms:', 'tags:', 'related:', 'properties:']
const requiredLeafHeadings = [
  '## Description',
  '## What',
  '## Why',
  '## How',
  '## When',
  '## Behavior',
  '## Functionalities',
  '## Components and functions',
  '## State and data',
  '## Errors and edge cases',
  '## Security and invariants',
  '## Verification',
]

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(fullPath))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath)
  }
  return files
}

test('spec documentation is routed through scoped sub-folders', async () => {
  for (const domain of requiredDomains) {
    const directory = path.join(specsRoot, domain)
    assert.equal((await stat(directory)).isDirectory(), true, `missing docs/specs/${domain}`)
    assert.equal((await stat(path.join(directory, 'README.md'))).isFile(), true, `missing ${domain}/README.md router`)
  }

  const rootEntries = await readdir(specsRoot, { withFileTypes: true })
  const flatLeafSpecs = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => entry.name)
  assert.deepEqual(flatLeafSpecs, [], 'leaf specs belong in scoped sub-folders, not docs/specs root')
})

test('leaf specs carry required metadata and explain what why how when', async () => {
  const files = (await markdownFiles(specsRoot)).filter((file) => path.basename(file) !== 'README.md')
  assert.ok(files.length >= 20, 'detailed specs should be decomposed into focused leaf documents')

  for (const file of files) {
    const source = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
    const relative = path.relative(repoRoot, file)
    assert.ok(source.startsWith('---\n'), `${relative} must begin with YAML front matter`)
    for (const key of requiredFrontMatterKeys) {
      assert.ok(source.includes(`\n${key}`) || source.startsWith(`${key}`), `${relative} missing front matter key ${key}`)
    }
    for (const heading of requiredLeafHeadings) {
      assert.ok(source.includes(`\n${heading}\n`), `${relative} missing ${heading}`)
    }
    assert.match(
      source,
      /\|\s*(Component|Function|Unit)\s*\|\s*What\s*\|\s*Why\s*\|\s*How\s*\|\s*When\s*\|/i,
      `${relative} must include a component/function What/Why/How/When catalog`,
    )
  }
})

test('component inventories trace frontend modules and public Rust functions to source', async () => {
  const frontendInventoryPath = path.join(specsRoot, 'components', 'frontend', 'source-inventory.md')
  const rustInventoryPath = path.join(specsRoot, 'components', 'rust', 'source-inventory.md')
  const frontendInventory = await readFile(frontendInventoryPath, 'utf8')
  const rustInventory = await readFile(rustInventoryPath, 'utf8')

  for (const directory of ['ui/components', 'ui/hooks', 'ui/utils']) {
    const entries = await readdir(path.join(repoRoot, directory), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue
      const relative = `${directory}/${entry.name}`
      assert.ok(frontendInventory.includes(`\`${relative}\``), `frontend component inventory missing ${relative}`)
    }
  }

  for (const directory of ['crates/app-core/src', 'src-tauri/src']) {
    const entries = await readdir(path.join(repoRoot, directory), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.rs') || entry.name.includes('_test') || entry.name === 'test_support.rs') continue
      const relative = `${directory}/${entry.name}`
      const source = await readFile(path.join(repoRoot, relative), 'utf8')
      const publicFunctions = [...source.matchAll(/\bpub(?:\(crate\))?\s+(?:async\s+)?fn\s+([A-Za-z0-9_]+)/g)].map((match) => match[1])
      if (publicFunctions.length === 0) continue
      assert.ok(rustInventory.includes(`\`${relative}\``), `Rust component inventory missing ${relative}`)
      for (const functionName of publicFunctions) {
        assert.ok(rustInventory.includes(`\`${functionName}\``), `Rust component inventory missing public function ${relative}::${functionName}`)
      }
    }
  }
})
