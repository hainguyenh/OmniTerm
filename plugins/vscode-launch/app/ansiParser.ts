export interface AnsiSegment {
  text: string
  className: string
}

const FG_COLOR_CLASSES: Readonly<Record<number, string>> = {
  30: 'text-slate-400',
  31: 'text-theme-error',
  32: 'text-theme-success',
  33: 'text-theme-warning',
  34: 'text-theme-accent',
  35: 'text-purple-400',
  36: 'text-cyan-400',
  37: 'text-theme-fg',
  90: 'text-theme-dim',
  91: 'text-rose-400',
  92: 'text-emerald-400',
  93: 'text-amber-300',
  94: 'text-sky-400',
  95: 'text-fuchsia-400',
  96: 'text-teal-300',
  97: 'text-white',
}

// Strip OSC sequences (`\x1b]...(\x07|\x1b\\)`) and non-SGR CSI sequences (`\x1b[...<letter != m>`).
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const NON_SGR_CSI_RE = /\x1b\[[0-9;?]*[A-LN-Za-ln-z]/g
const ALL_ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;?]*[A-Za-z])/g
const SGR_TOKEN_RE = /\x1b\[([0-9;]*)m/g

export function stripAnsi(text: string): string {
  return text.replace(ALL_ANSI_RE, '')
}

export function parseAnsiSegments(raw: string): AnsiSegment[] {
  const cleaned = raw.replace(OSC_RE, '').replace(NON_SGR_CSI_RE, '')
  const segments: AnsiSegment[] = []

  let bold = false
  let dim = false
  let fgClass = ''
  let lastIndex = 0

  const buildClass = () =>
    [fgClass, bold ? 'font-semibold' : '', dim ? 'opacity-70' : ''].filter(Boolean).join(' ')

  for (const match of cleaned.matchAll(SGR_TOKEN_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ text: cleaned.slice(lastIndex, index), className: buildClass() })
    }
    const codes = (match[1] || '0').split(';').map((part) => Number(part || '0'))
    for (const code of codes) {
      if (code === 0) {
        bold = false
        dim = false
        fgClass = ''
      } else if (code === 1) {
        bold = true
      } else if (code === 2) {
        dim = true
      } else if (code === 22) {
        bold = false
        dim = false
      } else if (code === 39) {
        fgClass = ''
      } else if (FG_COLOR_CLASSES[code]) {
        fgClass = FG_COLOR_CLASSES[code]
      }
    }
    lastIndex = index + match[0].length
  }

  if (lastIndex < cleaned.length) {
    segments.push({ text: cleaned.slice(lastIndex), className: buildClass() })
  }

  return segments.length > 0 ? segments : [{ text: '', className: '' }]
}
