import { describe, expect, it, vi } from 'vitest'

import { extractAgentWorkItem, namesFolder } from '../agentWorkItem'
import { normalizeReportedCwd, registerCwdReporting } from '../terminalCwdReporting'

describe('extractAgentWorkItem', () => {
  it('reads the task Claude Code puts in its title, with or without the spinner', () => {
    expect(extractAgentWorkItem('✳ Fix header status')).toBe('Fix header status')
    expect(extractAgentWorkItem('⠐ Fix header status')).toBe('Fix header status')
    expect(extractAgentWorkItem('✶ Resume after crash')).toBe('Resume after crash')
  })

  it('is not a work item when the title only names the agent', () => {
    expect(extractAgentWorkItem('✳ Claude Code')).toBeUndefined()
    expect(extractAgentWorkItem('Claude Code - OmniTerm')).toBeUndefined()
    expect(extractAgentWorkItem('codex')).toBeUndefined()
  })

  it('is not a work item when the title is a shell or a path', () => {
    expect(extractAgentWorkItem('pwsh')).toBeUndefined()
    expect(extractAgentWorkItem('C:\\WINDOWS\\system32\\cmd.exe')).toBeUndefined()
    expect(extractAgentWorkItem('D:\\workspace\\OmniTerm')).toBeUndefined()
    expect(extractAgentWorkItem('~/src/app')).toBeUndefined()
  })

  it('keeps a task that merely mentions an agent', () => {
    expect(extractAgentWorkItem('✳ Fix claude login')).toBe('Fix claude login')
  })

  it('truncates very long titles', () => {
    const long = `✳ ${'x'.repeat(300)}`
    expect(extractAgentWorkItem(long)?.length).toBe(120)
  })

  it('handles empty input', () => {
    expect(extractAgentWorkItem(undefined)).toBeUndefined()
    expect(extractAgentWorkItem('   ')).toBeUndefined()
  })
})

describe('namesFolder', () => {
  it('matches a work item that is only the folder name, from a label or a full path', () => {
    expect(namesFolder('OmniTerm', ['omniterm'])).toBe(true)
    expect(namesFolder('repo', [undefined, 'D:\\work\\repo\\'])).toBe(true)
    expect(namesFolder('repo', ['/home/me/repo'])).toBe(true)
  })

  it('keeps a real task and ignores missing folders', () => {
    expect(namesFolder('Fix header status', ['repo', 'D:/repo'])).toBe(false)
    expect(namesFolder('repo', [undefined, ''])).toBe(false)
  })
})

describe('normalizeReportedCwd', () => {
  it('turns an OSC 7 Windows URL into a drive path (regression)', () => {
    expect(normalizeReportedCwd('file://HOST/C:/Users/me/repo')).toBe('C:/Users/me/repo')
    expect(normalizeReportedCwd('file:///D:/')).toBe('D:/')
  })

  it('keeps POSIX and plain paths, decoding escapes', () => {
    expect(normalizeReportedCwd('file://host/home/me/my%20repo')).toBe('/home/me/my repo')
    expect(normalizeReportedCwd('C:\\repo')).toBe('C:\\repo')
  })

  it('takes a malformed escape verbatim instead of throwing', () => {
    expect(normalizeReportedCwd('C:/100%/x')).toBe('C:/100%/x')
  })
})

describe('registerCwdReporting', () => {
  it('does nothing when the terminal parser or callback is unavailable', () => {
    expect(registerCwdReporting({} as never)).toEqual([])
    expect(registerCwdReporting({ parser: {} } as never, undefined)).toEqual([])
  })

  it('registers OSC 7 and OSC 9;9 handlers and normalizes their payloads', () => {
    const handlers = new Map<number, (data: string) => boolean | Promise<boolean>>()
    const dispose7 = { dispose: vi.fn() }
    const dispose9 = { dispose: vi.fn() }
    const registerOscHandler = vi.fn((ident: number, callback: (data: string) => boolean | Promise<boolean>) => {
      handlers.set(ident, callback)
      return ident === 7 ? dispose7 : dispose9
    })
    const onCwdChange = vi.fn()
    const term = { parser: { registerOscHandler } }

    const disposables = registerCwdReporting(term as never, onCwdChange)

    expect(disposables).toEqual([dispose7, dispose9])
    expect(registerOscHandler).toHaveBeenCalledWith(7, expect.any(Function))
    expect(registerOscHandler).toHaveBeenCalledWith(9, expect.any(Function))
    expect(handlers.get(7)?.('   ')).toBe(true)
    expect(handlers.get(7)?.('file://host/C:/repo')).toBe(false)
    expect(handlers.get(9)?.('not-a-cwd')).toBe(false)
    expect(handlers.get(9)?.('9;"C:/repo/my%20project"')).toBe(false)
    expect(handlers.get(9)?.('9;   ')).toBe(true)
    expect(onCwdChange).toHaveBeenNthCalledWith(1, 'C:/repo')
    expect(onCwdChange).toHaveBeenNthCalledWith(2, 'C:/repo/my project')
  })

  it('ignores a file URL without a path after the host', () => {
    const callback = vi.fn()
    const registerOscHandler = vi.fn((_ident: number, handler: (data: string) => boolean) => ({
      dispose: vi.fn(),
      handler,
    }))
    const term = { parser: { registerOscHandler } }

    registerCwdReporting(term as never, callback)
    const osc7 = registerOscHandler.mock.results[0]?.value.handler as (data: string) => boolean

    expect(osc7('file://host')).toBe(false)
    expect(callback).not.toHaveBeenCalled()
  })
})
