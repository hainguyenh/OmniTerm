import { beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.fn()
vi.mock('../../../diag', () => ({ diag: { warn: (...args: unknown[]) => warn(...args) } }))
let failSql = true
vi.mock('@codemirror/lang-sql', () => ({
  sql: () => {
    if (failSql) throw new Error('chunk failed')
    return ['sql-extension']
  },
}))

import { loadLanguage } from '../languageLoader'

describe('loadLanguage failures', () => {
  beforeEach(() => warn.mockClear())

  it('degrades to plain text, reports it, and retries on the next open', async () => {
    await expect(loadLanguage('sql')).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('language failed'), 'sql', expect.any(Error))
    failSql = false
    await expect(loadLanguage('sql')).resolves.toEqual(['sql-extension'])
  })
})
