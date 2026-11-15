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
    expect(sessionTabTitle(local('pwsh', 'D:\\work\\OmniTerm'), false)).toBe('pwsh — OmniTerm')
  })

  it('does not repeat a folder the name already holds', () => {
    expect(sessionTabTitle(local('pwsh (omniterm)', 'D:\\work\\OmniTerm'), false)).toBe('pwsh (omniterm)')
  })

  it('shows the name alone for agents, remote sessions and shells without a folder', () => {
    expect(sessionTabTitle(local('claude', 'D:\\work\\OmniTerm'), true)).toBe('claude')
    expect(sessionTabTitle({ name: 'web-01', connType: 'SSH', cwd: '/srv/app' }, false)).toBe('web-01')
    expect(sessionTabTitle(local('pwsh', 'C:\\'), false)).toBe('pwsh')
  })

  it('falls back to Terminal when the session is unknown or unnamed', () => {
    expect(sessionTabTitle(undefined, false)).toBe('Terminal')
    expect(sessionTabTitle(local('', null), false)).toBe('Terminal')
  })
})
