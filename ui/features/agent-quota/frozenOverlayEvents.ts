export const FROZEN_OVERLAY_EVENT = 'omniterm:show-frozen-overlay'

export function showSuspendedOverlay(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(FROZEN_OVERLAY_EVENT, { detail: { sessionId } }))
}
