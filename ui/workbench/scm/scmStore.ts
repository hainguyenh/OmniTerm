import { create } from 'zustand'

/** Commit message being typed per repository root, and which sections are folded. */
export const useScmDrafts = create<{
  messages: Record<string, string>
  folded: Record<string, boolean>
  busy: string | null
  setMessage: (root: string, message: string) => void
  toggleFolded: (root: string) => void
  setBusy: (root: string | null) => void
}>((set) => ({
  messages: {},
  folded: {},
  busy: null,
  setMessage: (root, message) => set((state) => ({ messages: { ...state.messages, [root]: message } })),
  toggleFolded: (root) => set((state) => ({ folded: { ...state.folded, [root]: !state.folded[root] } })),
  setBusy: (busy) => set({ busy }),
}))
