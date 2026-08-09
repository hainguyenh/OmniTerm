#!/usr/bin/env node

import { readFileSync } from 'node:fs'

import {
  IdentityError,
  runCommand,
  validateLocalIdentity,
  verifyGitCredential,
} from './github-identity-core.mjs'
import { isMain } from './is-main.mjs'

const AI_IDENTITY = String.raw`(?:AI|ChatGPT|OpenAI(?:\s+Codex)?|Codex(?:\s+CLI)?|(?:GitHub\s+)?Copilot|Claude(?:\s+Code)?|Anthropic(?:\s+Claude)?|(?:Google\s+)?Gemini|GPT(?:-?\d+(?:\.\d+)?)?|Cursor|Windsurf)`
const DISCLOSURE_PATTERNS = [
  new RegExp(String.raw`^(?:this\s+)?(?:commit|change|patch)\s+(?:was\s+)?(?:generated|written|authored|created|produced|assisted)\s+(?:by|with|using)\s+(?:an?\s+)?${AI_IDENTITY}[.!]?$`, 'i'),
  new RegExp(String.raw`^(?:generated|written|authored|created|produced|assisted)\s+(?:by|with|using)\s+(?:an?\s+)?${AI_IDENTITY}[.!]?$`, 'i'),
  new RegExp(String.raw`^(?:I|we)\s+used\s+${AI_IDENTITY}\s+to\s+(?:write|generate|author|create|produce)\s+(?:this\s+)?(?:commit|change|patch)[.!]?$`, 'i'),
  new RegExp(String.raw`^${AI_IDENTITY}[- ](?:generated|assisted)\s+(?:commit|change|patch)[.!]?$`, 'i'),
]
const AI_ATTRIBUTION = new RegExp(String.raw`\b${AI_IDENTITY}\b`, 'i')

export function commitMessageViolations(message) {
  const violations = []
  const normalized = String(message ?? '').replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (/^(?:generated-by|assisted-by)\s*:/i.test(line)) {
      violations.push('Generated-by and Assisted-by trailers are not allowed.')
      continue
    }
    const coauthor = line.match(/^co-authored-by\s*:\s*(.+)$/i)
    if (coauthor && AI_ATTRIBUTION.test(coauthor[1])) {
      violations.push('AI co-author attribution is not allowed.')
      continue
    }
    if (DISCLOSURE_PATTERNS.some((pattern) => pattern.test(line))) {
      violations.push('Commit messages must not describe the commit as AI-generated or AI-assisted.')
    }
  }
  const paragraphs = normalized.split(/\n\s*\n/).map((paragraph) => paragraph
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join(' '))
  if (paragraphs.some((paragraph) => DISCLOSURE_PATTERNS.some((pattern) => pattern.test(paragraph)))) {
    violations.push('Commit messages must not describe the commit as AI-generated or AI-assisted.')
  }
  return [...new Set(violations)]
}

export function validateCommitMessage(message) {
  const violations = commitMessageViolations(message)
  if (violations.length > 0) {
    throw new IdentityError(`Commit message rejected:\n${violations.map((item) => `  - ${item}`).join('\n')}`)
  }
}

export function parseGitIdent(value) {
  const match = String(value ?? '').trim().match(/^(.*) <([^<>]+)> \d+ [+-]\d{4}$/)
  if (!match) throw new IdentityError('Git returned an invalid effective identity.')
  return { name: match[1], email: match[2] }
}

function sameIdentity(actual, lock) {
  return actual.name === lock.authorName && actual.email === lock.authorEmail
}

export function validateEffectiveIdentities({ author, committer }, lock) {
  const failures = []
  if (!sameIdentity(author, lock)) failures.push(`author is ${author.name} <${author.email}>`)
  if (!sameIdentity(committer, lock)) failures.push(`committer is ${committer.name} <${committer.email}>`)
  if (failures.length > 0) {
    throw new IdentityError(`Effective Git identity does not match the repository lock (${lock.authorName} <${lock.authorEmail}>): ${failures.join('; ')}.`)
  }
}

export function validateOutgoingCommit(commit, lock) {
  const committer = { name: commit.committerName, email: commit.committerEmail }
  if (!sameIdentity(committer, lock)) {
    throw new IdentityError(`Outgoing commit ${commit.sha} has committer ${committer.name} <${committer.email}> instead of the locked committer ${lock.authorName} <${lock.authorEmail}>.`)
  }
  const author = { name: commit.authorName, email: commit.authorEmail }
  return { preservedAuthor: !sameIdentity(author, lock) }
}

