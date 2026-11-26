/**
 * Which keys pick "Yes, trust" in an agent's folder-trust dialog. Older dialogs number their options
 * (`❯ 1. Yes, proceed`, `[1] Yes, trust this folder`) and take the digit; newer Claude dialogs list
 * bare options with the cursor on the first one — `❯ No, exit` above `Yes, I trust this folder` —
 * so an Enter there would exit the agent. Those are walked with the arrow keys instead, and the
 * caller confirms only once the cursor is seen on the Yes option.
 */

export type TrustAnswer = { kind: 'number'; key: string } | { kind: 'arrows'; moves: number }

const NUMBERED = /^[\s│┃|]*(?:[❯›]\s*)?(?:(\d+)[.)]|\[(\d+)\])\s+(\S.*?)[\s│┃|]*$/
const SELECTED = /^([\s│┃|]*)[❯›]\s*/
const LEADING = /^[\s│┃|]*/

function isYes(text: string): boolean {
  return /^yes\b/i.test(text) && !/\bexit\b/i.test(text)
}

function numberedYes(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = NUMBERED.exec(lines[i])
    if (match && isYes(match[3])) return match[1] ?? match[2]
  }
  return null
}

/**
 * The options listed with the selected one: lines whose text starts in the selected option's text
 * column. Deeper-indented lines (an option's description) are skipped; a blank line or anything
 * less indented (the title, the `Enter to confirm` hint) ends the list.
 */
function optionsAround(lines: readonly string[], selectedIdx: number, column: number): { texts: string[]; selected: number } {
  const optionText = (line: string): string | null => {
    const lead = LEADING.exec(line)?.[0].length ?? 0
    return lead === column && !SELECTED.test(line) ? line.slice(lead).trim() : null
  }
  const within = (line: string) => line.trim() !== '' && (LEADING.exec(line)?.[0].length ?? 0) >= column
  const above: string[] = []
  for (let i = selectedIdx - 1; i >= 0 && within(lines[i]); i -= 1) {
    const text = optionText(lines[i])
    if (text !== null) above.unshift(text)
  }
  const below: string[] = []
  for (let i = selectedIdx + 1; i < lines.length && within(lines[i]); i += 1) {
    const text = optionText(lines[i])
    if (text !== null) below.push(text)
  }
  const selectedText = lines[selectedIdx].slice(column).trim()
  return { texts: [...above, selectedText, ...below], selected: above.length }
}

/** How to answer the trust dialog on screen with Yes; null when no Yes option can be found. */
export function planTrustAnswer(lines: readonly string[]): TrustAnswer | null {
  const key = numberedYes(lines)
  if (key) return { kind: 'number', key }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = SELECTED.exec(lines[i])
    if (!match) continue
    const { texts, selected } = optionsAround(lines, i, match[0].length)
    const yes = texts.findIndex(isYes)
    return yes === -1 ? null : { kind: 'arrows', moves: yes - selected }
  }
  return null
}
