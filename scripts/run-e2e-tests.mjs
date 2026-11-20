#!/usr/bin/env node
/**
 * Opaque-box E2E Test Runner for OmniTerm IDE Port.
 * Discovers and executes all E2E test suites with tier filtering and structured reporting.
 */

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runTests } from '../tests/e2e/runner/framework.mjs'
import { ConsoleReporter } from '../tests/e2e/runner/reporter.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const E2E_DIR = path.join(REPO_ROOT, 'tests', 'e2e')

function parseArgs(args) {
  const options = {
    tier: 'all',
    filter: null,
    verbose: false,
    help: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true
    } else if (arg === '--tier') {
      options.tier = args[++i] || 'all'
    } else if (arg.startsWith('--tier=')) {
      options.tier = arg.split('=')[1] || 'all'
    } else if (arg === '--filter' || arg === '--grep') {
      options.filter = args[++i] || null
    } else if (arg.startsWith('--filter=')) {
      options.filter = arg.split('=')[1] || null
    } else if (arg.startsWith('--grep=')) {
      options.filter = arg.split('=')[1] || null
    }
  }

  return options
}

function printUsage() {
  console.log(`
OmniTerm E2E Test Runner

Usage:
  node scripts/run-e2e-tests.mjs [options]

Options:
  --tier <1|2|3|4|all>   Execute tests from a specific tier (default: all)
  --filter <pattern>     Filter tests by suite or test name regex
  --grep <pattern>       Alias for --filter
  --verbose, -v          Show detailed test and skip information
  --help, -h             Display this help message
`)
}

async function findTestFiles(dir) {
  const files = []

  async function scan(currentDir) {
    let entries = []
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await scan(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        files.push(fullPath)
      }
    }
  }

  await scan(dir)
  return files.sort()
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)

  if (options.help) {
    printUsage()
    return 0
  }

  console.log('='.repeat(60))
  console.log(' OmniTerm IDE E2E Test Runner')
  console.log(` Target Tier: ${options.tier.toUpperCase()}`)
  if (options.filter) console.log(` Filter:      ${options.filter}`)
  console.log('='.repeat(60))

  const testFiles = await findTestFiles(E2E_DIR)

  if (testFiles.length === 0) {
    console.warn(`No test files found under ${E2E_DIR}`)
    return 0
  }

  // Load all test files into test framework context
  for (const file of testFiles) {
    const fileUrl = pathToFileURL(file).href
    try {
      await import(fileUrl)
    } catch (err) {
      console.error(`Failed to load test suite ${file}:`, err)
      return 1
    }
  }

  const reporter = new ConsoleReporter({ verbose: options.verbose })
  const results = await runTests({
    tier: options.tier,
    filter: options.filter,
    reporter,
  })

  return results.failed > 0 ? 1 : 0
}

// Auto-run if executed as CLI entry point
const isCli =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase()

if (isCli) {
  main()
    .then((exitCode) => process.exit(exitCode))
    .catch((err) => {
      console.error('Fatal error in E2E test runner:', err)
      process.exit(1)
    })
}
