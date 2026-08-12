import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8')

// Checkouts with core.autocrlf=true rewrite LF to CRLF on disk, so compare normalized text.
const readNormalized = async (relativePath) => (await read(relativePath)).replace(/\r\n/g, '\n')

test('tool-specific memory files import the canonical AGENTS.md without duplicating it', async () => {
  assert.equal(await readNormalized('CLAUDE.md'), '@AGENTS.md\n')
  assert.equal(await readNormalized('GEMINI.md'), '@AGENTS.md\n')
})

test('every agent skill exposes Claude Code, Copilot, and opencode pointers to the canonical SKILL.md', async () => {
  const pointers = [
    '.claude/skills/bump-version/SKILL.md',
    '.github/prompts/bump-version.prompt.md',
    '.opencode/command/bump-version.md',
  ]
  for (const pointer of pointers) {
    const contents = await read(pointer)
    assert.match(contents, /\.agents\/skills\/bump-version\/SKILL\.md/, `${pointer} must point at the canonical skill`)
  }
  assert.match(await readNormalized('.claude/skills/bump-version/SKILL.md'), /^---\nname: bump-version\n/)
})

test('AGENTS.md contains the required package, test, identity, and GitHub mutation rules', async () => {
  const agents = await read('AGENTS.md')
  assert.match(agents, /Use `pnpm` exclusively/)
  assert.match(agents, /Every feature or functional behavior change requires unit tests/)
  assert.match(agents, /Every bug fix requires a regression test/)
  assert.match(agents, /`pnpm test:quality`.*`pnpm check:push`/s)
  assert.match(agents, /`pnpm identity:setup`/)
  assert.match(agents, /`pnpm github -- <gh args>`/)
  assert.match(agents, /must not run a raw mutating `gh` command/)
  assert.match(agents, /Never use `--no-verify`.*explicitly authorizes/s)
})

test('legacy rules point to AGENTS.md and no longer prescribe npm or Prettier', async () => {
  const rules = `${await read('.agents/rules/code-write.md')}\n${await read('.agents/rules/run-tests-after-task.md')}`
  assert.match(rules, /AGENTS\.md/g)
  assert.doesNotMatch(rules, /npm run test|prettier/i)
  assert.match(rules, /pnpm check:push/)
})

test('package scripts and Husky hooks wire identity checks before the existing Test Gate', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.scripts['identity:setup'], 'node scripts/identity-setup.mjs')
  assert.equal(manifest.scripts.github, 'node scripts/github.mjs')
  const preCommit = await read('.husky/pre-commit')
  const commitMsg = await read('.husky/commit-msg')
  const prePush = await read('.husky/pre-push')
  assert.match(preCommit, /identity-guard\.mjs pre-commit/)
  assert.match(commitMsg, /identity-guard\.mjs commit-msg/)
  assert.ok(prePush.indexOf('identity-guard.mjs pre-push') < prePush.indexOf('pre-push-check.mjs'))
})
