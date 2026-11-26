import { useSyncExternalStore } from 'react'

/** Whether the workbench is dark: `<html data-theme>` names the colour kind (`light`, `dark`, …). */
function isDark(): boolean {
  return document.documentElement.dataset.theme !== 'light'
}

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** Follows the workbench's light/dark switch, so artwork drawn for one mode swaps with it. */
export function useRootDarkMode(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => true)
}
