/**
 * Briefly holding a pane's keyboard input while something else drives it (the inline `/usage`
 * probe at an agent's first launch). Keystrokes typed during the hold are buffered and delivered,
 * in order, when it is released — nothing the user types is lost or interleaved with the probe.
 *
 * Replies the terminal sends on its own (cursor-position and device-attribute reports, mode and
 * keyboard-protocol reports, window-size reports, OSC colour replies, focus in/out) always pass
 * through: the agent may be waiting on them, and they are not the user typing. They also don't
 * count as user input for `lastUserInputAt` — an agent that starts slowly (several resuming at
 * once) asks these after the launch grace, and counting its own DECRQM reply as typing made the
 * probe decline every agent but the first.
 *
 * Keystrokes buffered by a hold don't count either: they have not reached the agent yet.
 */

const held = new Map<string, string[]>()
const lastUserInput = new Map<string, number>()

/**
 * One reply: CSI … R/c/n/t reports, DECRQM mode reports (CSI ? … $ y), the kitty keyboard-flags
 * reply (CSI ? flags u — a key event never carries the `?`), CSI I/O focus events, and OSC / DCS
 * replies (the last one possibly cut off at the end of the chunk). xterm may send several at once.
 */
const REPLY = /\x1b\[[\d;?>=]*[Rcnt]|\x1b\[\??[\d;]*\$y|\x1b\[\?\d*u|\x1b\[[IO]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)|\x1bP[\s\S]*?(?:\x1b\\|$)/
const AUTOMATIC_REPLY = new RegExp(`^(?:${REPLY.source})+$`)

export function isAutomaticTerminalReply(data: string): boolean {
  return AUTOMATIC_REPLY.test(data)
}

/**
 * Called by the pane for every input chunk. Returns true when the chunk was taken (buffered),
 * false when the pane should send it as usual.
 */
export function interceptPaneInput(sessionId: string, data: string, now = Date.now()): boolean {
  if (isAutomaticTerminalReply(data)) return false
  const buffer = held.get(sessionId)
  if (buffer) {
    buffer.push(data)
    return true
  }
  lastUserInput.set(sessionId, now)
  return false
}

/** When the user last typed into this pane (ms), if ever; keys held back by a hold don't count. */
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
