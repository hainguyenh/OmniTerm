/**
 * Briefly holding a pane's keyboard input while something else drives it (the inline `/usage`
 * probe at an agent's first launch). Keystrokes typed during the hold are buffered and delivered,
 * in order, when it is released — nothing the user types is lost or interleaved with the probe.
 *
 * Replies the terminal sends on its own (cursor-position and device-attribute reports, OSC colour
 * replies, focus in/out) always pass through: the agent may be waiting on them, and they are not
 * the user typing. They also don't count as user input for `lastUserInputAt`.
 */

const held = new Map<string, string[]>()
const lastUserInput = new Map<string, number>()

/** CSI … R/c/n reports, CSI I/O focus events, and OSC / DCS replies. */
const AUTOMATIC_REPLY = /^(?:\x1b\[[\d;?>=]*[Rcn]|\x1b\[[IO]|\x1b\][\s\S]*|\x1bP[\s\S]*)$/

export function isAutomaticTerminalReply(data: string): boolean {
  return AUTOMATIC_REPLY.test(data)
}

/**
 * Called by the pane for every input chunk. Returns true when the chunk was taken (buffered),
 * false when the pane should send it as usual.
 */
export function interceptPaneInput(sessionId: string, data: string, now = Date.now()): boolean {
  if (isAutomaticTerminalReply(data)) return false
  lastUserInput.set(sessionId, now)
  const buffer = held.get(sessionId)
  if (!buffer) return false
  buffer.push(data)
  return true
}

/** When the user last typed into this pane (ms), if ever. */
export function lastUserInputAt(sessionId: string): number | undefined {
  return lastUserInput.get(sessionId)
}

/**
 * Start holding input. The returned release ends the hold and hands back what was typed during
 * it, for the caller to send once it is done with the pane.
 */
export function holdPaneInput(sessionId: string): () => string {
  const buffer: string[] = []
  held.set(sessionId, buffer)
  return () => {
    if (held.get(sessionId) === buffer) held.delete(sessionId)
    return buffer.join('')
  }
}

export function resetPaneInputHoldForTests(): void {
  held.clear()
  lastUserInput.clear()
}
