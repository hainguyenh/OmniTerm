import { create } from 'zustand'

/** Whether the Clean Temp Files dialog is open (the Sessions header button opens it). */
export const useTempCleanup = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
