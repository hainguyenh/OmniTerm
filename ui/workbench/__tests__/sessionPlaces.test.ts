import { describe, expect, it } from 'vitest'

import { placeCrumbs } from '../../ide/editor/core/view/StatusItems'
import { useTabPlaces } from '../../ide/editor/core/view/tabPlaces'
import { useSessionBridge, type SessionInfo } from '../sessions/sessionBridge'
import { sessionInput } from '../sessions/sessionInput'
import { editorDir, registerSessionPlaces, sessionPlace } from '../sessions/sessionPlaces'

const session = (patch: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 'local_1',
  connId: 'local',
  name: 'Terminal 1',
  connType: 'LOCAL',
  workspaceId: null,
  status: 'connected',
  busy: false,
  cwd: 'D:\\workspace\\Bravo.AutomationPlaywright\\tests\\',
  hasCommand: false,
  location: 'D:\\workspace\\Bravo.AutomationPlaywright\\tests\\',
  shellLabel: 'PowerShell 7',
  ...patch,
})

const project = { root: 'D:/workspace/Bravo.AutomationPlaywright', name: 'Bravo.AutomationPlaywright' }

describe('session places', () => {
  it('write Windows folders the way the editor does', () => {
    expect(editorDir('d:\\work\\app\\')).toBe('D:/work/app')
    expect(editorDir('C:\\')).toBe('C:/')
    expect(editorDir('/home/me/')).toBe('/home/me')
    expect(editorDir('/')).toBe('/')
  })

  it('show a local shell as project › folder › shell, like a file', () => {
    const place = sessionPlace(session(), undefined)
    expect(place).toMatchObject({ dir: 'D:/workspace/Bravo.AutomationPlaywright/tests', host: null, label: 'PowerShell 7' })
    expect(placeCrumbs(project, place).map((c) => c.label)).toEqual(['Bravo.AutomationPlaywright', 'tests', 'PowerShell 7'])
    // Outside the project: the folder itself leads.
    expect(placeCrumbs(null, place).map((c) => c.label)).toEqual(['tests', 'PowerShell 7'])
  })

  it('name the agent running in the session, and a remote session by its host', () => {
    const agent = sessionPlace(session(), { agent: 'claude', profileName: 'claude-work', pid: 1, startTime: 0 })
    expect(agent.label).toBe('Claude Code')
    expect(agent.title).toBe('Claude Code · profile claude-work')

    const remote = sessionPlace(session({ connType: 'SSH', cwd: null, location: 'me@host:22', shellLabel: null }), undefined)
    expect(remote).toMatchObject({ dir: null, host: 'me@host:22', label: 'Terminal 1' })
    expect(placeCrumbs(project, remote).map((c) => c.label)).toEqual(['me@host:22', 'Terminal 1'])
  })

  it('are published for every session tab and withdrawn with the registration', () => {
    useTabPlaces.setState({ places: { 'other:1': { dir: null, label: 'x', icon: 'file' } } })
    useSessionBridge.setState({ sessions: [session()] })
    const stop = registerSessionPlaces()
    const key = sessionInput('local_1').key
    expect(useTabPlaces.getState().places[key]?.label).toBe('PowerShell 7')

    useSessionBridge.setState({ sessions: [session({ cwd: 'D:\\workspace' })] })
    expect(useTabPlaces.getState().places[key]?.dir).toBe('D:/workspace')

    stop()
    expect(Object.keys(useTabPlaces.getState().places)).toEqual(['other:1'])
  })
})
