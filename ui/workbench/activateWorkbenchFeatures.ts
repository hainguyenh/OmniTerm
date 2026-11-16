import { diag } from '../diag'
import { activate as editor } from '../ide/editor/core'
import { activate as lsp } from '../ide/editor/lsp'
import { activate as agents } from '../ide/features/agents'
import { activate as build } from '../ide/features/build'
import { activate as codeInsight } from '../ide/features/code-insight'
import { activate as colorPreview } from '../ide/features/color-preview'
import { activate as debuggerFeature } from '../ide/features/debugger'
import { activate as dependencies } from '../ide/features/dependencies'
import { activate as dotnet } from '../ide/features/dotnet'
import { activate as mcp } from '../ide/features/mcp'
import { activate as plugins } from '../ide/features/plugins'
import { activate as projectTree } from '../ide/features/project-tree'
import { activate as projectTrust } from '../ide/features/project-trust'
import { activate as remoteDev } from '../ide/features/remote-dev'
import { activate as run } from '../ide/features/run'
import { activate as runAnything } from '../ide/features/run-anything'
import { activate as search } from '../ide/features/search'
import { activate as settings } from '../ide/features/settings'
import { activate as templates } from '../ide/features/templates'
import { activate as tools } from '../ide/features/tools'
import { activate as vcs } from '../ide/features/vcs'
import { activate as viewers } from '../ide/features/viewers'
import { activate as web } from '../ide/features/web'
import { installKeyboardDispatcher } from '../ide/platform/keymap'
import { activateWorkbench } from '../ide/workbench/activate'

import { activateAppFeature } from './appFeature'
import { activateOmniTermSettings } from './settings/activateOmniTermSettings'
import { registerDebuggerWorkbench } from './debugger/registerDebuggerWorkbench'
import { registerLspWorkbench } from './lsp/lspWorkbenchActions'
import { registerProjectTreeActions } from './projectTreeActions'
import { registerPreviewKinds } from './registerPreviewKinds'
import { registerRunWorkbench } from './run/registerRunWorkbench'
import { registerSessionKind } from './sessions/registerSessionKind'
import { registerShellToolWindows } from './registerShellToolWindows'
import { registerQuotaWorkbench } from './quota/registerQuotaWorkbench'
import { registerStatusBarWidgets } from './registerStatusBarWidgets'
import { registerTerminalToolWindow } from './terminalDock/registerTerminalToolWindow'
import { registerTitleControls } from './titleControls'
import { registerUpdaterWorkbench } from './updater/registerUpdaterWorkbench'

type Activate = () => void | (() => void)

/**
 * The IDE features the workbench mounts, in their activation order with OmniTerm's
 * adapters next to the feature they extend.
 *
 * Not mounted, on purpose:
 * - `welcome`, and the window/workspace half of `app`: OmniTerm's workspaces pick the project.
 * - `terminal`: OmniTerm's own sessions (persistent daemon, agents, Ctrl+C rules) are the terminal.
 * - `profiler`, `logcat`, `notebook`, `http-client`, `graphql`, `deployment`, `services`, `vim`,
 *   `perf`, `macros`, `coverage` and `database`: outside OmniTerm's scope (JVM, Android,
 *   notebooks, API clients, servers, databases). They stay in the repository, switched off here.
 * - `build-tools`: the Maven and Gradle tool windows; OmniTerm's projects are TS, .NET and Rust.
 *
 * Language servers are optional at run time: a server that is not installed leaves the editor
 * without language features, and the backend reports why.
 */
export const WORKBENCH_STEPS: ReadonlyArray<readonly [string, Activate]> = [
  ['shell', activateWorkbench],
  ['project-trust', projectTrust],
  ['session-tabs', registerSessionKind],
  ['title-controls', registerTitleControls],
  ['previews', registerPreviewKinds],
  ['editor', editor],
  // After the editor core, whose contribution registry the language features extend.
  ['lsp', lsp],
  ['lsp-workbench', registerLspWorkbench],
  ['mcp', mcp],
  ['app', activateAppFeature],
  ['project-tree', projectTree],
  ['project-tree-actions', registerProjectTreeActions],
  ['shell-tool-windows', registerShellToolWindows],
  ['terminal-tool-window', registerTerminalToolWindow],
  ['search', search],
  ['code-insight', codeInsight],
  ['dependencies', dependencies],
  ['vcs', vcs],
  ['run', run],
  ['run-workbench', registerRunWorkbench],
  ['dotnet', dotnet],
  ['run-anything', runAnything],
  ['debugger', debuggerFeature],
  ['debugger-workbench', registerDebuggerWorkbench],
  ['color-preview', colorPreview],
  ['build', build],
  ['templates', templates],
  ['settings', settings],
  ['omniterm-settings', activateOmniTermSettings],
  ['plugins', plugins],
  ['tools', tools],
  ['viewers', viewers],
  ['web', web],
  ['agents', agents],
  ['remote-dev', remoteDev],
  ['updater', registerUpdaterWorkbench],
  ['status-bar-widgets', registerStatusBarWidgets],
  ['agent-quota', registerQuotaWorkbench],
  // Last: features install capture-phase key handlers that must run before the global dispatcher.
  ['keyboard', () => installKeyboardDispatcher()],
]

