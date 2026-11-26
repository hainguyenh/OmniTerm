import { describe, expect, it } from 'vitest'

import type { Connection } from '../../../domain'

import { connectionFromDraft, draftFromConnection, draftFromSsh, draftProblem, emptyDraft } from '../connectionDraft'
import { buildConnectionTree, nodeDetail, nodeLabel, sshAddress } from '../connectionNodes'

describe('connection drafts', () => {
  it('explains what the backend would refuse before saving', () => {
    expect(draftProblem(emptyDraft('SSH'))).toBe('Enter the host to connect to.')
    expect(draftProblem({ ...emptyDraft('SSH'), host: '-oProxyCommand=x' })).toMatch(/one name or address/)
    expect(draftProblem({ ...emptyDraft('SSH'), host: 'h', user: 'a b' })).toMatch(/user name/)
    expect(draftProblem({ ...emptyDraft('RDP'), host: 'h', port: '70000' })).toMatch(/port/)
    expect(draftProblem({ ...emptyDraft('RDP'), host: 'pc', port: '3389', user: 'me' })).toBeNull()
  })

  it('turns a draft into a profile with no password, and back', () => {
    const rdp = connectionFromDraft({ ...emptyDraft('RDP'), host: ' pc ', redirectDrives: true })
    expect(rdp).toEqual({ id: '', type: 'RDP', name: '', host: 'pc', port: '', user: '', redirectDrives: true })
    const ssh = connectionFromDraft({ ...emptyDraft('SSH'), host: 'h', redirectDrives: true })
    expect(ssh).not.toHaveProperty('redirectDrives')
    const saved: Connection = { id: 'c1', name: 'box', type: 'SSH', host: 'h', port: '22', user: 'u' }
    expect(draftFromConnection(saved)).toEqual({ id: 'c1', type: 'SSH', name: 'box', host: 'h', port: '22', user: 'u', redirectDrives: false })
  })

  it('prefills a draft from an ssh typed in a terminal', () => {
    expect(draftFromSsh({ user: 'root', host: '10.0.0.5', port: '2222' })).toMatchObject({
      type: 'SSH', name: 'root@10.0.0.5', host: '10.0.0.5', port: '2222', user: 'root',
    })
    expect(draftFromSsh({ host: 'box' })).toMatchObject({ name: 'box', port: '', user: '' })
  })
})

describe('active ssh rows', () => {
  const session = { sessionId: 's1', pid: 7, user: 'root', host: 'h', port: '22' }

  it('lists running ssh sessions above the saved groups, with their terminal', () => {
    const roots = buildConnectionTree([], [], 'w1', [{ session, terminal: 'pwsh' }])
    expect(roots).toHaveLength(1)
    expect(nodeLabel(roots[0]!)).toBe('Active SSH (not saved)')
    const child = roots[0]!.kind === 'active' ? roots[0]!.children[0]! : null
    expect(child && nodeLabel(child)).toBe('root@h')
    expect(child && nodeDetail(child)).toBe('pwsh')
    expect(nodeDetail(roots[0]!)).toBe('1')
  })

  it('has no active group while no ssh runs', () => {
    expect(buildConnectionTree([], [], 'w1', [])).toEqual([])
  })

  it('leaves the default port out of an address', () => {
    expect(sshAddress({ host: 'h', port: '2222' })).toBe('h:2222')
    expect(sshAddress({ user: 'u', host: 'h', port: '22' })).toBe('u@h')
  })
})
