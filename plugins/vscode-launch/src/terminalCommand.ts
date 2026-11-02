const SAFE_BARE_TOKEN_RE = /^[A-Za-z0-9_./:\\=-]+$/

function quotePowerShellToken(arg: string): { quoted: string; wasQuoted: boolean } {
  if (arg.length === 0) return { quoted: "''", wasQuoted: true }
  if (SAFE_BARE_TOKEN_RE.test(arg)) return { quoted: arg, wasQuoted: false }
  return { quoted: `'${arg.replace(/'/g, "''")}'`, wasQuoted: true }
}

function quotePosixToken(arg: string): string {
  if (arg.length === 0) return "''"
  if (SAFE_BARE_TOKEN_RE.test(arg)) return arg
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export function formatTerminalCommand(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    const isCmd = /\.(?:cmd|bat)$/i.test(command)
    if (isCmd) {
      const parts = [command, ...args].map((part) => (SAFE_BARE_TOKEN_RE.test(part) ? part : `"${part}"`))
      return parts.join(' ')
    }
    const qCommand = quotePowerShellToken(command)
    const qArgs = args.map(quotePowerShellToken)
    if (qCommand.wasQuoted) {
      return `& ${qCommand.quoted}${qArgs.length > 0 ? ` ${qArgs.map((a) => a.quoted).join(' ')}` : ''}`
    }
    return [qCommand.quoted, ...qArgs.map((a) => a.quoted)].join(' ')
  }

  const parts = [command, ...args].map(quotePosixToken)
  return parts.join(' ')
}
