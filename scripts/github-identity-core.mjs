#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export const GITHUB_HOST = 'github.com'
export const LOCK_KEYS = Object.freeze({
  account: 'omniterm.identity.account',
  authorName: 'omniterm.identity.authorName',
  authorEmail: 'omniterm.identity.authorEmail',
})

export class IdentityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IdentityError'
  }
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: options.stdio === 'inherit' ? undefined : 'utf8',
    stdio: options.stdio ?? 'pipe',
    windowsHide: true,
  })
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    error: result.error,
  }
}

export function redactSecrets(value, secrets = []) {
  let redacted = String(value ?? '')
  for (const secret of secrets.filter(Boolean)) redacted = redacted.replaceAll(secret, '[REDACTED]')
  return redacted
}

function resultFailure(label, result, { includeStderr = true, secrets = [] } = {}) {
  const detail = [result.error?.message, includeStderr ? result.stderr.trim() : '']
    .filter(Boolean)
    .join(': ')
  return new IdentityError(redactSecrets(`${label} failed${detail ? `: ${detail}` : ''}`, secrets))
}

function requireSuccess(result, label, options) {
  if (result.error || result.status !== 0) throw resultFailure(label, result, options)
  return result.stdout.trim()
}

export function normalizeAccount(account) {
  return String(account ?? '').trim().toLowerCase()
}

export function validateAccount(account) {
  const value = String(account ?? '').trim()
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)) {
    throw new IdentityError(`Invalid GitHub account name: ${value || '(empty)'}`)
  }
  return value
}

export function validateAuthor({ authorName, authorEmail }) {
  const name = String(authorName ?? '').trim()
  const email = String(authorEmail ?? '').trim()
  if (!name || /[\0\r\n]/.test(name)) throw new IdentityError('Author name must be non-empty and single-line.')
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || /[\0\r\n]/.test(email)) {
    throw new IdentityError('Author email must be a valid single-line email address.')
  }
  return { authorName: name, authorEmail: email }
}

export function parseGcmAccounts(output) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && /^[A-Za-z0-9-]+$/.test(line))
}

export function parseGhAccounts(output) {
  let parsed
  try {
    parsed = JSON.parse(String(output ?? ''))
  } catch {
    throw new IdentityError('`gh auth status` returned invalid JSON.')
  }
  const entries = parsed?.hosts?.[GITHUB_HOST]
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => typeof entry?.login === 'string')
    .map((entry) => ({
      login: entry.login.trim(),
      active: entry.active === true,
      authenticated: entry.state === 'success',
    }))
}

export function mergeDiscoveredAccounts(gcmAccounts, ghAccounts) {
  const accounts = new Map()
  const add = (login, source, metadata = {}) => {
    if (!login || !/^[A-Za-z0-9-]+$/.test(login)) return
    const key = normalizeAccount(login)
    const current = accounts.get(key) ?? {
      login,
      sources: [],
      ghActive: false,
      ghAuthenticated: false,
    }
    if (!current.sources.includes(source)) current.sources.push(source)
    current.ghActive ||= metadata.active === true
    current.ghAuthenticated ||= metadata.authenticated === true
    accounts.set(key, current)
  }
  for (const login of gcmAccounts) add(login, 'gcm')
  for (const entry of ghAccounts) add(entry.login, 'gh', entry)
  return [...accounts.values()].sort((left, right) => left.login.localeCompare(right.login))
}

export function discoverAccounts({ runner = runCommand, cwd = process.cwd() } = {}) {
  const gcm = runner('git', ['credential-manager', 'github', 'list'], { cwd })
  const gh = runner('gh', ['auth', 'status', '--hostname', GITHUB_HOST, '--json', 'hosts'], {
    cwd,
    env: storedGhEnvironment(),
  })
  if ((gcm.error || gcm.status !== 0) && (gh.error || gh.status !== 0)) {
    throw new IdentityError('Could not discover GitHub accounts from Git Credential Manager or `gh`. Install and sign in to both, then retry.')
  }
  const gcmAccounts = gcm.error || gcm.status !== 0 ? [] : parseGcmAccounts(gcm.stdout)
  const ghAccounts = gh.error || gh.status !== 0 ? [] : parseGhAccounts(gh.stdout)
  return mergeDiscoveredAccounts(gcmAccounts, ghAccounts)
}

export function parseGithubHttpsUrl(remoteUrl) {
  let url
  try {
    url = new URL(String(remoteUrl ?? '').trim())
  } catch {
    throw new IdentityError('Identity guard supports only GitHub.com remotes over HTTPS; the configured push URL is invalid.')
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== GITHUB_HOST || url.port) {
    throw new IdentityError('Identity guard v1 supports only GitHub.com remotes over HTTPS. Configure an https://github.com/... push URL; SSH and GitHub Enterprise are not supported.')
  }
  if (url.password || url.search || url.hash) throw new IdentityError('The GitHub push URL must not contain a password, query, or fragment.')
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || !segments[0] || !segments[1].replace(/\.git$/i, '')) {
    throw new IdentityError('The GitHub push URL must identify exactly one owner/repository path.')
  }
  let username = ''
  try {
    username = decodeURIComponent(url.username)
  } catch {
    throw new IdentityError('The username in the GitHub push URL is invalid.')
  }
  return {
    url,
    username,
    owner: segments[0],
    repository: segments[1].replace(/\.git$/i, ''),
    credentialPath: segments.join('/'),
  }
}

