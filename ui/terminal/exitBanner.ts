const ESC = '\u001b'
const WARNING = `${ESC}[33m`
const BOLD = `${ESC}[1m`
const NOT_BOLD = `${ESC}[22m`
const RESET = `${ESC}[0m`

/**
 * The line a terminal prints when its process exited right after a single Ctrl+C: the tab stays
 * and offers a restart (`.exitline` UI styling). It is written in the theme's
 * warning colour (ANSI yellow) with the two keys in bold, on a line of its own.
 */
export function exitBannerText(code: number): string {
  return `\r\n${WARNING}[process exited (code ${code}) — press ${BOLD}Enter${NOT_BOLD} to restart, ${BOLD}Ctrl+C${NOT_BOLD} again to close]${RESET}\r\n`
}
