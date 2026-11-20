/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prompt = vi.hoisted(() => vi.fn())
const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('../../../ide/workbench/inputDialogs', () => ({ promptInput: prompt }))
vi.mock('../../../ide/workbench/messages', () => ({ confirm: confirmMock }))

import type { Workspace } from '../../../domain'
import { useWorkspaceStore } from '../../../platform/workspaceStore'
import type { MenuItem } from '../../../ide/ui/Menu'
import { workspaceIconName, workspaceMenuItems } from '../workspaceMenu'

const workspace: Workspace = { id: 'w1', name: 'Work', folders: [], order: 0, pins: [], color: 'blue' }
const api = { rename: vi.fn(), remove: vi.fn(), setAppearance: vi.fn(), exportFile: vi.fn().mockResolvedValue(null) }
const refresh = vi.fn(async () => undefined)
type Row = { label: string; run?: () => void; submenu?: MenuItem[] }
const item = (items: MenuItem[], label: string) => items.find((i) => 'label' in i && i.label === label) as unknown as Row

describe('workspace right-click menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = { workspace: api }
    useWorkspaceStore.setState({ refresh } as never)
  })

  it('renames with the typed name and ignores a cancelled prompt', async () => {
    const rename = item(workspaceMenuItems(workspace), 'Rename…')
    prompt.mockResolvedValueOnce('  Client  ')
    rename.run?.()
    await vi.waitFor(() => expect(api.rename).toHaveBeenCalledWith('w1', 'Client'))
    prompt.mockResolvedValueOnce(null)
    rename.run?.()
    await Promise.resolve()
    expect(api.rename).toHaveBeenCalledTimes(1)
  })

  it('sets an icon keeping the colour, and a colour keeping the icon', () => {
    const items = workspaceMenuItems({ ...workspace, icon: 'star' })
    item(item(items, 'Icon').submenu!, 'Server').run?.()
    expect(api.setAppearance).toHaveBeenLastCalledWith('w1', 'blue', 'server')
    item(item(items, 'Color').submenu!, 'Red').run?.()
    expect(api.setAppearance).toHaveBeenLastCalledWith('w1', 'red', 'star')
    item(item(items, 'Icon').submenu!, 'Default (initials)').run?.()
    expect(api.setAppearance).toHaveBeenLastCalledWith('w1', 'blue', undefined)
  })

  it('deletes only after confirmation', async () => {
    const del = item(workspaceMenuItems(workspace), 'Delete Workspace…')
    confirmMock.mockResolvedValueOnce(false)
    del.run?.()
    await Promise.resolve()
    expect(api.remove).not.toHaveBeenCalled()
    confirmMock.mockResolvedValueOnce(true)
    del.run?.()
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledWith('w1'))
    expect(refresh).toHaveBeenCalled()
  })

  it('offers saving the workspace as a VS Code file', async () => {
    item(workspaceMenuItems(workspace), 'Save as VS Code Workspace…').run?.()
    await vi.waitFor(() => expect(api.exportFile).toHaveBeenCalledWith('w1', 'Work'))
  })

  it('maps icon ids to drawable icons and falls back to initials', () => {
    expect(workspaceIconName('server')).toBe('server')
    expect(workspaceIconName(undefined)).toBeNull()
  })
})
