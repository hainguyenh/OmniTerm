/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TitlePopupList, type PopupEntry } from '../TitlePopupList'

function mount(entries: PopupEntry[], extra: { caption?: string } = {}) {
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const ref = createRef<HTMLElement>()
  ;(ref as { current: HTMLElement | null }).current = anchor
  const onClose = vi.fn()
  const view = render(<TitlePopupList anchor={ref} onClose={onClose} label="Filter" entries={entries} {...extra} />)
  const list = screen.getByRole('listbox')
  return { ...view, list, onClose }
}

const entries = (run = vi.fn()): PopupEntry[] => [
  { id: 'a', label: 'Alpha', run, detail: '3 files' },
  { id: 'b', label: 'Beta', run, checked: true, header: 'Section' },
  { id: 'c', label: 'Gamma', run, icon: 'folder', header: '' },
  { id: 'd', label: 'Delta', run, lead: <i data-testid="lead" /> },
]

const selected = () => screen.getAllByRole('option').findIndex((option) => option.getAttribute('aria-selected') === 'true')

afterEach(cleanup)

describe('TitlePopupList', () => {
  it('starts on the checked entry and renders captions, headers and details', () => {
    mount(entries(), { caption: 'Pick one' })
    expect(selected()).toBe(1)
    expect(screen.getByText('Pick one')).toBeInTheDocument()
    expect(screen.getByText('Section')).toBeInTheDocument()
    expect(screen.getByText('3 files')).toBeInTheDocument()
    expect(screen.getByTestId('lead')).toBeInTheDocument()
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('starts on the first entry when none is checked', () => {
    mount([{ id: 'a', label: 'Alpha', run: vi.fn() }, { id: 'b', label: 'Beta', run: vi.fn() }])
    expect(selected()).toBe(0)
  })

  it('moves with the arrow keys, wrapping around', () => {
    const { list } = mount(entries())
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(selected()).toBe(2)
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(selected()).toBe(0)
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(selected()).toBe(3)
  })

  it('jumps to the ends with Home and End', () => {
    const { list } = mount(entries())
    fireEvent.keyDown(list, { key: 'End' })
    expect(selected()).toBe(3)
    fireEvent.keyDown(list, { key: 'Home' })
    expect(selected()).toBe(0)
  })

  it('closes and runs the selected entry on Enter, and ignores other keys', () => {
    const run = vi.fn()
    const { list, onClose } = mount(entries(run))
    fireEvent.keyDown(list, { key: 'x' })
    expect(run).not.toHaveBeenCalled()
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()
  })

  it('follows the mouse and runs an entry on click', () => {
    const run = vi.fn()
    const { onClose } = mount(entries(run))
    const options = screen.getAllByRole('option')
    fireEvent.mouseMove(options[3]!)
    expect(selected()).toBe(3)
    fireEvent.mouseMove(options[3]!)
    fireEvent.click(options[0]!)
    expect(onClose).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()
  })

  it('copes with an empty list', () => {
    const { list, onClose } = mount([])
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
