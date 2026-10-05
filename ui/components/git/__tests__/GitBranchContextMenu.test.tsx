/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GitBranchContextMenu } from '../GitBranchContextMenu'
import { placeMenu, pointBelow } from '../gitMenuPlacement'

const container = { left: 100, top: 50, width: 800, height: 600 }
const menu = { width: 300, height: 200 }

describe('placeMenu', () => {
  it('opens at the pointer, relative to the container', () => {
    expect(placeMenu({ x: 300, y: 150 }, container, menu)).toEqual({ left: 200, top: 100 })
  })

  it('flips to the other side of the pointer when it would overflow', () => {
    expect(placeMenu({ x: 850, y: 600 }, container, menu)).toEqual({ left: 450, top: 350 })
  })

  it('stays inside the container when neither side fits', () => {
    expect(placeMenu({ x: 110, y: 60 }, { ...container, width: 320, height: 210 }, menu)).toEqual({ left: 10, top: 8 })
    expect(placeMenu({ x: 0, y: 0 }, container, menu)).toEqual({ left: 8, top: 8 })
  })
})

describe('pointBelow', () => {
  it('anchors to the bottom-left corner of an element', () => {
    const element = document.createElement('button')
    element.getBoundingClientRect = () => ({ left: 40, bottom: 70 }) as DOMRect
    expect(pointBelow(element)).toEqual({ x: 40, y: 70 })
  })
})

describe('GitBranchContextMenu', () => {
  it('positions the menu at the click point and closes from its backdrop', () => {
    const onClose = vi.fn()
    const host = document.createElement('div')
    host.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect
    const containerRef = { current: host }
    render(
      <GitBranchContextMenu title="feature/x" point={{ x: 300, y: 150 }} containerRef={containerRef} onClose={onClose}>
        <button type="button">Checkout</button>
      </GitBranchContextMenu>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Actions for feature/x' })
    expect(dialog.style.left).toBe('200px')
    expect(dialog.style.top).toBe('100px')

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.contextMenu(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Close branch actions'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