type LoadActivate = () => Promise<Activate>

/**
 * Features loaded and activated after the shell has painted, one per idle period, so their module
 * graphs stay out of the startup bundle. Only features whose contributions may arrive late belong
 * here: no restorable editor kinds (a session saved before they register would drop those tabs)
 * and no capture-phase key handlers (they must be installed before the keyboard dispatcher).
 * Editor contributions may come late: open editors resync when the registry changes.
 */
export const DEFERRED_WORKBENCH_STEPS: ReadonlyArray<readonly [string, LoadActivate]> = [
  ['todo', () => import('../ide/features/todo').then((m) => m.activate)],
  ['scratch', () => import('../ide/features/scratch').then((m) => m.activate)],
  ['libraries', () => import('../ide/features/libraries').then((m) => m.activate)],
  ['analysis', () => import('../ide/features/analysis').then((m) => m.activate)],
  ['github', () => import('../ide/features/github').then((m) => m.activate)],
  ['ssh', () => import('../ide/features/ssh').then((m) => m.activate)],
]

/** Runs `task` when the browser is idle, or after a short timeout where idle callbacks are missing. */
export type ScheduleIdle = (task: () => void) => () => void

const DEFERRED_TIMEOUT_MS = 2000

const scheduleIdle: ScheduleIdle = (task) => {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: DEFERRED_TIMEOUT_MS })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = window.setTimeout(task, 0)
  return () => window.clearTimeout(handle)
}

function runStep(name: string, activate: Activate, disposers: Array<() => void>): void {
  try {
    const dispose = activate()
    if (dispose) disposers.push(dispose)
  } catch (error) {
    diag.error(`[workbench] feature "${name}" failed to activate`, error)
  }
}

/** Loads and activates `deferred` in order, one per idle period, until `isStopped` turns true. */
function runDeferred(
  deferred: typeof DEFERRED_WORKBENCH_STEPS,
  schedule: ScheduleIdle,
  disposers: Array<() => void>,
  isStopped: () => boolean,
): () => void {
  let cancel = () => {}
  const next = (index: number) => {
    const step = deferred[index]
    if (!step || isStopped()) return
    cancel = schedule(() => {
      const [name, load] = step
      load()
        .then((activate) => {
          if (!isStopped()) runStep(name, activate, disposers)
        })
        .catch((error: unknown) => diag.error(`[workbench] feature "${name}" failed to load`, error))
        .finally(() => next(index + 1))
    })
  }
  next(0)
  return () => cancel()
}

let active: { count: number; dispose: () => void } | null = null

/**
 * Activates the workbench once per window and hands back a release function. `steps` run now;
 * `deferred` (the window passes {@link DEFERRED_WORKBENCH_STEPS}) load after the shell has painted.
 * A feature that throws is skipped and reported; the others stay usable, because a broken tool
 * window must never take the terminals down with it.
 */
export function activateWorkbenchFeatures(
  steps: typeof WORKBENCH_STEPS = WORKBENCH_STEPS,
  deferred: typeof DEFERRED_WORKBENCH_STEPS = [],
  schedule: ScheduleIdle = scheduleIdle,
): () => void {
  if (!active) {
    const disposers: Array<() => void> = []
    for (const [name, activate] of steps) runStep(name, activate, disposers)
    let stopped = false
    const cancelDeferred = runDeferred(deferred, schedule, disposers, () => stopped)
    active = {
      count: 0,
      dispose: () => {
        stopped = true
        cancelDeferred()
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch (error) {
            diag.error('[workbench] a feature failed to deactivate', error)
          }
        }
      },
    }
  }
  const current = active
  current.count += 1
  let released = false
  return () => {
    if (released) return
    released = true
    current.count -= 1
    if (current.count === 0) {
      current.dispose()
      if (active === current) active = null
    }
  }
}
