import { describe, expect, it, vi } from 'vitest'

const getCurrentWindow = vi.fn()
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => getCurrentWindow() }))

import { ownsSessionPersistence } from '../sessionOwnerWindow'

describe('ownsSessionPersistence', () => {
  it('belongs to the main window only', () => {
    expect(ownsSessionPersistence('main')).toBe(true)
    expect(ownsSessionPersistence('project-1')).toBe(false)
    expect(ownsSessionPersistence('term-2')).toBe(false)
  })

  it('reads the current window label when none is given', () => {
    getCurrentWindow.mockReturnValue({ label: 'project-1' })
    expect(ownsSessionPersistence()).toBe(false)
    getCurrentWindow.mockReturnValue({ label: 'main' })
    expect(ownsSessionPersistence()).toBe(true)
  })

  it('owns persistence outside Tauri, where there is a single page', () => {
    getCurrentWindow.mockImplementation(() => { throw new Error('no tauri') })
    expect(ownsSessionPersistence()).toBe(true)
  })
})
