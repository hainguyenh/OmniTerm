/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'

import type { Workspace } from '../../../domain'
import { readSearchScope, saveSearchScope, searchTargets } from '../projectSearchScope'

const ws = (id: string, ...disabled: boolean[]): Workspace => ({
  id,
  name: id,
  order: 0,
  pins: [],
  folders: disabled.map((off, index) => ({ id: `${id}${index}`, name: `${id}${index}`, path: `/${id}/${index}`, ...(off ? { disabled: true } : {}) })),
})

describe('searchTargets', () => {
  const a = ws('a', false)
  const b = ws('b', false, true)
  const off = ws('off', true)

  it('searches only the current workspace by default', () => {
    expect(searchTargets([a, b], b, 'current')).toEqual([b])
    expect(searchTargets([a, b], null, 'current')).toEqual([])
  })

  it('searches every workspace that has a project switched on, and always the current one', () => {
    expect(searchTargets([a, b, off], a, 'all')).toEqual([a, b])
    expect(searchTargets([a, off], off, 'all')).toEqual([a, off])
    expect(searchTargets([off], off, 'all')).toEqual([off])
  })
})

describe('the remembered scope', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the current workspace and remembers All workspaces', () => {
    expect(readSearchScope()).toBe('current')
    saveSearchScope('all')
    expect(readSearchScope()).toBe('all')
    localStorage.setItem('omniterm.projectSearch.scope', 'junk')
    expect(readSearchScope()).toBe('current')
  })
})
