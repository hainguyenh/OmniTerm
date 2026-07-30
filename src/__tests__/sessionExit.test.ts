import { describe, it, expect } from 'vitest'
import { closesOnExit } from '../sessionExit'

describe('closesOnExit', () => {
  it('closes a run-to-completion pane when its shell exits cleanly', () => {
    expect(closesOnExit({ type: 'LOCAL', localKeepOpen: false }, 0)).toBe(true)
  })

  it('keeps the pane when the script failed, so its output can still be read', () => {
    expect(closesOnExit({ type: 'LOCAL', localKeepOpen: false }, 1)).toBe(false)
    expect(closesOnExit({ type: 'LOCAL', localKeepOpen: false }, 255)).toBe(false)
  })

  it('never closes a pane the user opened to work in', () => {
    expect(closesOnExit({ type: 'LOCAL', localKeepOpen: true }, 0)).toBe(false)
    // Absent means keepOpen, matching the backend default (see launch.rs).
    expect(closesOnExit({ type: 'LOCAL' }, 0)).toBe(false)
  })

  it('leaves SSH/RDP sessions and unknown connections alone', () => {
    expect(closesOnExit({ type: 'SSH', localKeepOpen: false }, 0)).toBe(false)
    expect(closesOnExit({ type: 'RDP' }, 0)).toBe(false)
    expect(closesOnExit(undefined, 0)).toBe(false)
    expect(closesOnExit(null, 0)).toBe(false)
  })
})
