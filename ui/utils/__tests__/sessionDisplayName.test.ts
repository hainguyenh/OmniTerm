import { describe, expect, it } from 'vitest'

import { sessionDisplayName } from '../sessionDisplayName'

describe('sessionDisplayName', () => {
  it('shortens an executable path to the program name', () => {
    expect(sessionDisplayName('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(sessionDisplayName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
    expect(sessionDisplayName('/usr/bin/bash')).toBe('bash')
  })

  it('keeps titles that are not a program path', () => {
    expect(sessionDisplayName('claude')).toBe('claude')
    expect(sessionDisplayName('codex — port plan')).toBe('codex — port plan')
    expect(sessionDisplayName('user@prod-api: ~/src/app')).toBe('user@prod-api: ~/src/app')
    expect(sessionDisplayName('  pwsh  ')).toBe('pwsh')
  })
})
