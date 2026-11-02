/**
 * Theme-styled "Copied" floating toast.
 * Spawns at the given {x, y} coordinate, gently floats upwards, and fades out.
 * Adapts automatically to the active theme's colors, borders, and radius.
 */

const STYLE_ID = 'omniterm-pixel-copied-toast-style'
const TOAST_DURATION_MS = 450

const TOAST_CSS = `
@keyframes omniterm-copied-float {
  0% {
    opacity: 0;
    transform: translate(-50%, 4px) scale(0.92);
  }
  15% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
  65% {
    opacity: 1;
    transform: translate(-50%, -4px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -14px) scale(0.96);
  }
}
.omniterm-copied-toast {
  position: fixed !important;
  z-index: 99999 !important;
  pointer-events: none !important;
  user-select: none !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  padding: 3px 10px !important;
  background-color: var(--theme-popup-bg, var(--theme-bg, #24283b)) !important;
  color: var(--theme-fg, currentColor) !important;
  border: 1px solid var(--theme-border, rgba(120, 120, 120, 0.25)) !important;
  border-radius: 9999px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.08) !important;
  backdrop-filter: blur(8px) !important;
  font-family: inherit !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  line-height: 1 !important;
  animation: omniterm-copied-float ${TOAST_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
}
.theme-square .omniterm-copied-toast,
.theme-terminal-paper .omniterm-copied-toast,
html.theme-square .omniterm-copied-toast,
html.theme-terminal-paper .omniterm-copied-toast,
.omniterm-copied-toast.toast-square {
  border-radius: 0 !important;
}
.omniterm-copied-toast-icon {
  width: 13px !important;
  height: 13px !important;
  flex-shrink: 0 !important;
  color: var(--theme-accent, currentColor) !important;
}
.omniterm-copied-toast-text {
  font-size: 11px !important;
  font-weight: 600 !important;
  color: var(--theme-fg, currentColor) !important;
  letter-spacing: 0.02em !important;
  white-space: nowrap !important;
}
`

function ensureToastStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== TOAST_CSS) {
    style.textContent = TOAST_CSS
  }
}

/**
 * Display a theme-styled "Copied" floating toast at {x, y}.
 * Automatically unmounts after animation completes.
 */
export function showPixelCopiedToast(x: number, y: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  ensureToastStyles()

  const safeX = Number.isFinite(x) ? x : 100
  const safeY = Number.isFinite(y) ? y : 100

  // Keep within visible viewport
  const winW = typeof window.innerWidth === 'number' && window.innerWidth > 0 ? window.innerWidth : 800
  const winH = typeof window.innerHeight === 'number' && window.innerHeight > 0 ? window.innerHeight : 600
  const clampedX = Math.max(36, Math.min(safeX, winW - 36))
  const clampedY = Math.max(30, Math.min(safeY, winH - 24))

  const isSquare =
    document.documentElement.classList.contains('theme-square') ||
    document.documentElement.classList.contains('theme-terminal-paper')

  const container = document.createElement('div')
  container.className = isSquare
    ? 'omniterm-copied-toast toast-square'
    : 'omniterm-copied-toast'
  container.setAttribute('data-pixel-copied-toast', 'true')
  container.setAttribute('role', 'status')
  container.setAttribute('aria-live', 'polite')
  container.style.left = `${clampedX}px`
  container.style.top = `${clampedY}px`
  if (isSquare) {
    container.style.borderRadius = '0px'
  }

  // Theme checkmark icon
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'omniterm-copied-toast-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', '20 6 9 17 4 12')
  svg.appendChild(polyline)
  container.appendChild(svg)

  const textSpan = document.createElement('span')
  textSpan.className = 'omniterm-copied-toast-text'
  textSpan.textContent = 'Copied'
  container.appendChild(textSpan)

  document.body.appendChild(container)

  window.setTimeout(() => {
    container.remove()
  }, TOAST_DURATION_MS + 50)
}

export const showCopiedToast = showPixelCopiedToast
