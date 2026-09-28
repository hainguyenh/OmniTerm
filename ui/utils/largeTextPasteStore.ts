/**
 * Per-session request store for large text paste confirmations.
 *
 * When large text (between 1,000 and 3,000 characters) is pasted into an AI agent pane,
 * this store holds the pending decision request so a modal dialog can ask the user whether
 * to attach it as a document (preferred for agents) or paste it directly.
 */

export interface LargeTextPasteRequest {
  id: string
  sessionId: string
  charCount: number
  lineCount: number
  preview: string
  resolve: (decision: 'attach' | 'paste' | 'cancel') => void
}

type Listener = () => void

let activeRequest: LargeTextPasteRequest | null = null
const listeners = new Set<Listener>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

export const subscribeLargeTextPaste = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getLargeTextPasteRequest = (): LargeTextPasteRequest | null => activeRequest

export const requestLargeTextPasteDecision = (
  sessionId: string,
  _text: string,
  charCount: number,
  lineCount: number,
  preview: string,
): Promise<'attach' | 'paste' | 'cancel'> => {
  if (listeners.size === 0) {
    return Promise.resolve('paste')
  }

  if (activeRequest) {
    activeRequest.resolve('cancel')
    activeRequest = null
  }

  return new Promise((resolve) => {
    activeRequest = {
      id: `${sessionId}-${Date.now()}`,
      sessionId,
      charCount,
      lineCount,
      preview,
      resolve: (decision) => {
        activeRequest = null
        notify()
        resolve(decision)
      },
    }
    notify()
  })
}

export const resolveLargeTextPaste = (decision: 'attach' | 'paste' | 'cancel'): void => {
  if (!activeRequest) return
  activeRequest.resolve(decision)
}

export const cancelLargeTextPasteForSession = (sessionId: string): void => {
  if (activeRequest && activeRequest.sessionId === sessionId) {
    activeRequest.resolve('cancel')
  }
}
