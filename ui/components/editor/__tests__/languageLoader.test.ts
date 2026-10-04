import { highlightTree, classHighlighter } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'

import { batch } from '../batchLanguage'
import { languageLabel, loadLanguage, resolveLanguageId, type LanguageId } from '../languageLoader'

describe('resolveLanguageId', () => {
  it.each([
    ['app.ts', 'typescript'], ['view.tsx', 'tsx'], ['index.mjs', 'javascript'], ['a.jsx', 'jsx'],
    ['main.py', 'python'], ['Program.cs', 'csharp'], ['lib.rs', 'rust'], ['App.java', 'java'],
    ['build.gradle', 'kotlin'], ['page.html', 'html'], ['site.css', 'css'], ['theme.scss', 'scss'],
    ['vars.less', 'less'], ['README.md', 'markdown'], ['app.properties', 'properties'],
    ['Cargo.toml', 'toml'], ['package.json', 'json'], ['ci.yml', 'yaml'], ['App.csproj', 'xml'],
    ['query.sql', 'sql'], ['run.sh', 'shell'], ['deploy.ps1', 'powershell'], ['build.CMD', 'batch'],
    ['main.go', 'go'], ['util.h', 'c'], ['main.cpp', 'cpp'], ['.env', 'properties'], ['.bashrc', 'shell'],
    ['Dockerfile', 'plaintext'], ['notes.txt', 'plaintext'],
  ])('%s → %s', (name, id) => {
    expect(resolveLanguageId(name)).toBe(id)
  })

  it('labels every language for the status bar', () => {
    expect(languageLabel('csharp')).toBe('C#')
    expect(languageLabel('plaintext')).toBe('Plain Text')
  })
})

describe('loadLanguage', () => {
  const ids: LanguageId[] = [
    'javascript', 'jsx', 'typescript', 'tsx', 'python', 'csharp', 'rust', 'java', 'kotlin', 'html', 'css',
    'scss', 'less', 'markdown', 'properties', 'toml', 'json', 'yaml', 'xml', 'sql', 'shell', 'powershell',
    'batch', 'go', 'c', 'cpp',
  ]

  it.each(ids)('loads %s', async (id) => {
    const extension = await loadLanguage(id)
    expect(extension).toBeTruthy()
    // The same promise is shared by every tab using the language.
    expect(loadLanguage(id)).toBe(loadLanguage(id))
  })

  it('treats plain text as no extension', async () => {
    await expect(loadLanguage('plaintext')).resolves.toEqual([])
  })
})

describe('batch language', () => {
  const classes = (source: string) => {
    const found: string[] = []
    const tree = batch.parser.parse(source)
    highlightTree(tree, classHighlighter, (from, to, cls) => found.push(`${source.slice(from, to)}=${cls}`))
    return found
  }

  it('highlights comments, labels, variables, strings, numbers and keywords', () => {
    const out = classes('REM hello\n:: note\n:start\n  echo %NAME% "quoted" 42 %%i %1 plain\n')
    expect(out).toContain('REM hello=tok-comment')
    expect(out).toContain(':: note=tok-comment')
    expect(out).toContain(':start=tok-labelName')
    expect(out).toContain('echo=tok-keyword')
    expect(out).toContain('%NAME%=tok-variableName')
    expect(out).toContain('"quoted"=tok-string')
    expect(out).toContain('42=tok-number')
    expect(out).toContain('%%i=tok-variableName')
    expect(out).toContain('%1=tok-variableName')
    expect(out.some((entry) => entry.startsWith('plain='))).toBe(false)
  })
})
