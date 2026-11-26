import { create } from 'zustand'

/**
 * One detached DOM host per session. The terminal itself is rendered once, by SessionSurfaces, into
 * its host through a portal, so React's parent of the xterm never changes. A session tab only
 * attaches the host into its own container (DOM move: no remount, no scrollback loss); a host no
 * tab shows is parked invisibly at its last real size, so the terminal keeps its cols and rows.
 */

export interface SurfaceState {
  /** A tab holds the host (as opposed to it being parked). */
  attached: boolean
  /** The holding tab is the one its pane shows. */
  shown: boolean
  /** Changes whenever the host moved: terminals refit and restore their scroll tail. */
  epoch: number
}

interface Claimant {
  owner: symbol
  container: HTMLElement
}

interface Surface {
  host: HTMLDivElement
  /** Most recently shown last. */
  claimants: Claimant[]
  current: Claimant | null
  shown: boolean
  epoch: number
  size: { width: number; height: number }
  /** Keeps `size` current: React removes a closing tab's DOM before its cleanup can measure it. */
  observer: ResizeObserver | null
}

const DEFAULT_SIZE = { width: 800, height: 600 }
const surfaces = new Map<string, Surface>()
let parking: HTMLDivElement | null = null

export const useSurfaceState = create<Record<string, SurfaceState>>(() => ({}))

function parkingLot(): HTMLDivElement {
  if (parking && parking.isConnected) return parking
  parking = document.createElement('div')
  parking.dataset.sessionParking = ''
  // visibility keeps the layout boxes (xterm keeps its size and scroll position); nothing paints.
  parking.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  document.body.appendChild(parking)
  return parking
}

function publish(id: string, surface: Surface): void {
  useSurfaceState.setState((state) => ({
    ...state,
    [id]: { attached: surface.current !== null, shown: surface.current !== null && surface.shown, epoch: surface.epoch },
  }))
}

function surfaceOf(id: string): Surface {
  let surface = surfaces.get(id)
  if (!surface) {
    const host = document.createElement('div')
    host.dataset.sessionHost = id
    host.style.cssText = 'position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0'
    surface = { host, claimants: [], current: null, shown: false, epoch: 0, size: DEFAULT_SIZE, observer: null }
    if (typeof ResizeObserver !== 'undefined') {
      const target = surface
      target.observer = new ResizeObserver(() => {
        if (target.current && target.host.clientWidth > 0 && target.host.clientHeight > 0)
          target.size = { width: target.host.clientWidth, height: target.host.clientHeight }
      })
      target.observer.observe(host)
    }
    surfaces.set(id, surface)
    park(id, surface)
  }
  return surface
}

function park(id: string, surface: Surface): void {
  const { host } = surface
  if (surface.current && host.clientWidth > 0 && host.clientHeight > 0)
    surface.size = { width: host.clientWidth, height: host.clientHeight }
  host.style.position = 'absolute'
  host.style.width = `${surface.size.width}px`
  host.style.height = `${surface.size.height}px`
  parkingLot().appendChild(host)
  surface.current = null
  surface.epoch += 1
  publish(id, surface)
}

function attach(id: string, surface: Surface, claimant: Claimant): void {
  const { host } = surface
  host.style.position = 'relative'
  host.style.width = '100%'
  host.style.height = '100%'
  claimant.container.appendChild(host)
  surface.current = claimant
  surface.epoch += 1
  publish(id, surface)
}

/** The host element of a session; created parked on first use. */
export function surfaceHost(id: string): HTMLDivElement {
  return surfaceOf(id).host
}

/**
 * A tab asks to show the session. It takes the host when it is shown, or when nobody else holds it;
 * otherwise it waits (a hidden duplicate tab) and takes over once it is shown.
 */
export function claimSurface(id: string, owner: symbol, container: HTMLElement, shown: boolean): void {
  const surface = surfaceOf(id)
  const claimant: Claimant = { owner, container }
  surface.claimants = [...surface.claimants.filter((c) => c.owner !== owner), claimant]
  if (shown || !surface.current) {
    surface.shown = shown
    attach(id, surface, claimant)
  }
}

/** The claiming tab's pane started or stopped showing it. The most recently shown tab wins the host. */
export function setSurfaceShown(id: string, owner: symbol, shown: boolean): void {
  const surface = surfaces.get(id)
  const claimant = surface?.claimants.find((c) => c.owner === owner)
  if (!surface || !claimant) return
  if (shown && surface.current?.owner !== owner) {
    surface.claimants = [...surface.claimants.filter((c) => c !== claimant), claimant]
    surface.shown = true
    attach(id, surface, claimant)
    return
  }
  if (surface.current?.owner === owner && surface.shown !== shown) {
    surface.shown = shown
    publish(id, surface)
  }
}

/** A tab went away: the host moves to the next most recent tab of the session, else parks. */
export function releaseSurface(id: string, owner: symbol): void {
  const surface = surfaces.get(id)
  if (!surface) return
  const wasCurrent = surface.current?.owner === owner
  surface.claimants = surface.claimants.filter((c) => c.owner !== owner)
  if (!wasCurrent) return
  const next = surface.claimants.at(-1)
  if (next) {
    surface.shown = false
    attach(id, surface, next)
  } else {
    surface.shown = false
    park(id, surface)
  }
}

/** The session ended: drops its host (the terminal inside was unmounted by SessionSurfaces). */
export function disposeSurface(id: string): void {
  const surface = surfaces.get(id)
  if (!surface) return
  surface.observer?.disconnect()
  surface.host.remove()
  surfaces.delete(id)
  useSurfaceState.setState((state) => {
    const { [id]: _removed, ...rest } = state
    return rest
  }, true)
}

/** Test hook: forgets every surface. */
export function resetSurfaces(): void {
  for (const id of [...surfaces.keys()]) disposeSurface(id)
  parking?.remove()
  parking = null
}
