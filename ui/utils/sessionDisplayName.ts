/**
 * The label a session shows. Shells such as pwsh set their window title to the full path of their
 * executable (`C:\Program Files\PowerShell\7\pwsh.exe`); that becomes the program name (`pwsh`). Any
 * other title is shown as it is.
 */
const EXECUTABLE = /\.(exe|cmd|bat|com)$/i
const SEPARATOR = /[\\/]/
const ABSOLUTE = /^([A-Za-z]:[\\/]|\/)/

export function sessionDisplayName(name: string): string {
  const trimmed = name.trim()
  if (!SEPARATOR.test(trimmed)) return trimmed
  // Only a path to a program is shortened; "user@host: ~/src" style titles keep their path.
  if (!ABSOLUTE.test(trimmed)) return trimmed
  const base = trimmed.split(SEPARATOR).filter(Boolean).pop() ?? trimmed
  return base.replace(EXECUTABLE, '') || trimmed
}