export function parsePushUpdates(input) {
  const updates = []
  for (const line of String(input ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 4 || !/^[0-9a-f]{40,64}$/i.test(fields[1]) || !/^[0-9a-f]{40,64}$/i.test(fields[3])) {
      throw new IdentityError('Git supplied an invalid pre-push ref update.')
    }
    updates.push({ localRef: fields[0], localSha: fields[1], remoteRef: fields[2], remoteSha: fields[3] })
  }
  return updates
}

const isZeroSha = (sha) => /^0+$/.test(sha)

function requireGit(runner, args, cwd, label) {
  const result = runner('git', args, { cwd })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim()
    throw new IdentityError(`${label} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout.trim()
}

export function listOutgoingCommits(updates, remoteName, {
  runner = runCommand,
  cwd = process.cwd(),
} = {}) {
  const commits = new Set()
  for (const update of updates) {
    if (isZeroSha(update.localSha)) continue
    const args = ['rev-list', update.localSha, '--not']
    if (!isZeroSha(update.remoteSha)) {
      const exists = runner('git', ['cat-file', '-e', `${update.remoteSha}^{commit}`], { cwd })
      if (!exists.error && exists.status === 0) args.push(update.remoteSha)
    }
    args.push(`--remotes=${remoteName}`)
    const output = requireGit(runner, args, cwd, `Finding local-only commits for ${update.localRef}`)
    for (const sha of output.split(/\r?\n/).filter(Boolean)) commits.add(sha)
  }
  return [...commits]
}

function readCommit(sha, { runner, cwd }) {
  const identity = requireGit(
    runner,
    ['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce', sha],
    cwd,
    `Reading identity for outgoing commit ${sha}`,
  ).split('\0')
  if (identity.length !== 4 || identity.some((value) => !value)) {
    throw new IdentityError(`Outgoing commit ${sha} has invalid author or committer metadata.`)
  }
  const message = requireGit(runner, ['show', '-s', '--format=%B', sha], cwd, `Reading message for outgoing commit ${sha}`)
  return {
    sha,
    authorName: identity[0],
    authorEmail: identity[1],
    committerName: identity[2],
    committerEmail: identity[3],
    message,
  }
}

export function runPreCommit({ runner = runCommand, cwd = process.cwd() } = {}) {
  const { lock } = validateLocalIdentity({ runner, cwd })
  const author = parseGitIdent(requireGit(runner, ['var', 'GIT_AUTHOR_IDENT'], cwd, 'Resolving effective Git author'))
  const committer = parseGitIdent(requireGit(runner, ['var', 'GIT_COMMITTER_IDENT'], cwd, 'Resolving effective Git committer'))
  validateEffectiveIdentities({ author, committer }, lock)
}

export function runCommitMsg(messagePath) {
  if (!messagePath) throw new IdentityError('commit-msg hook did not receive a message file path.')
  validateCommitMessage(readFileSync(messagePath, 'utf8'))
}

export function runPrePush(remoteName, remoteUrl, input, {
  runner = runCommand,
  cwd = process.cwd(),
} = {}) {
  if (!remoteName || !remoteUrl) throw new IdentityError('pre-push hook did not receive a remote name and URL.')
  const identity = validateLocalIdentity({ runner, cwd, remoteName })
  verifyGitCredential(identity.remoteUrl, identity.lock.account, { runner, cwd })
  const commits = listOutgoingCommits(parsePushUpdates(input), remoteName, { runner, cwd })
  for (const sha of commits) {
    const commit = readCommit(sha, { runner, cwd })
    validateOutgoingCommit(commit, identity.lock)
    try {
      validateCommitMessage(commit.message)
    } catch (error) {
      throw new IdentityError(`Outgoing commit ${sha} violates commit-message policy. ${error.message}`)
    }
  }
  return { account: identity.lock.account, commitsChecked: commits.length }
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === 'pre-commit') runPreCommit()
    else if (command === 'commit-msg') runCommitMsg(args[0])
    else if (command === 'pre-push') runPrePush(args[0], args[1], readFileSync(0, 'utf8'))
    else throw new IdentityError(`Unknown identity guard command: ${command || '(missing)'}`)
  } catch (error) {
    console.error(`IDENTITY GUARD BLOCKED: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) main()
