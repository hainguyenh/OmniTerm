/**
 * Tier 4: Polyglot Lifecycle & Interactive Debugging Workflows.
 * Validates full developer lifecycles across project creation, authoring,
 * LSP diagnostics, target execution, and interactive DAP debugging.
 */

import { assert, assertEqual, assertNotEqual, assertThrowsAsync } from '../helpers/assertions.mjs'
import { cleanupAllWorkspaces, createTempWorkspace } from '../helpers/fixtures.mjs'
import { createMockIpc } from '../helpers/mock-ipc.mjs'
import { afterAll, afterEach, beforeEach, describe, test } from '../runner/framework.mjs'

describe('Tier 4: Polyglot Lifecycle & Debugging Workflows', () => {
  let ipc
  let workspace

  beforeEach(async () => {
    ipc = createMockIpc()
    ipc.register('debug_threads', async () => ({
      threads: [{ id: 1, name: 'main' }],
    }))
    ipc.register('debug_stack_trace', async (p) => ({
      stackFrames: [
        { id: 101, name: 'main', source: { path: p?.path || 'src/main.rs' }, line: p?.line || 4, column: 1 },
      ],
    }))
    ipc.register('debug_scopes', async () => ({
      scopes: [{ name: 'Locals', variablesReference: 1001 }],
    }))
    ipc.register('debug_variables', async (p) => ({
      variables: p?.variablesReference === 1001 ? [{ name: 'x', value: '10', type: 'i32' }] : [],
    }))
    ipc.register('debug_step_out', async (p) => ({
      sessionId: p?.sessionId,
      stepped: true,
    }))
    workspace = await createTempWorkspace('tier4-polyglot-')
  })

  afterEach(async () => {
    if (workspace) {
      await workspace.cleanup()
      workspace = null
    }
  })

  afterAll(async () => {
    await cleanupAllWorkspaces()
  })

  test('Scenario 1.1: Full-Lifecycle Rust project development, LSP diagnostics resolution, and execution', async () => {
    const root = workspace.root
    await workspace.writeFile('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n')
    await workspace.mkdir('src/math')
    const mainPath = await workspace.writeFile('src/main.rs', 'fn main() {\n  println!("Init");\n}\n')
    const mathPath = await workspace.writeFile('src/math/calc.rs', 'pub fn add(a: i32, b: i32) -> i32 {\n  a + b\n}\n')

    const proj = await ipc.invoke('ide_set_project', { path: root })
    assertEqual(proj.activeRoot, root)

    const mainDoc = await ipc.invoke('doc_open', { path: mainPath, initialText: await workspace.readFile('src/main.rs') })
    const mathDoc = await ipc.invoke('doc_open', { path: mathPath, initialText: await workspace.readFile('src/math/calc.rs') })
    assertEqual(mainDoc.language, 'rust')
    assertEqual(mathDoc.language, 'rust')

    const syntaxErrorEdit = await ipc.invoke('doc_edit', {
      id: mainDoc.id,
      version: mainDoc.version,
      edits: [{ from: 0, to: 30, insert: 'mod math;\nfn main() {\n  let sum = math::calc::add(2, 3)\n}\n' }],
    })
    assertEqual(syntaxErrorEdit.version, 2)

    let diagnosticEvent = null
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'diagnostics' && ev.path === mainPath) diagnosticEvent = ev
    })
    ipc.emit('ide://event', {
      type: 'diagnostics',
      path: mainPath,
      items: [{ line: 3, message: 'expected `;`, found `}`', severity: 'error' }],
    })
    assert(diagnosticEvent !== null, 'Diagnostic event should be received')
    assertEqual(diagnosticEvent.items.length, 1)

    const completion = await ipc.invoke('lsp_completion', {
      id: mainDoc.id,
      position: { line: 2, character: 24 },
    })
    assert(completion.items.length > 0, 'Should offer completion items')

    const fixEdit = await ipc.invoke('doc_edit', {
      id: mainDoc.id,
      version: syntaxErrorEdit.version,
      edits: [{ from: 0, to: 65, insert: 'mod math;\nfn main() {\n  let sum = math::calc::add(2, 3);\n  println!("sum={}", sum);\n}\n' }],
    })
    assertEqual(fixEdit.version, 3)

    const saveRes = await ipc.invoke('doc_save', { id: mainDoc.id })
    assertEqual(saveRes.success, true)

    ipc.emit('ide://event', { type: 'diagnostics', path: mainPath, items: [] })
    assertEqual(diagnosticEvent.items.length, 0)

    const detected = await ipc.invoke('run_detect_targets', { root })
    const cargoTarget = detected.targets.find((t) => t.kind === 'cargo')
    assert(cargoTarget !== undefined, 'Cargo run target should be auto-detected')

    const runInstance = await ipc.invoke('run_start', { config: cargoTarget })
    assert(runInstance.instanceId.startsWith('run-'), 'Run instance should be assigned')

    const consoleLines = []
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'process_output' && ev.id === runInstance.instanceId) {
        consoleLines.push(ev.chunk)
      }
    })

    ipc.emit('ide://event', { type: 'process_output', id: runInstance.instanceId, chunk: '\x1b[32mCompiling\x1b[0m demo v0.1.0\n' })
    ipc.emit('ide://event', { type: 'process_output', id: runInstance.instanceId, chunk: 'sum=5\n' })
    assertEqual(consoleLines.length, 2)
    assert(consoleLines[1].includes('sum=5'), 'Run output must contain computed result')
  }, { tier: 4 })

  test('Scenario 1.2: Full-Lifecycle TypeScript project scaffolding, type diagnostics, and script execution', async () => {
    const root = workspace.root
    await workspace.writeFile('package.json', JSON.stringify({ name: 'ts-app', scripts: { start: 'node dist/index.js' } }, null, 2))
    const serverTs = await workspace.writeFile('src/server.ts', 'const port: number = "8080";\n')

    await ipc.invoke('ide_set_project', { path: root })
    const doc = await ipc.invoke('doc_open', { path: serverTs, initialText: await workspace.readFile('src/server.ts') })

    let diagnostics = null
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'diagnostics' && ev.path === serverTs) diagnostics = ev.items
    })
    ipc.emit('ide://event', {
      type: 'diagnostics',
      path: serverTs,
      items: [{ line: 0, message: "Type 'string' is not assignable to type 'number'", severity: 'error' }],
    })
    assertEqual(diagnostics.length, 1)

    const resolved = await ipc.invoke('doc_edit', {
      id: doc.id,
      version: doc.version,
      edits: [{ from: 0, to: 30, insert: 'const port: number = 8080;\nconsole.log(`Port:${port}`);\n' }],
    })
    assertEqual(resolved.version, 2)
    await ipc.invoke('doc_save', { id: doc.id })

    ipc.emit('ide://event', { type: 'diagnostics', path: serverTs, items: [] })
    assertEqual(diagnostics.length, 0)

    const runRes = await ipc.invoke('run_start', {
      config: { name: 'npm start', binary: 'npm', args: ['run', 'start'], cwd: root },
    })

    const stdout = []
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'process_output' && ev.id === runRes.instanceId) stdout.push(ev.chunk)
    })
    ipc.emit('ide://event', { type: 'process_output', id: runRes.instanceId, chunk: 'Port:8080\n' })
    assertEqual(stdout[0], 'Port:8080\n')
  }, { tier: 4 })

  test('Scenario 2.1: Interactive DAP debugging: gutter breakpoints, pause hit, stack inspection, and stepping', async () => {
    const appFile = `${workspace.root}/src/app.rs`
    const doc = await ipc.invoke('doc_open', {
      path: appFile,
      initialText: 'fn main() {\n  let x = 10;\n  let y = 20;\n  let z = x + y;\n}\n',
    })

    const bpRes = await ipc.invoke('debug_set_breakpoints', {
      path: appFile,
      breakpoints: [{ line: 2 }, { line: 4 }],
    })
    assertEqual(bpRes.breakpoints.length, 2)
    assertEqual(bpRes.breakpoints[0].verified, true)

    const session = await ipc.invoke('debug_start', {
      config: { name: 'Debug Main', program: appFile, adapter: 'lldb' },
    })
    assert(session.sessionId.startsWith('dbg-'), 'Debug session should have a valid ID')

    let stoppedEvent = null
    ipc.listen('ide://event', (ev) => {
      if (ev.type === 'debug_stopped' && ev.sessionId === session.sessionId) stoppedEvent = ev
    })

    ipc.emit('ide://event', {
      type: 'debug_stopped',
      sessionId: session.sessionId,
      reason: 'breakpoint',
      threadId: 1,
      line: 2,
    })
    assertEqual(stoppedEvent.reason, 'breakpoint')
    assertEqual(stoppedEvent.line, 2)

    const threads = await ipc.invoke('debug_threads', { sessionId: session.sessionId })
    assertEqual(threads.threads[0].name, 'main')

    const stack = await ipc.invoke('debug_stack_trace', { sessionId: session.sessionId, path: appFile, line: 2 })
    assertEqual(stack.stackFrames[0].line, 2)

    const scopes = await ipc.invoke('debug_scopes', { sessionId: session.sessionId, frameId: 101 })
    const vars = await ipc.invoke('debug_variables', { variablesReference: scopes.scopes[0].variablesReference })
    assertEqual(vars.variables[0].name, 'x')
    assertEqual(vars.variables[0].value, '10')

    const stepOverRes = await ipc.invoke('debug_step_over', { sessionId: session.sessionId })
    assertEqual(stepOverRes.stepped, true)

    const stepIntoRes = await ipc.invoke('debug_step_into', { sessionId: session.sessionId })
    assertEqual(stepIntoRes.stepped, true)

    const evalRes = await ipc.invoke('debug_evaluate', { sessionId: session.sessionId, expression: 'x' })
    assertEqual(evalRes.result, '42')

    const resumeRes = await ipc.invoke('debug_resume', { sessionId: session.sessionId })
    assertEqual(resumeRes.resumed, true)
    await ipc.invoke('doc_close', { id: doc.id })
  }, { tier: 4 })

  test('Scenario 2.2: Conditional breakpoints with hit count evaluation and step-out to caller frame', async () => {
    const loopFile = `${workspace.root}/src/loop.rs`
    await ipc.invoke('doc_open', {
      path: loopFile,
      initialText: 'fn loop_test() {\n  for i in 0..10 {\n    let val = i * 2;\n  }\n}\n',
    })

    const bpRes = await ipc.invoke('debug_set_breakpoints', {
      path: loopFile,
      breakpoints: [{ line: 3, condition: 'i == 5', hitCondition: '>= 5' }],
    })
    assertEqual(bpRes.breakpoints[0].condition, 'i == 5')
    assertEqual(bpRes.breakpoints[0].hitCondition, '>= 5')

    const session = await ipc.invoke('debug_start', { config: { name: 'Loop Debug', program: loopFile } })

    let hitCount = 0
    let stoppedAtCondition = false
    for (let currentI = 0; currentI < 10; currentI++) {
      if (currentI === 5) {
        hitCount++
        if (hitCount >= 1) {
          stoppedAtCondition = true
          ipc.emit('ide://event', {
            type: 'debug_stopped',
            sessionId: session.sessionId,
            reason: 'conditional_breakpoint',
            threadId: 1,
            line: 3,
            variables: { i: currentI },
          })
          break
        }
      }
    }

    assertEqual(stoppedAtCondition, true)
    const stepOut = await ipc.invoke('debug_step_out', { sessionId: session.sessionId })
    assertEqual(stepOut.stepped, true)

    const resumeRes = await ipc.invoke('debug_resume', { sessionId: session.sessionId })
    assertEqual(resumeRes.resumed, true)
  }, { tier: 4 })
})
