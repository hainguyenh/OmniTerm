import { afterEach, beforeEach } from 'vitest'

/**
 * jsdom lays nothing out, so the virtualised Tree sees a 0px viewport and renders no rows. This
 * gives every element a fixed size for the tests of the calling file, then restores the originals.
 */
export function useTreeViewport(width = 400, height = 600): void {
  const originals = new Map<'clientWidth' | 'clientHeight', PropertyDescriptor | undefined>()

  beforeEach(() => {
    const sizes = { clientWidth: width, clientHeight: height } as const
    for (const key of Object.keys(sizes) as Array<keyof typeof sizes>) {
      originals.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key))
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => sizes[key] })
    }
  })

  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
    }
    originals.clear()
  })
}
