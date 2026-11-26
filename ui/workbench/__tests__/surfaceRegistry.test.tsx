/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  claimSurface,
  disposeSurface,
  releaseSurface,
  resetSurfaces,
  setSurfaceShown,
  surfaceHost,
  useSurfaceState,
} from '../sessions/surfaceRegistry'

const mounts: string[] = []

/** Stands for the TerminalView: counts mounts; its React parent is the portal into the host. */
function Terminal({ id }: { id: string }) {
  useEffect(() => {
    mounts.push(id)
    return () => {
      mounts.push(`-${id}`)
    }
  }, [id])
  return <div data-terminal={id} />
}

function Surface({ id }: { id: string }) {
  return createPortal(<Terminal id={id} />, surfaceHost(id))
}

const box = () => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return element
}

afterEach(() => {
  cleanup()
  resetSurfaces()
  mounts.length = 0
  document.body.innerHTML = ''
})

describe('session surfaces', () => {
  it('mounts the terminal once while the host moves between tabs 20 times', () => {
    render(<Surface id="s1" />)
    const [a, b] = [box(), box()]
    const first = Symbol('a')
    const second = Symbol('b')
    for (let round = 0; round < 10; round++) {
      act(() => claimSurface('s1', first, a, true))
      expect(a.querySelector('[data-terminal="s1"]')).not.toBeNull()
      act(() => releaseSurface('s1', first))
      act(() => claimSurface('s1', second, b, true))
      expect(b.querySelector('[data-terminal="s1"]')).not.toBeNull()
      act(() => releaseSurface('s1', second))
    }
    expect(mounts).toEqual(['s1'])
  })

  it('parks an unshown host at its last real size, offscreen and invisible', () => {
    render(<Surface id="s2" />)
    const host = surfaceHost('s2')
    expect(host.parentElement?.dataset.sessionParking).toBeDefined()
    const container = box()
    const owner = Symbol('tab')
    act(() => claimSurface('s2', owner, container, true))
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 640 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 480 })
    act(() => releaseSurface('s2', owner))
    expect(host.parentElement?.dataset.sessionParking).toBeDefined()
    expect(host.style.width).toBe('640px')
    expect(host.style.height).toBe('480px')
    expect((host.parentElement as HTMLElement).style.visibility).toBe('hidden')
    // Attached again it follows its container.
    act(() => claimSurface('s2', Symbol('again'), container, true))
    expect(host.style.width).toBe('100%')
    expect(host.parentElement).toBe(container)
  })

  it('lets the most recently shown of two tabs of one session claim the host', () => {
    render(<Surface id="s3" />)
    const [left, right] = [box(), box()]
    const a = Symbol('a')
    const b = Symbol('b')
    act(() => claimSurface('s3', a, left, true))
    // A duplicate tab that is not shown waits.
    act(() => claimSurface('s3', b, right, false))
    expect(surfaceHost('s3').parentElement).toBe(left)
    act(() => setSurfaceShown('s3', b, true))
    expect(surfaceHost('s3').parentElement).toBe(right)
    expect(useSurfaceState.getState().s3).toMatchObject({ attached: true, shown: true })
    // The holder goes: the host falls back to the other tab, which is not shown now.
    act(() => releaseSurface('s3', b))
    expect(surfaceHost('s3').parentElement).toBe(left)
    act(() => setSurfaceShown('s3', a, false))
    expect(useSurfaceState.getState().s3).toMatchObject({ attached: true, shown: false })
    expect(mounts).toEqual(['s3'])
  })

  it('bumps the epoch on every move so terminals refit', () => {
    render(<Surface id="s4" />)
    const container = box()
    const owner = Symbol('tab')
    const before = useSurfaceState.getState().s4!.epoch
    act(() => claimSurface('s4', owner, container, true))
    const attached = useSurfaceState.getState().s4!.epoch
    act(() => releaseSurface('s4', owner))
    expect(attached).toBeGreaterThan(before)
    expect(useSurfaceState.getState().s4!.epoch).toBeGreaterThan(attached)
  })

  it('drops a disposed session surface', () => {
    const host = surfaceHost('s5')
    disposeSurface('s5')
    expect(host.isConnected).toBe(false)
    expect(useSurfaceState.getState().s5).toBeUndefined()
    expect(surfaceHost('s5')).not.toBe(host)
  })
})
