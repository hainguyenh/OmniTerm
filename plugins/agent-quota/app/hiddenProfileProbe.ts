/**
 * Quota for profiles that have no open pane, read the way a user would: in a terminal no one sees
 * (ui/utils/hiddenTerminal.ts), started in a scratch folder, each profile's launcher is run in
 * turn — its folder-trust dialog is answered, `/usage` is typed and its panel read, and `/exit`
 * hands the shell back for the next profile. The terminal closes when the last one is done.
 *
 * `claude -p /usage` cannot stand in for this: a profile with no 5-hour session running answers
 * it without the limits panel, while the interactive `/usage` always draws it.
 */
import type { AgentKind, QuotaSnapshot } from '../src/types'
import type { HiddenTerminal } from '../../../ui/utils/hiddenTerminal'
import type { DriveIO, OutputWatch } from './usageProbeCore'

import { openHiddenTerminal } from '../../../ui/utils/hiddenTerminal'
import { AGENT_PROBES, isBlockingScreen, isTrustScreen, settleAndTrust, submitAndRead, SUBMIT_DELAY_MS, waitForQuiet } from './usageProbeCore'

export interface HiddenProbeTarget {
  key: string
  agent: AgentKind
  profileDir: string | null
  launcher: string | null
}

export interface HiddenProbeDeps {
  /** The scratch folder to start agents in; null when the sidecar cannot provide one. */
  probeDir(): Promise<string | null>
  open(cwd: string | null): Promise<HiddenTerminal | null>
  now(): number
  sleep(ms: number): Promise<void>
}

