import { create } from 'zustand'

import type { UpdateInfo } from '../../ide/platform/ipc'

/** The newest update the backend reported, until it is installed; drives the title bar indicator. */
export const useAvailableUpdate = create<{ update: UpdateInfo | null; onOpen: ((update: UpdateInfo) => void) | null }>(
  () => ({ update: null, onOpen: null }),
)

export function setAvailableUpdate(update: UpdateInfo | null, onOpen?: (update: UpdateInfo) => void): void {
  useAvailableUpdate.setState(onOpen ? { update, onOpen } : { update })
}
