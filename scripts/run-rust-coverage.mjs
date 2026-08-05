#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const rustRoot = path.join(root, 'src-tauri')
const outputDir = path.join(root, 'coverage-rust')

// Files excluded from the coverage gate entirely, not just under-counted.
//
// win_job.rs: a thin wrapper over raw Win32 Job Object calls (CreateJobObjectW,
// SetInformationJobObject, AssignProcessToJobObject). Its happy path already has a real test
// (assigns_job_and_terminates_process), but the error branches only fire on OS-level failures
// (a job handle the kernel refuses to create, a process already dead before it can be assigned)
// that cannot be triggered without mocking the Win32 API — there is nothing left to test.
const IGNORED_FILENAME_REGEX = 'win_job\\.rs$'

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
  run(['llvm-cov', 'report', '--branch', '--ignore-filename-regex', IGNORED_FILENAME_REGEX, '--json', '--summary-only', '--output-path', path.join(outputDir, 'coverage-summary.json')])
  run(['llvm-cov', 'report', '--branch', '--ignore-filename-regex', IGNORED_FILENAME_REGEX, '--lcov', '--output-path', path.join(outputDir, 'lcov.info')])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
