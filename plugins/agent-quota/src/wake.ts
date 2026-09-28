import type { ProviderDeps } from './deps'
import type { WakeRequest, WakeResult } from './types'

import { agentCommand } from './launcher'
import { isSafePrompt } from './prompt'

const WAKE_TIMEOUT_MS = 120_000

/**
 * Start a new session window by sending the agent one tiny prompt, as a separate process in the
 * temp directory so it touches no project and works while the terminal's own agent is frozen. It
 * runs through the profile's launcher when the terminal used one (`claude-th -p hi …`). Claude is
 * pinned to Haiku, the cheapest model; Codex runs read-only and skips the git check.
 */
export async function wakeAgent(request: WakeRequest, deps: ProviderDeps): Promise<WakeResult> {
  if (!isSafePrompt(request.prompt)) return { ok: false, message: 'The wake prompt may only contain letters, digits and simple punctuation.' }
  const command = agentCommand(request.agent, request, deps)
  if (!command) {
    const name = request.agent === 'claude' ? 'Claude Code' : request.agent === 'agy' ? 'Antigravity' : 'Codex'
    return { ok: false, message: `${name} CLI not found.` }
  }
  const args = request.agent === 'claude'
    ? ['-p', request.prompt, '--model', 'haiku']
    : request.agent === 'agy'
      ? ['-p', request.prompt]
      : ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', request.prompt]
  const result = await deps.run(command.exe, args, { env: command.env, timeoutMs: WAKE_TIMEOUT_MS, cwd: deps.tmp })
  if (result.timedOut) return { ok: false, message: 'The wake prompt timed out.' }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/).pop()?.slice(0, 200)
    return { ok: false, message: detail || `The agent exited with code ${result.code}.` }
  }
  return { ok: true }
}
