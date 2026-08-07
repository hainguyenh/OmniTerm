import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { diag } from '../../../ui/diag'

function onState(callback: (state: AlwaysAwakeStatus) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let cancelled = false
  listen<AlwaysAwakeStatus>('always-awake:state', (event) => callback(event.payload))
    .then((fn) => {
      if (cancelled) { fn(); return }
      unlisten = fn
    })
    .catch((error) => diag.error('[alwaysAwakeAPI] failed to listen for state updates', error))
  return () => {
    cancelled = true
    unlisten?.()
    unlisten = null
  }
}

export function createAlwaysAwakeAPI() {
  return {
    getState: () => invoke<AlwaysAwakeStatus>('get_state'),
    setState: (payload: { enabled: boolean; mode: AlwaysAwakeMode; expiresAtMs: number }) =>
      invoke<AlwaysAwakeStatus>('set_state', payload),
    disable: () => invoke<AlwaysAwakeStatus>('disable'),
    onState,
  }
}
