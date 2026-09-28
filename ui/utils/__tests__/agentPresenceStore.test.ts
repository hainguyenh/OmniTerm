import { beforeEach, describe, expect, it } from 'vitest'

import {
  RESTORE_GRACE_MS,
  getPanePresence,
  isInRestoreGrace,
  markRestoredPane,
  resetPanePresenceForTests,
  setPanePresence,
} from '../agentPresenceStore'

const claude = { agent: 'claude' as const, profileName: 'claude-work', pid: 10, startTime: 5 }

beforeEach(() => resetPanePresenceForTests())

describe('agentPresenceStore', () => {
  it('keeps object identity for unchanged panes so subscribers do not re-render', () => {
    setPanePresence({ 'tab-1': claude })
    const first = getPanePresence('tab-1')
    setPanePresence({ 'tab-1': { ...claude } })
    expect(getPanePresence('tab-1')).toBe(first)
  })

  it('drops panes that no longer report an agent', () => {
    setPanePresence({ 'tab-1': claude })
    setPanePresence({})
    expect(getPanePresence('tab-1')).toBeUndefined()
  })

  it('gives a restored pane a grace period that ends once its agent is seen', () => {
    markRestoredPane('tab-1', 1_000)
    expect(isInRestoreGrace('tab-1', 1_000 + RESTORE_GRACE_MS)).toBe(true)
    expect(isInRestoreGrace('tab-1', 1_001 + RESTORE_GRACE_MS)).toBe(false)

    markRestoredPane('tab-2')
    setPanePresence({ 'tab-2': claude })
    expect(isInRestoreGrace('tab-2')).toBe(false)
  })
})
