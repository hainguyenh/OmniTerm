import { describe, it, expect } from 'vitest'
import { detachAction, detachTitle } from '../detachControl'
import type { Connection } from '@omniterm/contract'

const local = { id: 'c1', name: 'shell', type: 'LOCAL' } as Connection
const ssh = { id: 'c2', name: 'box', type: 'SSH' } as Connection
const rdp = { id: 'c3', name: 'desktop', type: 'RDP' } as Connection

describe('detachAction', () => {
  it('offers nothing when the pane holds no connection (empty pane or a script editor)', () => {
    expect(detachAction({ conn: null, status: 'connected', canDetachWindow: true })).toBeNull()
    expect(detachAction({ conn: undefined, status: 'connected', canDetachWindow: true })).toBeNull()
  })

  it('offers detach for a live local/SSH session', () => {
    expect(detachAction({ conn: local, status: 'connected', canDetachWindow: true })).toBe('detach')
    expect(detachAction({ conn: ssh, status: 'connecting', canDetachWindow: true })).toBe('detach')
  })

  it('offers nothing once the shell has exited — there is nothing left to pop out', () => {
    expect(detachAction({ conn: local, status: 'closed', canDetachWindow: true })).toBeNull()
    expect(detachAction({ conn: ssh, status: 'error', canDetachWindow: true })).toBeNull()
  })

  it('hides the control when the backend has no detach command', () => {
    expect(detachAction({ conn: local, status: 'connected', canDetachWindow: false })).toBeNull()
  })

  it('always offers the way back, even for a session that died while popped out', () => {
    // Otherwise a dropped connection would strand its window with no in-app route home.
    expect(detachAction({ conn: local, status: 'closed', poppedOut: true, canDetachWindow: false }))
      .toBe('attach')
    expect(detachAction({ conn: rdp, status: 'error', rdpDetached: true })).toBe('attach')
  })

  it('gates RDP on a connected session and ignores canDetachWindow (it pops out natively)', () => {
    expect(detachAction({ conn: rdp, status: 'connected' })).toBe('detach')
    expect(detachAction({ conn: rdp, status: 'connecting' })).toBeNull()
  })
})

describe('detachTitle', () => {
  it('names the pane as the target when the button sits on a pane header', () => {
    expect(detachTitle('detach', 'pane')).toMatch(/pane/i)
    expect(detachTitle('detach', 'footer')).not.toMatch(/pane/i)
  })

  it('says "main window" only from inside the popped-out window', () => {
    expect(detachTitle('attach', 'window')).toMatch(/main window/i)
    expect(detachTitle('attach', 'pane')).toMatch(/tab/i)
  })
})
