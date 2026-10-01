/**
 * "An AI agent is being started in this pane", raised the moment it happens: when Enter submits a
 * shell line that runs an agent, and when session restore starts a pane with an agent's resume
 * command. The Agent Quota plugin listens and freezes the pane right away, so the user cannot type
 * into the agent's first screen while it answers the folder-trust dialog and reads `/usage`
 * (plugins/agent-quota/app/inlineUsageProbe.ts). Without it the freeze waited for the next
 * process-tree scan, seconds after the agent was already on screen and taking input.
 *
 * The line is read back from the pane's screen at Enter time rather than rebuilt from keystrokes,
 * so history recall and tab completion are seen as the shell sees them.
 */

import { lastUserInputAt } from './paneInputHold'

export type LaunchedAgent = 'claude' | 'codex' | 'agy' | 'opencode' | 'aider' | 'gemini'

type Listener = (sessionId: string, agent: LaunchedAgent) => void

const listeners = new Set<Listener>()
/**
 * Launches noted while nobody listened: after a crash, session restore starts the panes before the
 * plugin has come up. A listener that arrives soon after still gets them — unless the user has
 * typed into the pane since, which a late freeze must not cut into.
 */
const unheard = new Map<string, { agent: LaunchedAgent; at: number }>()
const REPLAY_MS = 15_000

export function onAgentLaunch(listener: Listener, now = Date.now()): () => void {
  listeners.add(listener)
  for (const [sessionId, { agent, at }] of unheard) {
    const typed = lastUserInputAt(sessionId)
    if (now - at <= REPLAY_MS && (typed === undefined || typed <= at)) listener(sessionId, agent)
  }
  unheard.clear()
  return () => {
    listeners.delete(listener)
  }
}

export function noteAgentLaunch(sessionId: string, agent: LaunchedAgent, now = Date.now()): void {
  if (listeners.size === 0) unheard.set(sessionId, { agent, at: now })
  for (const listener of [...listeners]) listener(sessionId, agent)
}

export function resetAgentLaunchSignalForTests(): void {
  listeners.clear()
  unheard.clear()
}

/**
 * An idle prompt (PowerShell, cmd, a POSIX `$`/`#`/`%` prompt, or a bare arrow prompt), then the
 * agent or one of its profile launchers (`claude-work`) as the first word — optionally behind
 * PowerShell's `&` or a path, with a Windows script extension.
 */
const AGENT_LINE = /^\s*(?:PS [^>]*>|[A-Za-z]:\\[^>]*>|\S*[$#%]|[❯›➜λ])?\s*(?:&\s*)?(?:\S*[\\/])?(claude|codex|agy|opencode|aider|gemini)(?:-[A-Za-z0-9_.]{1,40})?(?:\.(?:cmd|bat|exe|ps1))?(?:\s+(.*))?$/i

/** Subcommands and flags that print and exit instead of opening the agent's interactive screen. */
const ONE_SHOT = /^(?:-v|-h|-p|--version|--help|--print|update|doctor|mcp|config|install|login|logout|exec|e|apply|completion)(?:\s|$)/i

/** Which agent a submitted shell line starts interactively, if any. */
export function agentLaunchedBy(line: string): LaunchedAgent | null {
  const match = AGENT_LINE.exec(line.trimEnd())
  if (!match) return null
  const args = (match[2] ?? '').trim()
  if (args && ONE_SHOT.test(args)) return null
  return match[1].toLowerCase() as LaunchedAgent
}

interface CursorBuffer {
  active: {
    readonly type?: string
    readonly baseY: number
    readonly cursorY: number
    getLine: (line: number) => { translateToString: (trimRight?: boolean) => string } | undefined
  }
}

/**
 * Called by the pane for every input chunk it sends on. An Enter on the normal screen submits the
 * line under the cursor; a full-screen program (alternate screen) owns its own Enter.
 */
export function noteSubmittedInput(sessionId: string, data: string, buffer: CursorBuffer, now = Date.now()): void {
  if (!data.includes('\r')) return
  const active = buffer.active
  if (active.type === 'alternate') return
  const line = active.getLine(active.baseY + active.cursorY)?.translateToString(true)
  if (!line) return
  const agent = agentLaunchedBy(line)
  if (agent) noteAgentLaunch(sessionId, agent, now)
}
