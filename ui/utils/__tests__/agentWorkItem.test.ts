import { describe, expect, it } from 'vitest'

import { extractAgentWorkItem } from '../agentWorkItem'
import { normalizeReportedCwd } from '../terminalCwdReporting'

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