export function withGithubUsername(remoteUrl, account) {
  const parsed = parseGithubHttpsUrl(remoteUrl)
  parsed.url.username = validateAccount(account)
  parsed.url.password = ''
  return parsed.url.toString()
}

export function gitConfigGet(key, { runner = runCommand, cwd = process.cwd(), local = true } = {}) {
  const args = ['config']
  if (local) args.push('--local')
  args.push('--get', key)
  const result = runner('git', args, { cwd })
  if (!result.error && result.status === 1) return null
  return requireSuccess(result, `Reading Git config key ${key}`)
}

export function readIdentityLock({ runner = runCommand, cwd = process.cwd() } = {}) {
  const values = Object.fromEntries(
    Object.entries(LOCK_KEYS).map(([name, key]) => [name, gitConfigGet(key, { runner, cwd })]),
  )
  if (Object.values(values).every((value) => value === null)) return null
  if (Object.values(values).some((value) => value === null)) {
    throw new IdentityError('The repository identity lock is incomplete. Run `pnpm identity:setup` in an interactive terminal to repair it.')
  }
  const account = validateAccount(values.account)
  const author = validateAuthor(values)
  return { account, ...author }
}

function availableRemotes({ runner, cwd }) {
  const result = runner('git', ['remote'], { cwd })
  return requireSuccess(result, 'Listing Git remotes').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

export function resolvePushRemote({ runner = runCommand, cwd = process.cwd() } = {}) {
  const remotes = availableRemotes({ runner, cwd })
  if (remotes.length === 0) throw new IdentityError('No Git remote is configured for this repository.')
  const branchResult = runner('git', ['branch', '--show-current'], { cwd })
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : ''
  const candidates = []
  if (branch) {
    candidates.push(gitConfigGet(`branch.${branch}.pushRemote`, { runner, cwd }))
  }
  candidates.push(gitConfigGet('remote.pushDefault', { runner, cwd }))
  if (branch) candidates.push(gitConfigGet(`branch.${branch}.remote`, { runner, cwd }))
  candidates.push(remotes.includes('origin') ? 'origin' : null, remotes.length === 1 ? remotes[0] : null)
  const remoteName = candidates.find((candidate) => candidate && candidate !== '.' && remotes.includes(candidate))
  if (!remoteName) throw new IdentityError('Could not determine one effective push remote. Configure branch.pushRemote or remote.pushDefault and retry.')
  const result = runner('git', ['remote', 'get-url', '--push', remoteName], { cwd })
  const remoteUrl = requireSuccess(result, `Resolving push URL for remote ${remoteName}`)
  parseGithubHttpsUrl(remoteUrl)
  return { remoteName, remoteUrl }
}

export function buildLocalConfigUpdates(lock, remoteName, remoteUrl) {
  const account = validateAccount(lock.account)
  const author = validateAuthor(lock)
  if (!remoteName || /[\0\r\n]/.test(remoteName)) throw new IdentityError('The push remote name is invalid.')
  return [
    [LOCK_KEYS.account, account],
    [LOCK_KEYS.authorName, author.authorName],
    [LOCK_KEYS.authorEmail, author.authorEmail],
    ['user.name', author.authorName],
    ['user.email', author.authorEmail],
    ['credential.username', account],
    [`credential.https://${GITHUB_HOST}.useHttpPath`, 'true'],
    [`remote.${remoteName}.pushurl`, withGithubUsername(remoteUrl, account)],
  ]
}

export function writeLocalIdentityConfig(lock, remoteName, remoteUrl, {
  runner = runCommand,
  cwd = process.cwd(),
  copyFile = copyFileSync,
  removeFile = unlinkSync,
} = {}) {
  const pathResult = runner('git', ['rev-parse', '--git-path', 'config'], { cwd })
  const configPathOutput = requireSuccess(pathResult, 'Locating repository-local Git config')
  const configPath = path.resolve(cwd, configPathOutput)
  const temporaryPath = `${configPath}.omniterm-${process.pid}-${randomUUID()}.tmp`
  copyFile(configPath, temporaryPath)
  try {
    for (const [key, value] of buildLocalConfigUpdates(lock, remoteName, remoteUrl)) {
      const result = runner('git', ['config', '--file', temporaryPath, '--replace-all', key, value], { cwd })
      requireSuccess(result, `Preparing local Git config key ${key}`)
    }
    copyFile(temporaryPath, configPath)
  } finally {
    try {
      removeFile(temporaryPath)
    } catch {
      // The final config is complete before cleanup; a stale temp file contains no credentials.
    }
  }
}

function credentialInput(remoteUrl, account) {
  const remote = parseGithubHttpsUrl(remoteUrl)
  return [
    'protocol=https',
    `host=${GITHUB_HOST}`,
    `path=${remote.credentialPath}`,
    `username=${validateAccount(account)}`,
    '',
    '',
  ].join('\n')
}

export function parseCredential(output) {
  const fields = new Map()
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return { username: fields.get('username') ?? '', password: fields.get('password') ?? '' }
}

function tokenEnvironment(token) {
  const env = { ...process.env, GH_HOST: GITHUB_HOST, GH_TOKEN: token }
  delete env.GITHUB_TOKEN
  return env
}

function storedGhEnvironment() {
  const env = { ...process.env }
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  delete env.GH_ENTERPRISE_TOKEN
  delete env.GITHUB_ENTERPRISE_TOKEN
  return env
}

export function verifyTokenAccount(token, expectedAccount, { runner = runCommand, cwd = process.cwd() } = {}) {
  if (!token) throw new IdentityError('GitHub authentication returned an empty token.')
  const result = runner('gh', ['api', '--hostname', GITHUB_HOST, 'user', '--jq', '.login'], {
    cwd,
    env: tokenEnvironment(token),
  })
  if (result.error || result.status !== 0) {
    throw resultFailure('GitHub account verification (network or authentication)', result, {
      includeStderr: false,
      secrets: [token],
    })
  }
  const login = result.stdout.trim()
  if (normalizeAccount(login) !== normalizeAccount(expectedAccount)) {
    throw new IdentityError(`GitHub authentication resolved to ${login || '(unknown)'}, not the locked account ${expectedAccount}.`)
  }
  return login
}

export function verifyGitCredential(remoteUrl, expectedAccount, { runner = runCommand, cwd = process.cwd() } = {}) {
  const result = runner('git', [
    '-c', `credential.username=${expectedAccount}`,
    '-c', `credential.https://${GITHUB_HOST}.useHttpPath=true`,
    'credential', 'fill',
  ], {
    cwd,
    env: { ...process.env, GCM_INTERACTIVE: 'Never' },
    input: credentialInput(remoteUrl, expectedAccount),
  })
  if (result.error || result.status !== 0) {
    throw new IdentityError(`No non-interactive HTTPS credential is available for ${expectedAccount}. Sign in with Git Credential Manager, then retry.`)
  }
  const credential = parseCredential(result.stdout)
  const credentialUsername = normalizeAccount(credential.username)
  const acceptedUsername = credentialUsername === normalizeAccount(expectedAccount)
    || credentialUsername === 'x-access-token'
  if (!acceptedUsername || !credential.password) {
    throw new IdentityError(`The HTTPS credential does not belong to the selected account ${expectedAccount}.`)
  }
  verifyTokenAccount(credential.password, expectedAccount, { runner, cwd })
}

export function getLockedGhToken(expectedAccount, { runner = runCommand, cwd = process.cwd() } = {}) {
  const result = runner('gh', ['auth', 'token', '--hostname', GITHUB_HOST, '--user', expectedAccount], {
    cwd,
    env: storedGhEnvironment(),
  })
  if (result.error || result.status !== 0) {
    throw new IdentityError(`No authenticated gh token is available for ${expectedAccount}. Run \`gh auth login\` for that account without switching the machine-wide active account.`)
  }
  const token = result.stdout.trim()
  if (!token) throw new IdentityError(`gh returned an empty token for ${expectedAccount}.`)
  verifyTokenAccount(token, expectedAccount, { runner, cwd })
  return token
}

export function validateLocalIdentity({
  runner = runCommand,
  cwd = process.cwd(),
  remoteName,
} = {}) {
  const lock = readIdentityLock({ runner, cwd })
  if (!lock) throw new IdentityError('No repository identity lock exists. Run `pnpm identity:setup` in an interactive terminal first.')
  const expected = [
    ['user.name', lock.authorName, false],
    ['user.email', lock.authorEmail, false],
    ['credential.username', lock.account, true],
    [`credential.https://${GITHUB_HOST}.useHttpPath`, 'true', true],
  ]
  for (const [key, wanted, insensitive] of expected) {
    const actual = gitConfigGet(key, { runner, cwd })
    const matches = insensitive
      ? normalizeAccount(actual) === normalizeAccount(wanted)
      : actual === wanted
    if (!matches) throw new IdentityError(`Local Git config ${key} does not match the repository identity lock. Run \`pnpm identity:setup\` to repair it.`)
  }
  let push
  if (remoteName) {
    const result = runner('git', ['remote', 'get-url', '--push', remoteName], { cwd })
    push = { remoteName, remoteUrl: requireSuccess(result, `Resolving push URL for remote ${remoteName}`) }
  } else {
    push = resolvePushRemote({ runner, cwd })
  }
  const parsed = parseGithubHttpsUrl(push.remoteUrl)
  if (normalizeAccount(parsed.username) !== normalizeAccount(lock.account)) {
    throw new IdentityError(`The effective push URL must include the locked username ${lock.account}. Run \`pnpm identity:setup\` to repair it.`)
  }
  return { lock, ...push, remote: parsed }
}