const SHELL_QUIET_MS = 800
const SHELL_READY_MS = 10_000
/** An agent has drawn its first screen once it has printed and then stayed quiet this long. */
const AGENT_QUIET_MS = 1_500
const AGENT_START_MS = 30_000
const EXIT_QUIET_MS = 1_000
const EXIT_MAX_MS = 10_000
const SHELL_PROMPT = /^(?:PS [^>]*>|[A-Za-z]:\\[^>]*>|.*[$#%])\s*$/
/** Mirrors `DEFAULT_PROFILE_DIR` in profileKey.ts: the default profile starts with the bare agent. */
const DEFAULT_DIR: Record<AgentKind, string> = { claude: '.claude', codex: '.codex', agy: '.gemini' }
const PROFILE_ENV: Record<AgentKind, string> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME', agy: 'AGY_HOME' }

function isWindowsPlatform(): boolean {
  if (typeof navigator !== 'undefined') {
    return navigator.userAgent.includes('Windows') || (navigator as { platform?: string }).platform?.startsWith('Win') === true
  }
  if (typeof process !== 'undefined') {
    return process.platform === 'win32'
  }
  return true
}

const AGENTS: readonly string[] = ['claude', 'codex', 'agy']

/** What to type to start this profile. */
export function launchCommandFor(target: HiddenProbeTarget): string | null {
  if (!AGENTS.includes(target.agent)) return null
  if (target.launcher) return target.launcher
  if (!target.profileDir) return target.agent
  const dir = target.profileDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  if (dir === DEFAULT_DIR[target.agent]) return target.agent
  const variable = PROFILE_ENV[target.agent]
  if (!variable) return null
  return isWindowsPlatform()
    ? `$env:${variable}='${target.profileDir}'; ${target.agent}`
    : `${variable}='${target.profileDir}' ${target.agent}`
}

const errorSnapshot = (now: number, error: QuotaSnapshot['error'], message: string): QuotaSnapshot =>
  ({ windows: [], fetchedAt: now, error, message })

function lastLine(screen: readonly string[]): string {
  for (let i = screen.length - 1; i >= 0; i -= 1) {
    if (screen[i].trim()) return screen[i]
  }
  return ''
}

/**
 * Until the agent has drawn its first screen (or asks about trusting the folder). While it loads,
 * the screen still ends on the echoed launch line; back at a bare shell prompt, it never started.
 */
async function waitForAgent(
  deps: HiddenProbeDeps,
  term: HiddenTerminal,
  watch: OutputWatch,
  command: string,
): Promise<'ready' | 'shell' | 'timeout'> {
  const start = deps.now()
  while (deps.now() - start < AGENT_START_MS) {
    const screen = term.screen()
    if (isTrustScreen(screen)) return 'ready'
    const last = lastLine(screen).trimEnd()
    if (watch.text && deps.now() - watch.lastAt >= AGENT_QUIET_MS && !last.endsWith(command)) {
      return SHELL_PROMPT.test(last) ? 'shell' : 'ready'
    }
    await deps.sleep(100)
  }
  return 'timeout'
}

/** Leave the agent and wait for the shell prompt; a stuck agent is interrupted twice. */
async function exitAgent(io: DriveIO, deps: HiddenProbeDeps, term: HiddenTerminal, watch: OutputWatch): Promise<void> {
  io.send('', '/exit')
  await deps.sleep(SUBMIT_DELAY_MS)
  io.send('', '\r')
  await waitForQuiet(io, watch, EXIT_QUIET_MS, EXIT_MAX_MS)
  if (SHELL_PROMPT.test(lastLine(term.screen()))) return
  io.send('', '\x03')
  await deps.sleep(SUBMIT_DELAY_MS)
  io.send('', '\x03')
  await waitForQuiet(io, watch, EXIT_QUIET_MS, EXIT_MAX_MS)
}

async function probeOne(
  target: HiddenProbeTarget,
  command: string,
  deps: HiddenProbeDeps,
  term: HiddenTerminal,
  watch: OutputWatch,
): Promise<QuotaSnapshot> {
  const io: DriveIO = { send: (_id, data) => term.send(data), screen: () => term.screen(), now: deps.now, sleep: deps.sleep }
  watch.text = ''
  term.send(`${command}\r`)
  const started = await waitForAgent(deps, term, watch, command)
  if (started === 'shell') return errorSnapshot(deps.now(), 'failed', `${command} did not start.`)
  try {
    const screen = await settleAndTrust(io, '', watch)
    if (isBlockingScreen(screen)) {
      return errorSnapshot(deps.now(), 'failed', `${command} is waiting on a sign-in or setup step; open it in a terminal once.`)
    }
    const parsed = await submitAndRead(AGENT_PROBES[target.agent], io, '', watch)
    if (parsed?.ok) return { windows: parsed.windows, fetchedAt: deps.now(), source: 'cli' }
    if (parsed?.error === 'not_signed_in') return errorSnapshot(deps.now(), 'not_signed_in', `${command} is not signed in.`)
    return errorSnapshot(deps.now(), 'timeout', `${command} did not show its usage panel in time.`)
  } finally {
    await exitAgent(io, deps, term, watch)
  }
}

/**
 * Read every target one after another in one hidden terminal, reporting each as it finishes.
 * Returns the keys it could not try (no launch command, or no hidden terminal), for the caller's
 * fallback read.
 */
export async function probeProfilesHidden(
  targets: readonly HiddenProbeTarget[],
  deps: HiddenProbeDeps,
  onResult: (key: string, snapshot: QuotaSnapshot) => void,
): Promise<string[]> {
  const runnable = targets.flatMap((target) => {
    const command = launchCommandFor(target)
    return command ? [{ target, command }] : []
  })
  const skipped = targets.filter((target) => !runnable.some((entry) => entry.target === target)).map((target) => target.key)
  if (runnable.length === 0) return skipped
  const cwd = await deps.probeDir().catch(() => null)
  const term = cwd ? await deps.open(cwd).catch(() => null) : null
  if (!term) return targets.map((target) => target.key)
  const watch: OutputWatch = { text: '', lastAt: deps.now() }
  const stopWatching = term.onOutput((text) => {
    watch.text += text
    watch.lastAt = deps.now()
  })
  try {
    const shell: DriveIO = { send: () => {}, screen: () => term.screen(), now: deps.now, sleep: deps.sleep }
    await waitForQuiet(shell, watch, SHELL_QUIET_MS, SHELL_READY_MS)
    for (const { target, command } of runnable) {
      const snapshot = await probeOne(target, command, deps, term, watch)
        .catch((error: unknown) => errorSnapshot(deps.now(), 'failed', error instanceof Error ? error.message : String(error)))
      onResult(target.key, snapshot)
    }
  } finally {
    stopWatching()
    await term.close().catch(() => {})
  }
  return skipped
}

/** The live hidden terminal, with the sidecar's scratch folder. */
export function liveHiddenProbeDeps(probeDir: () => Promise<string | null>): HiddenProbeDeps {
  return {
    probeDir,
    open: openHiddenTerminal,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}
