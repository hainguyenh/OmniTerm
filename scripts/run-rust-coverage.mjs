#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const rustRoot = path.join(root, 'src-tauri')
const outputDir = path.join(root, 'coverage-rust')

function run(args) {
  const result = spawnSync('cargo', args, { cwd: rustRoot, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`cargo ${args.join(' ')} failed with exit code ${result.status}`)
}

try {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  run(['llvm-cov', 'clean', '--workspace'])
  run(['llvm-cov', '--branch', '--no-report'])
  run(['llvm-cov', 'report', '--branch', '--json', '--summary-only', '--output-path', path.join(outputDir, 'coverage-summary.json')])
  run(['llvm-cov', 'report', '--branch', '--lcov', '--output-path', path.join(outputDir, 'lcov.info')])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
