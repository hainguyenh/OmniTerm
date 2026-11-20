/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../ide/platform/ipc', () => ({
  isTauri: () => true,
  call: vi.fn(),
  commands: {
    menuModel: vi.fn().mockResolvedValue([
      { kind: 'submenu', id: 'file', label: 'File', children: [{ kind: 'placeholder', id: 'x', label: 'Nothing' }] },
      { kind: 'submenu', id: 'edit', label: 'Edit', children: [{ kind: 'placeholder', id: 'y', label: 'Nothing' }] },
    ]),
  },
  onIdeEvent: vi.fn(),
}))
vi.mock('../../ide/platform/platformInfo', () => ({
  usePlatform: Object.assign(() => 'windows', { getState: () => ({ os: 'windows' }) }),
}))

import { MainMenu } from '../../ide/workbench/MainMenu'

describe('main menu logo', () => {
  it('is the OmniTerm logo: no button, no tooltip, nothing to click', () => {
    const { container } = render(<MainMenu />)
    expect(screen.queryByRole('button')).toBeNull()
    const logo = container.querySelector('img')
    expect(logo).not.toBeNull()
    expect(container.querySelector('[title], [data-tooltip], [aria-label]')).toBeNull()
    fireEvent.click(logo as HTMLElement)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('still opens the menus as one vertical popup on a lone Alt press', async () => {
    render(<MainMenu />)
    fireEvent.keyDown(window, { key: 'Alt' })
    fireEvent.keyUp(window, { key: 'Alt' })
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('File'), expect.stringContaining('Edit')]),
    ))
    expect(screen.queryByRole('menubar')).toBeNull()
  })
})
