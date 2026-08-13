import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  discoverAccounts,
  getLockedGhToken,
  parseGithubHttpsUrl,
  parseGithubRemoteUrl,
  parseGithubSshUrl,
  readIdentityLock,
  runCommand,
  validateLocalIdentity,
  verifyGitCredential,
  withGithubUsername,
  writeLocalIdentityConfig,
} from '../github-identity-core.mjs'

test('account discovery deduplicates GCM and gh accounts case-insensitively', () => {
  const runner = (command, args) => {
    if (command === 'git') return { status: 0, stdout: 'hainguyenh\nshared-account\n', stderr: '' }
    assert.deepEqual(args, ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts'])
    return {
      status: 0,
      stdout: JSON.stringify({
        hosts: {
          'github.com': [
            { login: 'HAINGUYENH', active: false, state: 'success' },
            { login: 'nthai11', active: true, state: 'success' },
          ],
        },
      }),
      stderr: '',
    }
  }

  const accounts = discoverAccounts({ runner })
  assert.deepEqual(accounts.map((account) => account.login), ['hainguyenh', 'nthai11', 'shared-account'])
  assert.deepEqual(accounts[0].sources, ['gcm', 'gh'])
  assert.equal(accounts[1].ghActive, true)
})

test('GitHub HTTPS URL parsing supports only repository-scoped GitHub.com HTTPS URLs', () => {
  const parsed = parseGithubHttpsUrl('https://alice@github.com/owner/repo.git')
  assert.equal(parsed.username, 'alice')
  assert.equal(parsed.owner, 'owner')
  assert.equal(parsed.repository, 'repo')
  assert.equal(parsed.isSSH, false)
  assert.equal(withGithubUsername('https://github.com/owner/repo', 'bob'), 'https://bob@github.com/owner/repo')

  assert.throws(() => parseGithubHttpsUrl('git@github.com:owner/repo.git'), /HTTPS/)
  assert.throws(() => parseGithubHttpsUrl('https://github.example.com/owner/repo'), /GitHub.com/)
  assert.throws(() => parseGithubHttpsUrl('https://github.com/owner/repo/extra'), /exactly one/)
  assert.throws(() => parseGithubHttpsUrl('https://alice:secret@github.com/owner/repo'), /must not contain/)
})

test('GitHub SSH URL parsing accepts git@ format and rejects non-matching strings', () => {
  const parsed = parseGithubSshUrl('git@github.com:owner/repo.git')
  assert.ok(parsed)
  assert.equal(parsed.isSSH, true)
  assert.equal(parsed.owner, 'owner')
  assert.equal(parsed.repository, 'repo')
  assert.equal(parsed.username, '')

  // .git suffix is optional
  const noDotGit = parseGithubSshUrl('git@github.com:owner/repo')
  assert.ok(noDotGit)
  assert.equal(noDotGit.repository, 'repo')

  // Non-SSH strings return null instead of throwing
  assert.equal(parseGithubSshUrl('https://github.com/owner/repo'), null)
  assert.equal(parseGithubSshUrl('ssh://git@github.com/owner/repo'), null)
  assert.equal(parseGithubSshUrl(''), null)
})

test('parseGithubRemoteUrl accepts both HTTPS and SSH, rejects unknown formats', () => {
  const https = parseGithubRemoteUrl('https://github.com/owner/repo.git')
  assert.equal(https.isSSH, false)
  assert.equal(https.owner, 'owner')

  const ssh = parseGithubRemoteUrl('git@github.com:owner/repo.git')
  assert.equal(ssh.isSSH, true)
  assert.equal(ssh.owner, 'owner')

  assert.throws(() => parseGithubRemoteUrl('ftp://github.com/owner/repo'), /HTTPS/)
})

test('withGithubUsername returns SSH URL unchanged', () => {
  const original = 'git@github.com:owner/repo.git'
  assert.equal(withGithubUsername(original, 'alice'), original)
})

test('verifyGitCredential is a no-op for SSH remotes', () => {
  let credentialCalled = false
  const runner = (command, args) => {
    if (args.includes('fill')) credentialCalled = true
    return { status: 0, stdout: '', stderr: '' }
  }
  assert.doesNotThrow(() => verifyGitCredential('git@github.com:owner/repo.git', 'alice', { runner }))
  assert.equal(credentialCalled, false)
})

test('HTTPS credential mismatch fails before network verification', () => {
  let apiCalled = false
  const runner = (command, args) => {
    if (command === 'git' && args.includes('fill')) {
      return { status: 0, stdout: 'protocol=https\nhost=github.com\nusername=bob\npassword=secret\n', stderr: '' }
    }
    apiCalled = true
    return { status: 0, stdout: 'alice\n', stderr: '' }
  }
  assert.throws(
    () => verifyGitCredential('https://alice@github.com/owner/repo', 'alice', { runner }),
    /does not belong/,
  )
  assert.equal(apiCalled, false)
})

test('GitHub CLI x-access-token placeholder is accepted only after the token resolves to the lock', () => {
  const calls = []
  const runner = (command, args, options) => {
    calls.push({ command, args, options })
    if (command === 'git') {
      return { status: 0, stdout: 'username=x-access-token\npassword=selected-token\n', stderr: '' }
    }
    return { status: 0, stdout: 'alice\n', stderr: '' }
  }

  assert.doesNotThrow(
    () => verifyGitCredential('https://alice@github.com/owner/repo', 'alice', { runner }),
  )
  assert.equal(calls[1].options.env.GH_TOKEN, 'selected-token')

  const wrongAccountRunner = (command) => command === 'git'
    ? { status: 0, stdout: 'username=x-access-token\npassword=wrong-token\n', stderr: '' }
    : { status: 0, stdout: 'bob\n', stderr: '' }
  assert.throws(
    () => verifyGitCredential('https://alice@github.com/owner/repo', 'alice', { runner: wrongAccountRunner }),
    /resolved to bob, not the locked account alice/,
  )
})

test('network and authentication failures never expose the credential token', () => {
  const secret = 'github_pat_never_print_this'
  const runner = (command, args) => {
    if (command === 'git' && args.includes('fill')) {
      return { status: 0, stdout: `username=alice\npassword=${secret}\n`, stderr: '' }
    }
    return { status: 1, stdout: '', stderr: `request rejected for ${secret}` }
  }
  assert.throws(
    () => verifyGitCredential('https://alice@github.com/owner/repo', 'alice', { runner }),
    (error) => /network or authentication/.test(error.message) && !error.message.includes(secret),
  )
})

test('gh token lookup names the locked user and ignores an ambient active-account token', () => {
  const previous = process.env.GH_TOKEN
  process.env.GH_TOKEN = 'ambient-active-token'
  const calls = []
  try {
    const runner = (command, args, options) => {
      calls.push({ command, args, options })
      if (args[0] === 'auth') return { status: 0, stdout: 'locked-token\n', stderr: '' }
      return { status: 0, stdout: 'alice\n', stderr: '' }
    }
    assert.equal(getLockedGhToken('alice', { runner }), 'locked-token')
    assert.deepEqual(calls[0].args, ['auth', 'token', '--hostname', 'github.com', '--user', 'alice'])
    assert.equal(calls[0].options.env.GH_TOKEN, undefined)
    assert.equal(calls[1].options.env.GH_TOKEN, 'locked-token')
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = previous
  }
})

test('local config is prepared as one complete repository-only identity lock', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniterm-identity-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(runCommand('git', ['init', '--quiet'], { cwd: root }).status, 0)
  assert.equal(
    runCommand('git', ['remote', 'add', 'origin', 'https://old-user@github.com/owner/repo.git'], { cwd: root }).status,
    0,
  )
  const lock = { account: 'alice', authorName: 'Alice Example', authorEmail: 'alice@example.test' }

  writeLocalIdentityConfig(lock, 'origin', 'https://old-user@github.com/owner/repo.git', { cwd: root })

  assert.deepEqual(readIdentityLock({ cwd: root }), lock)
  const validated = validateLocalIdentity({ cwd: root })
  assert.equal(validated.remoteUrl, 'https://alice@github.com/owner/repo.git')
  const config = await readFile(path.join(root, '.git', 'config'), 'utf8')
  assert.match(config, /useHttpPath = true/)
  assert.match(config, /pushurl = https:\/\/alice@github\.com\/owner\/repo\.git/)
  assert.doesNotMatch(config, /token|password|secret/i)
})
