import { describe, expect, it, vi } from 'vitest'

import type { MenuItem } from '../../../ide/ui/Menu'
import { DEFAULT_CLAUDE_CHOICE } from '../../../utils/sessionQuickStart'
import { claudeProfileMenuItems, projectStartMenuItems } from '../sessionRowMenu'

const project = { key: 'app', label: 'app', cwd: 'D:/work/app', workspaceId: 'w1' }
const claudeRow = (items: MenuItem[]) => items.find((item) => 'label' in item && item.label === 'New Claude Session')

describe('projectStartMenuItems', () => {
  it('has no profile list when only the default Claude profile exists', () => {
    expect(claudeRow(projectStartMenuItems(project, vi.fn()))).not.toHaveProperty('submenu')
    expect(claudeRow(projectStartMenuItems(project, vi.fn(), [DEFAULT_CLAUDE_CHOICE]))).not.toHaveProperty('submenu')
  })

  it('lists the profiles under Claude and starts the chosen launcher in the project', () => {
    const start = vi.fn()
    const row = claudeRow(projectStartMenuItems(project, start, [DEFAULT_CLAUDE_CHOICE, { label: 'claude-work', command: 'claude-work' }]))
    const submenu = (row as { submenu: Array<{ label: string; run: () => void }> }).submenu
    expect(submenu.map((item) => item.label)).toEqual(['claude (default)', 'claude-work'])
    submenu[1]?.run()
    expect(start).toHaveBeenCalledWith(project, 'claude-work')
  })
})

describe('claudeProfileMenuItems', () => {
  it('falls back to the default profile when the scan found none', () => {
    const start = vi.fn()
    const items = claudeProfileMenuItems(project, start, [])
    expect(items.map((item) => ('label' in item ? item.label : item.kind))).toEqual(['Start Claude with profile', 'claude (default)'])
    const fallback = items[1] as { run: () => void }
    fallback.run()
    expect(start).toHaveBeenCalledWith(project, 'claude')
  })
})
