import { describe, expect, it } from 'vitest'
import type { Workspace } from '@omniterm/contract'
import { newTerminalHoverText } from '../newTerminalDescription'

const workspaces: Workspace[] = [{
  id: 'team', name: 'Team', order: 0, pins: [],
  folders: [{ id: 'client', name: 'Client', path: 'C:/repos/client-app' }],
}]
const shells = [
  { id: 'powershell', label: 'PowerShell 7' },
  { id: 'cmd', label: 'Command Prompt' },
]

describe('newTerminalHoverText', () => {
  it('names the actual selected folder and terminal kind', () => {
    expect(newTerminalHoverText(shells, 'powershell', workspaces, 'team::client', 'C:/Users/me'))
      .toBe('Open PowerShell 7 in C:/repos/client-app')
  })

  it('names the real home directory when no workspace is selected', () => {
    expect(newTerminalHoverText(shells, 'cmd', workspaces, null, 'C:/Users/me'))
      .toBe('Open Command Prompt in C:/Users/me')
  })
})
