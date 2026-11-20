import { create } from 'zustand'

/** The window event that opens the Always Awake dialog (the main layout owns the dialog). */
export const OPEN_ALWAYS_AWAKE_EVENT = 'omniterm:always-awake'

/**
 * What the workbench shows of Always Awake: whether the built-in feature is on in Plugins, whether
 * the user switched it on, and whether it is keeping the machine awake right now. Published by the
 * main layout, which owns the feature's state.
 */
export interface AwakeIndicatorState {
  available: boolean
  enabled: boolean
  keepingAwake: boolean
}

export const useAwakeIndicator = create<AwakeIndicatorState>(() => ({
  available: false,
  enabled: false,
  keepingAwake: false,
}))

export function publishAwakeIndicator(next: AwakeIndicatorState): void {
  const current = useAwakeIndicator.getState()
  if (current.available === next.available && current.enabled === next.enabled && current.keepingAwake === next.keepingAwake) return
  useAwakeIndicator.setState(next, true)
}

export function openAlwaysAwake(): void {
  window.dispatchEvent(new CustomEvent(OPEN_ALWAYS_AWAKE_EVENT))
}

/** The button's label: the old activity bar's wording, so both read the same. */
export function awakeLabel({ enabled, keepingAwake }: Pick<AwakeIndicatorState, 'enabled' | 'keepingAwake'>): string {
  if (!enabled) return 'Always Awake'
  return keepingAwake ? 'Always Awake (active)' : 'Always Awake (waiting)'
}
