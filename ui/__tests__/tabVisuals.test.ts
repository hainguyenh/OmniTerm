import { describe, it, expect } from 'vitest'
import { activityDot, activityLabel, PLACEMENT_STRIPE, tabClasses, tabPlacement, tabTitle } from '../tabVisuals'

describe('tabPlacement', () => {
  it('separates the focused pane, another docked pane, and a background session', () => {
    expect(tabPlacement(2, 2)).toBe('focused')
    expect(tabPlacement(1, 2)).toBe('docked')
    expect(tabPlacement(-1, 2)).toBe('background')
  })
})

describe('tabClasses', () => {
  it('only the docked placements are filled — a background tab reads as recessed', () => {
    expect(tabClasses('focused')).toContain('bg-theme-bg')
    expect(tabClasses('docked')).toContain('bg-theme-bg')
    expect(tabClasses('background')).toContain('bg-transparent')
  })

  it('gives the focused tab a solid stripe, other docked panes a faint one, background none', () => {
    expect(PLACEMENT_STRIPE.focused).toBe('bg-theme-accent')
    expect(PLACEMENT_STRIPE.docked).toMatch(/accent\/40/)
    expect(PLACEMENT_STRIPE.background).toBeNull()
  })

  it('dims a dead session without fighting the placement colours', () => {
    // Only one opacity utility may ever be emitted, or Tailwind's ordering decides the winner.
    for (const placement of ['focused', 'docked', 'background'] as const) {
      const cls = tabClasses(placement, { status: 'closed' })
      expect(cls.match(/opacity-/g)).toHaveLength(1)
      expect(tabClasses(placement, { status: 'connected' })).not.toMatch(/opacity-/)
    }
    expect(tabClasses('docked', { status: 'error' })).toContain('opacity-60')
  })

  it('marks ephemeral sessions with a dashed border', () => {
    expect(tabClasses('docked', { ephemeral: true })).toContain('border-dashed')
    expect(tabClasses('docked')).not.toContain('border-dashed')
  })
})

describe('activity axis', () => {
  it('gives a working shell a filled dot and an idle one a hollow ring', () => {
    expect(activityDot({ status: 'connected', busy: true })).toContain('bg-theme-accent')
    const idle = activityDot({ status: 'connected', busy: false })
    expect(idle).toContain('bg-transparent')
    expect(idle).toContain('border-theme-dim')
  })

  it('falls back to plain connection status when activity is unknowable', () => {
    // SSH/RDP panes and the Electron backend never report activity: undefined, not "idle".
    expect(activityDot({ status: 'connected' })).toContain('bg-theme-accent')
    expect(activityDot({ status: 'connected' })).not.toContain('border-theme-dim')
    expect(activityLabel({ status: 'connected' })).toBeNull()
  })

  it('says nothing about activity for a session that is not connected', () => {
    // A closed shell is not "idle" — it is gone, and the status dot already says so.
    expect(activityDot({ status: 'closed', busy: false })).toContain('bg-[#565f89]')
    expect(activityLabel({ status: 'closed', busy: false })).toBeNull()
    expect(activityLabel({ status: 'connected', busy: true })).toBe('running')
    expect(activityLabel({ status: 'connected', busy: false })).toBe('idle')
  })
})

describe('tabTitle', () => {
  it('spells out status, placement and the pane identity in split view', () => {
    expect(tabTitle('web-01', 'focused', 1, 4, { status: 'connected' }, 'amber diamond'))
      .toBe('web-01 — Connected · in view — active pane (pane 2 · amber diamond)')
  })

  it('omits the pane number in single view', () => {
    expect(tabTitle('web-01', 'focused', 0, 1, { status: 'connected' }))
      .toBe('web-01 — Connected · in view — active pane')
  })

  it('names the activity of a local shell alongside its status', () => {
    expect(tabTitle('pwsh', 'background', -1, 2, { status: 'connected', busy: false }))
      .toBe('pwsh — Connected · idle · running in background')
    expect(tabTitle('build.bat', 'background', -1, 2, { status: 'connected', busy: true, ephemeral: true }))
      .toBe('build.bat — Connected · running · running in background · temporary session')
  })

  it('calls out a background session, and temporary / preview tabs', () => {
    expect(tabTitle('sh', 'background', -1, 2, { status: 'connected', ephemeral: true }))
      .toBe('sh — Connected · running in background · temporary session')
    // Editor tabs pass no status: they own no backend session.
    expect(tabTitle('deploy.ps1', 'docked', 0, 1, { preview: true }))
      .toBe('deploy.ps1 — in view · preview — double-click to keep open')
  })
})
