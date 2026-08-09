import assert from 'node:assert/strict'
import test from 'node:test'

import { runIdentitySetup } from '../identity-setup.mjs'

function outputBuffer() {
  return {
    value: '',
    write(chunk) { this.value += chunk },
  }
}

function setupRunner({ credentialUser = 'alice', apiStatus = 0 } = {}) {
  return (command, args) => {
    if (command === 'git' && args[0] === 'config' && args.includes('--get')) {
      const key = args.at(-1)
      if (key === 'branch.main.remote') return { status: 0, stdout: 'origin\n', stderr: '' }
      return { status: 1, stdout: '', stderr: '' }
    }
    if (command === 'git' && args[0] === 'remote' && args.length === 1) {
      return { status: 0, stdout: 'origin\n', stderr: '' }
    }
    if (command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
      return { status: 0, stdout: 'https://old@github.com/owner/repo\n', stderr: '' }
    }
    if (command === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
    if (command === 'git' && args[0] === 'credential-manager') {
      return { status: 0, stdout: 'alice\nbob\n', stderr: '' }
    }
    if (command === 'git' && args.includes('fill')) {
      return { status: 0, stdout: `username=${credentialUser}\npassword=https-token\n`, stderr: '' }
    }
    if (command === 'gh' && args[0] === 'auth' && args[1] === 'status') {
      return {
        status: 0,
        stdout: JSON.stringify({ hosts: { 'github.com': [{ login: 'alice', active: false, state: 'success' }] } }),
        stderr: '',
      }
    }
    if (command === 'gh' && args[0] === 'auth' && args[1] === 'token') {
      return { status: 0, stdout: 'gh-token\n', stderr: '' }
    }
    if (command === 'gh' && args[0] === 'api') {
      return { status: apiStatus, stdout: apiStatus === 0 ? 'alice\n' : '', stderr: 'authentication failed' }
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  }
}

test('interactive setup selects an account, previews it, verifies both auth paths, then writes once', async () => {
  const answers = ['1', 'Alice Example', 'alice@example.test', 'yes']
  const output = outputBuffer()
  const writes = []
  const result = await runIdentitySetup({
    runner: setupRunner(),
    output,
    interactive: true,
    ask: async () => answers.shift(),
    writeConfig: (...args) => writes.push(args),
  })

  assert.equal(result.changed, true)
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0][0], {
    account: 'alice',
    authorName: 'Alice Example',
    authorEmail: 'alice@example.test',
  })
  assert.match(output.value, /Repository-local identity preview/)
  assert.doesNotMatch(output.value, /https-token|gh-token/)
})

test('non-interactive first-time setup fails clearly without writing config', async () => {
  let wrote = false
  await assert.rejects(
    runIdentitySetup({
      runner: setupRunner(),
      interactive: false,
      input: { isTTY: false },
      output: outputBuffer(),
      writeConfig: () => { wrote = true },
    }),
    /requires an interactive TTY.*No Git config was changed/,
  )
  assert.equal(wrote, false)
})

test('credential mismatch and network failure leave config untouched', async () => {
  for (const runner of [setupRunner({ credentialUser: 'bob' }), setupRunner({ apiStatus: 1 })]) {
    const answers = ['1', '', '', 'yes']
    let wrote = false
    await assert.rejects(
      runIdentitySetup({
        runner,
        output: outputBuffer(),
        interactive: true,
        ask: async () => answers.shift(),
        writeConfig: () => { wrote = true },
      }),
    )
    assert.equal(wrote, false)
  }
})

test('declining the final preview performs no write', async () => {
  const answers = ['alice', '', '', 'no']
  let wrote = false
  const result = await runIdentitySetup({
    runner: setupRunner(),
    output: outputBuffer(),
    interactive: true,
    ask: async () => answers.shift(),
    writeConfig: () => { wrote = true },
  })
  assert.deepEqual(result, { changed: false, cancelled: true })
  assert.equal(wrote, false)
})
