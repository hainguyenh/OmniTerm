#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'

import {
  discoverAccounts,
  getLockedGhToken,
  IdentityError,
  normalizeAccount,
  readIdentityLock,
  resolvePushRemote,
  validateAuthor,
  verifyGitCredential,
  withGithubUsername,
  writeLocalIdentityConfig,
} from './github-identity-core.mjs'
import { isMain } from './is-main.mjs'

const writeLine = (output, value = '') => output.write(`${value}\n`)

export async function chooseAccount(accounts, ask, output) {
  if (accounts.length === 0) {
    throw new IdentityError('No GitHub accounts were found. Sign in with Git Credential Manager and `gh auth login`, then retry.')
  }
  writeLine(output, 'Available GitHub accounts:')
  accounts.forEach((account, index) => {
    const source = account.sources.join(' + ')
    const status = account.ghActive ? ', gh active' : ''
    writeLine(output, `  ${index + 1}. ${account.login} (${source}${status})`)
  })
  while (true) {
    const answer = (await ask('Choose an account by number or login: ')).trim()
    const numeric = Number.parseInt(answer, 10)
    const selected = Number.isInteger(numeric) && String(numeric) === answer
      ? accounts[numeric - 1]
      : accounts.find((account) => normalizeAccount(account.login) === normalizeAccount(answer))
    if (selected) return selected.login
    writeLine(output, 'Choose one of the accounts listed above.')
  }
}

async function promptAuthor(account, ask, output) {
  const defaultName = account
  const defaultEmail = `${account}@users.noreply.github.com`
  while (true) {
    const nameAnswer = await ask(`Commit author name [${defaultName}]: `)
    const emailAnswer = await ask(`Commit author email [${defaultEmail}]: `)
    try {
      return validateAuthor({
        authorName: nameAnswer.trim() || defaultName,
        authorEmail: emailAnswer.trim() || defaultEmail,
      })
    } catch (error) {
      writeLine(output, error instanceof Error ? error.message : String(error))
    }
  }
}

export async function runIdentitySetup({
  cwd = process.cwd(),
  input = process.stdin,
  output = process.stdout,
  interactive = Boolean(input.isTTY && output.isTTY),
  runner,
  ask: injectedAsk,
  discover = discoverAccounts,
  writeConfig = writeLocalIdentityConfig,
} = {}) {
  const commandOptions = { cwd, ...(runner ? { runner } : {}) }
  const existingLock = readIdentityLock(commandOptions)
  const push = resolvePushRemote(commandOptions)

  if (existingLock) {
    verifyGitCredential(push.remoteUrl, existingLock.account, commandOptions)
    getLockedGhToken(existingLock.account, commandOptions)
    writeConfig(existingLock, push.remoteName, push.remoteUrl, commandOptions)
    writeLine(output, `Identity lock verified for ${existingLock.account}; repository-local Git config is synchronized.`)
    return { changed: true, lock: existingLock, remoteName: push.remoteName }
  }

  if (!interactive && !injectedAsk) {
    throw new IdentityError('Identity setup requires an interactive TTY when no lock exists. No Git config was changed.')
  }

  let readline
  const ask = injectedAsk ?? (() => {
    readline = createInterface({ input, output })
    return (question) => readline.question(question)
  })()

  try {
    const accounts = discover(commandOptions)
    const account = await chooseAccount(accounts, ask, output)
    const author = await promptAuthor(account, ask, output)
    const lock = { account, ...author }

    writeLine(output, '')
    writeLine(output, `Verifying HTTPS and gh authentication for ${account}...`)
    verifyGitCredential(push.remoteUrl, account, commandOptions)
    getLockedGhToken(account, commandOptions)

    writeLine(output, '')
    writeLine(output, 'Repository-local identity preview:')
    writeLine(output, `  GitHub account: ${account}`)
    writeLine(output, `  Commit identity: ${author.authorName} <${author.authorEmail}>`)
    writeLine(output, `  Push remote: ${push.remoteName} -> ${withGithubUsername(push.remoteUrl, account)}`)
    writeLine(output, '  Scope: .git/config only; no token or secret will be stored')
    const confirmed = normalizeAccount(await ask('Apply this identity lock? [y/N]: '))
    if (!['y', 'yes'].includes(confirmed)) {
      writeLine(output, 'Identity setup cancelled. No Git config was changed.')
      return { changed: false, cancelled: true }
    }

    writeConfig(lock, push.remoteName, push.remoteUrl, commandOptions)
    writeLine(output, `Identity lock saved for ${account}.`)
    return { changed: true, lock, remoteName: push.remoteName }
  } finally {
    readline?.close()
  }
}

async function main() {
  try {
    await runIdentitySetup()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) await main()
