import assert from 'node:assert/strict'
import test from 'node:test'

import { runGithub, sanitizeGhArgs } from '../github.mjs'

function repositoryRunner(calls) {
  const config = new Map([
    ['omniterm.identity.account', 'alice'],
    ['omniterm.identity.authorName', 'Alice Example'],
    ['omniterm.identity.authorEmail', 'alice@example.test'],
    ['user.name', 'Alice Example'],
    ['user.email', 'alice@example.test'],
    ['credential.username', 'alice'],
    ['credential.https://github.com.useHttpPath', 'true'],
    ['branch.main.remote', 'origin'],
  ])
  return (command, args, options = {}) => {
    calls.push({ command, args, options })
    if (command === 'git' && args[0] === 'config') {
      const value = config.get(args.at(-1))
      return value === undefined
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: `${value}\n`, stderr: '' }
    }
    if (command === 'git' && args[0] === 'remote' && args.length === 1) {
      return { status: 0, stdout: 'origin\n', stderr: '' }
    }
    if (command === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
    if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
      return { status: 0, stdout: 'https://alice@github.com/owner/repo\n', stderr: '' }
    }
    if (command === 'gh' && args[0] === 'auth') return { status: 0, stdout: 'locked-token\n', stderr: '' }
    if (command === 'gh' && args[0] === 'api') return { status: 0, stdout: 'alice\n', stderr: '' }
    if (command === 'gh') return { status: 0, stdout: '', stderr: '' }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  }
}

test('GitHub wrapper always selects the locked account token even when another token is active', () => {
  const previous = process.env.GH_TOKEN
  process.env.GH_TOKEN = 'wrong-active-token'
  const calls = []
  try {
    assert.equal(runGithub(['pr', 'create', '--draft'], { runner: repositoryRunner(calls) }), 0)
    const tokenLookup = calls.find((call) => call.command === 'gh' && call.args[0] === 'auth')
    assert.deepEqual(tokenLookup.args, ['auth', 'token', '--hostname', 'github.com', '--user', 'alice'])
    assert.equal(tokenLookup.options.env.GH_TOKEN, undefined)
    const mutation = calls.at(-1)
    assert.deepEqual(mutation.args, ['pr', 'create', '--draft'])
    assert.equal(mutation.options.env.GH_TOKEN, 'locked-token')
    assert.equal(mutation.options.env.GITHUB_TOKEN, undefined)
    assert.equal(mutation.options.stdio, 'inherit')
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = previous
  }
})

test('GitHub wrapper accepts pnpm separator and refuses token-printing commands', () => {
  assert.deepEqual(sanitizeGhArgs(['--', 'issue', 'create']), ['issue', 'create'])
  assert.throws(() => sanitizeGhArgs([]), /Usage/)
  assert.throws(() => sanitizeGhArgs(['auth', 'token', '--user', 'alice']), /never prints/)
  assert.throws(() => sanitizeGhArgs(['auth', 'status', '--show-token']), /never prints/)
})
