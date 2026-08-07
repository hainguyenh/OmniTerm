/**
 * Unit tests for mintSessionId (pure helper exported from MainLayout).
 *
 * SSH/RDP reuse the connection id as the session id (at most one running instance);
 * LOCAL mints a fresh id per launch so the same saved shell can run as several
 * independent instances at once.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { mintSessionId } from '../components/MainLayout'

describe('mintSessionId', () => {
  it('SSH reuses the connection id', () => {
    expect(mintSessionId({ id: 'conn-1', type: 'SSH' })).toBe('conn-1')
  })

  it('RDP reuses the connection id', () => {
    expect(mintSessionId({ id: 'conn-2', type: 'RDP' })).toBe('conn-2')
  })

  it('LOCAL mints a fresh id prefixed by the connection id', () => {
    const sessionId = mintSessionId({ id: 'conn-3', type: 'LOCAL' })
    expect(sessionId.startsWith('conn-3_')).toBe(true)
    expect(sessionId).not.toBe('conn-3')
  })

  /**
   * A session id also names per-session Tauri events, and Tauri rejects an event name containing
   * anything outside this set — the `#` this used to mint made every subscription fail, leaving the
   * pane stuck on "connecting".
   */
  it('mints ids Tauri accepts in an event name', () => {
    for (const type of ['LOCAL', 'SSH', 'RDP'] as const) {
      const sessionId = mintSessionId({ id: 'adhoc-1e4c9f', type })
      expect(sessionId).toMatch(/^[A-Za-z0-9\-/:_]+$/)
    }
  })

  it('LOCAL mints a different id on every call (independent instances)', () => {
    const a = mintSessionId({ id: 'conn-4', type: 'LOCAL' })
    const b = mintSessionId({ id: 'conn-4', type: 'LOCAL' })
    expect(a).not.toBe(b)
  })
})
