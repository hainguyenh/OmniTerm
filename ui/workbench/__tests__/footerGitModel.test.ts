import { describe, expect, it } from 'vitest'

import { footerContextPath, normalizeDir, rootContaining } from '../footerGitModel'

describe('footerContextPath', () => {
  const base = { editorPath: 'D:/p/a.ts', session: null, defaultFolder: 'D:/default' }

  it('follows the active editor file', () => {
    expect(footerContextPath(base)).toBe('D:/p/a.ts')
  })

  it('follows an active agent to the folder it started in, even outside the workspace', () => {
    expect(footerContextPath({ ...base, session: { launchCwd: 'E:/other/repo', cwd: 'E:/elsewhere' } })).toBe('E:/other/repo')
  })

  it('follows a plain terminal to its current folder', () => {
    expect(footerContextPath({ ...base, session: { cwd: 'D:/p/sub' } })).toBe('D:/p/sub')
  })

  it('falls back to the default project', () => {
    expect(footerContextPath({ editorPath: null, session: null, defaultFolder: 'D:/default' })).toBe('D:/default')
    expect(footerContextPath({ ...base, session: {} })).toBe('D:/default')
  })
})

describe('rootContaining', () => {
  it('picks the innermost repository and ignores slash style and drive case', () => {
    const roots = ['d:/workspace/OmniTerm', 'd:/workspace/OmniTerm/vendor/lib']
    expect(rootContaining(['D:', 'workspace', 'OmniTerm', 'vendor', 'lib', 'src'].join(String.fromCharCode(92)), roots)).toBe(roots[1])
    expect(rootContaining('D:/workspace/OmniTerm/ui', roots)).toBe(roots[0])
    expect(rootContaining('D:/workspace/Other', roots)).toBeNull()
    expect(rootContaining('D:/workspace/OmniTermX', roots)).toBeNull()
  })

  it('normalises trailing slashes', () => {
    expect(normalizeDir(['D:', 'a', 'b', ''].join(String.fromCharCode(92)))).toBe('D:/a/b')
  })
})
