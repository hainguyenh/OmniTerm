#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const outputDir = path.join(root, 'coverage-rust')

// Files excluded from the coverage gate entirely, not just under-counted.
//
// win_job.rs: a thin wrapper over raw Win32 Job Object calls (CreateJobObjectW,
// SetInformationJobObject, AssignProcessToJobObject). Its happy path already has a real test
// (assigns_job_and_terminates_process), but the error branches only fire on OS-level failures
// (a job handle the kernel refuses to create, a process already dead before it can be assigned)
// that cannot be triggered without mocking the Win32 API — there is nothing left to test.
//
// build.rs: a Cargo build script. It runs at compile time, not in the application, so no test can
// execute it and the coverage instrumentation never sees it run — every line reports as missed. Its
// only conditional is `CARGO_CFG_TARGET_OS != "windows"`, which the Linux coverage job takes and the
// Windows build does not; a test could not take the other arm without cross-compiling.
const IGNORED_FILENAME_REGEX = '(win_job|build)\\.rs$'
const COVERAGE_BUILD_FLAGS = ['--branch', '--no-cfg-coverage', '--no-cfg-coverage-nightly']

function run(args) {
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`cargo ${args.join(' ')} failed with exit code ${result.status}`)
}

try {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  run(['llvm-cov', 'clean', '--workspace'])
  run(['llvm-cov', ...COVERAGE_BUILD_FLAGS, '--no-report', '--workspace'])
  // Boot the real binary once under instrumentation so the JSON function metric covers the
  // binary-only Wry instantiations (main, run(), with_invoke_handler, and the generated wrapper of
  // every #[tauri::command]). --coverage-smoke makes run() exit 0 after setup. --no-clean keeps the
  // test run's profraws so the final report merges both; llvm-cov run requires a report when
  // --no-clean is set, so its stdout table is just discarded -- only coverage data is collected.
  run(['llvm-cov', 'run', ...COVERAGE_BUILD_FLAGS, '--no-clean', '--bin', 'omniterm', '--', '--coverage-smoke'])
  run(['llvm-cov', 'report', '--branch', '--ignore-filename-regex', IGNORED_FILENAME_REGEX, '--json', '--summary-only', '--output-path', path.join(outputDir, 'coverage-summary.json')])
  run(['llvm-cov', 'report', '--branch', '--ignore-filename-regex', IGNORED_FILENAME_REGEX, '--lcov', '--output-path', path.join(outputDir, 'lcov.info')])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
