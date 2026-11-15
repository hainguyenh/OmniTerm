import { create } from 'zustand'

/** Whether the Clean Up Sessions dialog is open (the Sessions header button opens it). */
export const useSessionCleanup = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
