/**
 * @vitest-environment jsdom
 */
import type { ILinkProvider, Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { activateTerminalLink, registerPlainUrlLinks, safeHttpUrl } from '../terminalLinks'

describe('terminalLinks', () => {
  it('accepts only credential-free HTTP(S) URLs', () => {
    expect(safeHttpUrl('https://example.test/path')?.protocol).toBe('https:')
    expect(safeHttpUrl('file:///tmp/secret')).toBeNull()
    expect(safeHttpUrl('https://user:pass@example.test')).toBeNull()
    expect(safeHttpUrl('https://example.test/has space')).toBeNull()
  })

  it('requires the platform modifier before opening a link', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const event = new MouseEvent('click', { ctrlKey: true })

    activateTerminalLink(event, 'https://example.test/docs')
    activateTerminalLink(new MouseEvent('click'), 'https://example.test/nope')

    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('https://example.test/docs', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('linkifies plain URLs and trims sentence punctuation', () => {
    let provider: ILinkProvider | undefined
    const terminal = {
      buffer: { active: { getLine: vi.fn(() => ({ translateToString: () => 'See https://example.test/docs).' })) } },
      registerLinkProvider: vi.fn((next: ILinkProvider) => {
        provider = next
        return { dispose: vi.fn() }
      }),
    } as unknown as Terminal

    registerPlainUrlLinks(terminal)
    const callback = vi.fn()
    provider?.provideLinks(1, callback)

    expect(callback).toHaveBeenCalledWith([expect.objectContaining({
      text: 'https://example.test/docs',
      range: { start: { x: 5, y: 1 }, end: { x: 30, y: 1 } },
    })])
  })
})
