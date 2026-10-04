import { StreamLanguage, type StringStream } from '@codemirror/language'

/**
 * Windows batch (`.bat`/`.cmd`) highlighting. `@codemirror/legacy-modes` has no batch mode; this is
 * the tokenizer the old viewer used, as a stream parser: `REM`/`::` comments, `%var%` and `%%i`
 * variables, `:label` lines, quoted strings and the common keywords.
 */
const KEYWORDS = new Set([
  'echo', 'set', 'setlocal', 'endlocal', 'if', 'else', 'for', 'in', 'do', 'goto', 'call', 'exit',
  'start', 'pause', 'cd', 'pushd', 'popd', 'shift', 'not', 'exist', 'defined', 'errorlevel',
])

function token(stream: StringStream): string | null {
  if (stream.sol()) {
    if (stream.match(/^\s*(rem(\s|$)|::)/i)) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^\s*:[A-Za-z0-9_.-]+/)) return 'labelName'
  }
  if (stream.eatSpace()) return null
  if (stream.match(/^%%~?[A-Za-z]/) || stream.match(/^%~?[0-9*]/) || stream.match(/^%[A-Za-z0-9_]+%/)) {
    return 'variableName'
  }
  if (stream.match(/^"[^"]*"?/)) return 'string'
  if (stream.match(/^\d+\b/)) return 'number'
  const word = stream.match(/^[A-Za-z_][\w-]*/)
  if (word && Array.isArray(word)) return KEYWORDS.has(word[0].toLowerCase()) ? 'keyword' : null
  stream.next()
  return null
}

export const batch = StreamLanguage.define({
  name: 'batch',
  token,
  languageData: { commentTokens: { line: 'REM' } },
})
