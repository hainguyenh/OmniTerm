/**
 * A deliberately tiny syntax highlighter for the script viewer/editor. It is not a full lexer — it
 * colors the handful of things that make a script readable at a glance: comments, quoted strings,
 * variables, numbers, and a small set of per-language keywords. Dependency-free (no Prism/Monaco).
 */

export type TokenType = 'comment' | 'string' | 'keyword' | 'variable' | 'number' | 'text'
export interface Token {
  text: string
  type: TokenType
}

/** Keyword sets per kind. Batch/PowerShell match case-insensitively; shell is case-sensitive. */
const KEYWORDS: Record<string, { words: Set<string>; ci: boolean }> = {
  sh: {
    ci: false,
    words: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
      'case', 'esac', 'in', 'function', 'return', 'echo', 'export', 'local', 'set', 'unset',
      'read', 'source', 'exit', 'cd', 'test']),
  },
  ps1: {
    ci: true,
    words: new Set(['if', 'else', 'elseif', 'switch', 'foreach', 'for', 'while', 'do', 'until',
      'function', 'param', 'return', 'try', 'catch', 'finally', 'throw', 'begin', 'process',
      'end', 'write-host', 'write-output', 'write-error', 'set-location', 'get-childitem']),
  },
  bat: {
    ci: true,
    words: new Set(['echo', 'set', 'setlocal', 'endlocal', 'if', 'else', 'for', 'in', 'do',
      'goto', 'call', 'exit', 'start', 'pause', 'cd', 'pushd', 'popd', 'shift', 'not',
      'exist', 'defined', 'errorlevel']),
  },
}

function isBatchComment(trimmed: string): boolean {
  return /^rem(\s|$)/i.test(trimmed) || trimmed.startsWith('::')
}

function hasHashComment(kind: string): boolean {
  return kind === 'sh' || kind === 'ps1'
}

function keywordType(word: string, kind: string): boolean {
  const set = KEYWORDS[kind === 'cmd' ? 'bat' : kind]
  if (!set) return false
  return set.words.has(set.ci ? word.toLowerCase() : word)
}

/** Split a plain (non-string, non-comment) run into keyword/variable/number/text tokens. */
function refineText(text: string, kind: string): Token[] {
  const out: Token[] = []
  let plain = ''
  const flushPlain = () => { if (plain) { out.push({ text: plain, type: 'text' }); plain = '' } }

  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    // Variables: $x / ${x} for sh & ps1; %x% / %x for batch.
    const varMatch = (kind === 'bat' || kind === 'cmd')
      ? /^%[A-Za-z0-9_]+%?/.exec(rest)
      : /^\$\{?[A-Za-z0-9_]+\}?/.exec(rest)
    if (varMatch) {
      flushPlain()
      out.push({ text: varMatch[0], type: 'variable' })
      i += varMatch[0].length
      continue
    }
    // Words → keyword or plain. Only start a word on a non-word boundary.
    const wordMatch = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest)
    if (wordMatch && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
      const w = wordMatch[0]
      if (keywordType(w, kind)) { flushPlain(); out.push({ text: w, type: 'keyword' }) }
      else plain += w
      i += w.length
      continue
    }
    // Numbers (standalone, not part of an identifier).
    const numMatch = /^\d+/.exec(rest)
    if (numMatch && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
      flushPlain()
      out.push({ text: numMatch[0], type: 'number' })
      i += numMatch[0].length
      continue
    }
    plain += text[i]
    i += 1
  }
  flushPlain()
  return out
}

/**
 * Kinds this tokenizer actually knows. Everything else renders as plain text.
 *
 * The viewer opens any text file now, and the rules below are written for shell syntax — applied to
 * prose they actively mislead: the apostrophe in "don't" opens a string that colors the rest of the
 * line, and `$5` in a README reads as a variable. Guessing wrong is worse than not coloring, so an
 * unknown kind gets one plain token per line and stays legible.
 */
const HIGHLIGHTED_KINDS = new Set(['bat', 'cmd', 'ps1', 'sh'])

/** Tokenize a single line into colored segments. */
export function highlightLine(line: string, kind: string): Token[] {
  if (!HIGHLIGHTED_KINDS.has(kind)) {
    return line ? [{ text: line, type: 'text' }] : []
  }
  if ((kind === 'bat' || kind === 'cmd') && isBatchComment(line.trimStart())) {
    return [{ text: line, type: 'comment' }]
  }

  const tokens: Token[] = []
  let buf = ''
  let inString: string | null = null

  const flushText = () => { if (buf) { tokens.push(...refineText(buf, kind)); buf = '' } }

  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inString) {
      buf += c
      if (c === inString) { tokens.push({ text: buf, type: 'string' }); buf = ''; inString = null }
      continue
    }
    if (hasHashComment(kind) && c === '#') {
      flushText()
      tokens.push({ text: line.slice(i), type: 'comment' })
      return tokens
    }
    if (c === '"' || c === "'") {
      flushText()
      inString = c
      buf = c
      continue
    }
    buf += c
  }
  // An unterminated string still colors as a string; otherwise refine as plain text.
  if (inString) tokens.push({ text: buf, type: 'string' })
  else flushText()
  return tokens
}

/** Tokenize a whole document into an array of per-line token arrays. */
export function highlightLines(text: string, kind: string): Token[][] {
  return text.split('\n').map((line) => highlightLine(line, kind))
}
