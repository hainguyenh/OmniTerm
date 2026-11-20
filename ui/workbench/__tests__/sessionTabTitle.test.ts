import { describe, expect, it } from 'vitest'

import { folderName, sessionTabTitle } from '../sessions/sessionTabTitle'

const local = (name: string, cwd: string | null) => ({ name, connType: 'LOCAL', cwd })

describe('folderName', () => {
  it('takes the last folder of Windows and POSIX paths', () => {
    expect(folderName('D:\\work\\OmniTerm\\')).toBe('OmniTerm')
    expect(folderName('/home/dev/project')).toBe('project')
  })

  it('has no name for a drive root, a slash or nothing', () => {
    expect(folderName('D:\\')).toBeNull()
    expect(folderName('/')).toBeNull()
    expect(folderName('')).toBeNull()
    expect(folderName(null)).toBeNull()
  })
})

describe('sessionTabTitle', () => {
  it('adds the folder a local shell works in', () => {
    expect(sessionTabTitle(local('pwsh', 'D:\\work\\OmniTerm'), null)).toBe('pwsh — OmniTerm')
  })

  it('does not repeat a folder the name already holds', () => {
    expect(sessionTabTitle(local('pwsh (omniterm)', 'D:\\work\\OmniTerm'), null)).toBe('pwsh (omniterm)')
  })

  // The tab of an agent reads [icon] profile: the terminal's name and an "agent" pill said less.
  it('names an agent tab after its profile', () => {
    expect(sessionTabTitle(local('pwsh', 'D:\\work\\OmniTerm'), 'claude-work')).toBe('claude-work')
  })

  it('shows the name alone for remote sessions and shells without a folder', () => {
    expect(sessionTabTitle({ name: 'web-01', connType: 'SSH', cwd: '/srv/app' }, null)).toBe('web-01')
    expect(sessionTabTitle(local('pwsh', 'C:\\'), null)).toBe('pwsh')
  })

  it('falls back to Terminal when the session is unknown or unnamed', () => {
    expect(sessionTabTitle(undefined, null)).toBe('Terminal')
    expect(sessionTabTitle(local('', null), null)).toBe('Terminal')
  })
})
