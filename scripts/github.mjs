#!/usr/bin/env node

import {
  getLockedGhToken,
  GITHUB_HOST,
  IdentityError,
  runCommand,
  validateLocalIdentity,
} from './github-identity-core.mjs'
import { isMain } from './is-main.mjs'

export function sanitizeGhArgs(inputArgs) {
  const args = inputArgs[0] === '--' ? inputArgs.slice(1) : [...inputArgs]
  if (args.length === 0) throw new IdentityError('Usage: pnpm github -- <gh args>')
  const lowered = args.map((arg) => arg.toLowerCase())
  if (lowered[0] === 'auth' && lowered[1] === 'token') {
    throw new IdentityError('The guarded GitHub wrapper never prints authentication tokens.')
  }
  if (lowered[0] === 'auth' && lowered[1] === 'status' && lowered.some((arg) => ['-t', '--show-token'].includes(arg))) {
    throw new IdentityError('The guarded GitHub wrapper never prints authentication tokens.')
  }
  return args
}

function lockedEnvironment(token) {
  const env = { ...process.env, GH_HOST: GITHUB_HOST, GH_TOKEN: token, GH_PROMPT_DISABLED: '1' }
  delete env.GITHUB_TOKEN
  delete env.GH_ENTERPRISE_TOKEN
  delete env.GITHUB_ENTERPRISE_TOKEN
  return env
}

export function runGithub(inputArgs, {
  runner = runCommand,
  cwd = process.cwd(),
} = {}) {
  const args = sanitizeGhArgs(inputArgs)
  const { lock } = validateLocalIdentity({ runner, cwd })
  const token = getLockedGhToken(lock.account, { runner, cwd })
  const result = runner('gh', args, {
    cwd,
    env: lockedEnvironment(token),
    stdio: 'inherit',
  })
  if (result.error) throw new IdentityError(`Could not start gh: ${result.error.message}`)
  return result.status ?? 1
}

function main() {
  try {
    process.exitCode = runGithub(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) main()
