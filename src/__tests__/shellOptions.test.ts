/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadShellOptions, pickShell, shellLabel, staticShellOptions } from '../shellOptions'

function setBridge(platform: string, list: () => Promise<Array<{ id: string; label: string }>>): void {
  const testWindow = window as unknown as { omnitermAPI: unknown }
  testWindow.omnitermAPI = { app: { platform }, shells: { list } }
}

describe('shellOptions', () => {
  beforeEach(() => {
    delete (window as any).omnitermAPI
  })

  it('returns platform-appropriate static options', () => {
    expect(staticShellOptions('win32').map((option) => option.id)).toEqual(['powershell', 'cmd', 'wsl'])
    expect(staticShellOptions('darwin').map((option) => option.id)).toEqual(['default', 'zsh', 'bash', 'sh'])
  })

  it('uses the probed list when the host returns one', async () => {
    const probed = [{ id: 'fish', label: 'Friendly shell' }]
    setBridge('linux', vi.fn().mockResolvedValue(probed))
    await expect(loadShellOptions()).resolves.toEqual(probed)
  })

  it('falls back when probing returns empty or rejects', async () => {
    setBridge('win32', vi.fn().mockResolvedValue([]))
    await expect(loadShellOptions()).resolves.toEqual(staticShellOptions('win32'))

    setBridge('linux', vi.fn().mockRejectedValue(new Error('probe failed')))
    await expect(loadShellOptions()).resolves.toEqual(staticShellOptions('linux'))
  })

  it('picks and labels known shells while degrading unknown values safely', () => {
    const options = [{ id: 'zsh', label: 'Z shell' }, { id: 'bash', label: 'Bash' }]
    expect(pickShell(options, 'bash')).toBe('bash')
    expect(pickShell(options, 'missing')).toBe('zsh')
    expect(pickShell([], 'missing')).toBe('default')
    expect(shellLabel(options, 'zsh')).toBe('Z shell')
    expect(shellLabel(options, 'custom')).toBe('custom')
    expect(shellLabel(options)).toBe('Local Terminal')
  })
})
