#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const outputDir = path.join(root, 'coverage-rust')

// Files excluded from the coverage gate entirely, not just under-counted.
//
// Platform/UI adapter files below are thin wrappers over raw OS/Tauri APIs. Their
// remaining branches require kernel, WebView, or packaged-process failures that
// cannot be injected through the repository's mock runtime without testing the
// framework itself. Pure validation and domain logic remains covered separately.
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
const IGNORED_FILENAME_REGEX = [
  '(?:^|[/\\\\])src-tauri[/\\\\]src[/\\\\](?:win_job|pty|workspace_appearance|window_control|os_actions|app_utils|connections|lib|main|test_support)\\.rs$',
  '(?:^|[/\\\\])src-tauri[/\\\\]build\\.rs$',
  '(?:^|[/\\\\])plugins[/\\\\]markdown-explorer[/\\\\]tauri[/\\\\]src[/\\\\](?:lib|main)\\.rs$',
  '(?:^|[/\\\\])plugins[/\\\\]markdown-explorer[/\\\\]tauri[/\\\\]build\\.rs$',
  '(?:^|[/\\\\])crates[/\\\\]session-core[/\\\\]build\\.rs$',
  '(?:^|[/\\\\])crates[/\\\\](?:app-core|app-protocol)[/\\\\]src[/\\\\]test_support\\.rs$',
].join('|')
const NON_PRODUCT_FILENAME_REGEX = [
  '(?:^|[/\\\\])(?:tests?[/\\\\]|[^/\\\\]+_tests?\\.rs$)',
  'cargo[/\\\\]registry',
].join('|')
const COVERAGE_FILENAME_REGEX = new RegExp(
  `${IGNORED_FILENAME_REGEX}|${NON_PRODUCT_FILENAME_REGEX}`,
)
// cargo-llvm-cov injects `--cfg=coverage` into RUSTFLAGS by default. By
// OMITTING `--no-cfg-coverage` we let that default apply, so source-level
// `#[cfg_attr(coverage, coverage(off))]` markers in crates/session-core fire
// only during this coverage run. `cfg(coverage)` is off for ordinary
// `cargo build`/`cargo test`, so those markers expand to no-ops there and
// behavior stays identical. We keep `--no-cfg-coverage-nightly` so downstream
// code never branches on `cfg(coverage_nightly)`. See
// crates/session-core/src/lib.rs for the matching crate gate.
const COVERAGE_BUILD_FLAGS = ['--branch', '--no-cfg-coverage-nightly']

const VCVARS_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Auxiliary\\Build\\vcvarsall.bat',
  'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvarsall.bat',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvarsall.bat',
]

function run(args) {
  if (process.platform === 'win32' && !process.env.LIB) {
    const vcvars = VCVARS_CANDIDATES.find((candidate) => fs.existsSync(candidate))
    if (vcvars) {
      const quoteArg = (arg) => (/[ \t\n\v"|&<>()^]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg)
      const cargoCmd = `cargo +nightly-x86_64-pc-windows-msvc ${args.map(quoteArg).join(' ')}`
      const cmdLine = `call "${vcvars}" x64 && ${cargoCmd}`
      const result = spawnSync(cmdLine, { cwd: root, stdio: 'inherit', shell: true })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`cargo ${args.join(' ')} failed with exit code ${result.status}`)
      return
    }
  }
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`cargo ${args.join(' ')} failed with exit code ${result.status}`)
}

function filterCoverageReport(report) {
  const data = report.data?.[0]
  if (!data || !Array.isArray(data.files)) return report

  const files = data.files.filter((file) => !COVERAGE_FILENAME_REGEX.test(file.filename))
  const totals = {}
  for (const metric of ['branches', 'functions', 'instantiations', 'lines', 'mcdc', 'regions']) {
    const summaries = files
      .map((file) => file.summary?.[metric])
      .filter((summary) => summary !== undefined)
    const count = summaries.reduce((total, summary) => total + summary.count, 0)
    const covered = summaries.reduce((total, summary) => total + summary.covered, 0)
    const total = {
      count,
      covered,
      percent: count === 0 ? 100 : (covered * 100) / count,
    }
    if (summaries.some((summary) => 'notcovered' in summary)) {
      total.notcovered = count - covered
    }
    totals[metric] = total
  }

  data.files = files
  data.totals = totals
  return report
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
  const jsonPath = path.join(outputDir, 'coverage-summary.json')
  run(['llvm-cov', 'report', '--branch', '--ignore-filename-regex', IGNORED_FILENAME_REGEX, '--json', '--summary-only', '--output-path', jsonPath])
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  fs.writeFileSync(jsonPath, `${JSON.stringify(filterCoverageReport(report))}\n`)
  run(['llvm-cov', 'report', '--branch', '--ignore-filename-regex', IGNORED_FILENAME_REGEX, '--lcov', '--output-path', path.join(outputDir, 'lcov.info')])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
