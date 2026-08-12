import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

const PLAIN_URL_RE = /\bhttps?:\/\/[^\s<>'"`]+/gi
const TRAILING_URL_PUNCTUATION_RE = /[),.;:!?\]}]+$/

/**
 * Keep terminal links deliberately narrow. Output is untrusted: only HTTP(S) URLs without
 * credentials or control/whitespace characters may leave the application.
 */
export const safeHttpUrl = (value: string): URL | null => {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || !url.hostname) return null
    return url
  } catch {
    return null
  }
}

const isMac = (): boolean => /Mac/i.test(navigator.platform || navigator.userAgent)

/** Open a validated link only from the platform's normal terminal-link modifier click. */
export const activateTerminalLink = (event: MouseEvent, text: string): void => {
  if (isMac() ? !event.metaKey : !event.ctrlKey) return
  const url = safeHttpUrl(text)
  if (!url) return
  window.open(url.href, '_blank', 'noopener,noreferrer')
}

const plainUrlsOnLine = (text: string, y: number): ILink[] => {
  const links: ILink[] = []
  for (const match of text.matchAll(PLAIN_URL_RE)) {
    const raw = match[0]
    const trimmed = raw.replace(TRAILING_URL_PUNCTUATION_RE, '')
    if (!trimmed) continue
    const start = match.index ?? 0
    const end = start + trimmed.length
    if (!safeHttpUrl(trimmed)) continue
    links.push({
      text: trimmed,
      range: {
        start: { x: start + 1, y },
        end: { x: end + 1, y },
      },
      activate: activateTerminalLink,
    })
  }
  return links
}

/** Register plain URL linkification; xterm's built-in provider continues to handle OSC 8 links. */
export const registerPlainUrlLinks = (term: Terminal) => {
  const provider: ILinkProvider = {
    provideLinks: (bufferLineNumber, callback) => {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      callback(line ? plainUrlsOnLine(line.translateToString(true), bufferLineNumber) : undefined)
    },
  }
  if (typeof term.registerLinkProvider !== 'function') return { dispose: () => {} }
  return term.registerLinkProvider(provider)
}
