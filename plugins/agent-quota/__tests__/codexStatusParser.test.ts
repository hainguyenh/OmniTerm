import { describe, expect, it } from 'vitest'

import { parseCodexStatus } from '../src/codexStatusParser'
import { parseResetText } from '../src/parseReset'

const NOW = Date.UTC(2026, 8, 25, 3, 0)

// The `/status` card as the pane's rendered screen shows it (box borders included).
const STATUS_CARD = [
  '╭───────────────────────────────────────────────────────────────────╮',
  '│  >_ OpenAI Codex (v0.63.0)                                        │',
  '│  Model:            gpt-5.1-codex (reasoning medium)               │',
  '│  Account:          me@example.com (Plus)                          │',
  '│  Session:          019a7c2e-5f7d-7a31-9b8e-3c2d1e0f4a5b           │',
  '│  Context window:   98% left (5K used / 272K)                      │',
  '│  5h limit:         [███████░░░░░░░░░░░░░] 35% used (resets 18:40) │',
  '│  Weekly limit:     [██░░░░░░░░░░░░░░░░░░] 88% left (resets 09:15 on 2 Oct) │',
  '╰───────────────────────────────────────────────────────────────────╯',
].join('\n')

describe('parseCodexStatus', () => {
  it('reads the 5h and weekly rows and ignores the session id and context window', () => {
    const parsed = parseCodexStatus(STATUS_CARD, NOW)
    if (!parsed.ok) throw new Error(parsed.message)
    expect(parsed.windows).toEqual([
      { kind: 'session', label: '5h limit', usedPct: 35, resetsAt: parseResetText('18:40', NOW) },
      { kind: 'weekly', label: 'Weekly limit', usedPct: 12, resetsAt: parseResetText('09:15 on 2 Oct', NOW) },
    ])
  })

  it('reports a card without limit rows as unparsed, never as zero usage', () => {
    const parsed = parseCodexStatus('│  Session:  019a7c2e │\n│  Context window:   98% left │', NOW)
    expect(parsed).toEqual({ ok: false, error: 'parse_failed', message: 'The /status output named no session window.' })
  })

  it('recognises a signed-out Codex', () => {
    expect(parseCodexStatus('Not logged in. Run codex login.', NOW)).toMatchObject({ ok: false, error: 'not_signed_in' })
  })
})
