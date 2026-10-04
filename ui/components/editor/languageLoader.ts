import type { StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

import { diag } from '../../diag'
import { extensionOf } from './editorFileKinds'

/**
 * File name → syntax support, loaded on demand.
 *
 * Every grammar is a dynamic import, so a session that never opens a Rust file never downloads the
 * Rust parser, and the editor's startup cost does not grow with the language list. Each language is
 * loaded once and shared by every tab that uses it.
 */

export type LanguageId =
  | 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'python' | 'csharp' | 'rust' | 'java' | 'kotlin'
  | 'html' | 'css' | 'scss' | 'less' | 'markdown' | 'properties' | 'toml' | 'json' | 'yaml' | 'xml'
  | 'sql' | 'shell' | 'powershell' | 'batch' | 'go' | 'c' | 'cpp' | 'plaintext'

const BY_EXT: Record<string, LanguageId> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'tsx',
  py: 'python', pyi: 'python', pyw: 'python',
  cs: 'csharp', csx: 'csharp',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin', gradle: 'kotlin',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', xhtml: 'html',
  css: 'css',
  scss: 'scss', sass: 'scss',
  less: 'less',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  properties: 'properties', ini: 'properties', cfg: 'properties', conf: 'properties',
  env: 'properties', editorconfig: 'properties', gitconfig: 'properties',
  toml: 'toml',
  json: 'json', jsonc: 'json', json5: 'json', geojson: 'json', 'code-workspace': 'json', map: 'json',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', svg: 'xml', csproj: 'xml', vbproj: 'xml',
  fsproj: 'xml', props: 'xml', targets: 'xml', config: 'xml', plist: 'xml', resx: 'xml', xaml: 'xml',
  sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'batch', cmd: 'batch',
  go: 'go',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp',
}

/** Extensionless names that still have a well-known syntax. */
const BY_NAME: Record<string, LanguageId> = {
  '.env': 'properties',
  '.editorconfig': 'properties',
  '.gitconfig': 'properties',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
}

/** Resolve from the file *name*: the scan's `kind` folds `.cmd` into `bat` and reports `file` for
 *  extensionless names, neither of which says enough about syntax. */
export function resolveLanguageId(fileName: string): LanguageId {
  const lower = fileName.toLowerCase()
  return BY_NAME[lower] ?? BY_EXT[extensionOf(lower)] ?? 'plaintext'
}

type Loader = () => Promise<Extension>

/** A CodeMirror 5–style stream parser from legacy-modes, wrapped as a CM6 language. */
const legacy = async (load: () => Promise<StreamParser<unknown>>): Promise<Extension> => {
  const [{ StreamLanguage }, parser] = await Promise.all([import('@codemirror/language'), load()])
  return StreamLanguage.define(parser)
}

const LOADERS: Record<Exclude<LanguageId, 'plaintext'>, Loader> = {
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  jsx: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  tsx: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }),
  python: async () => (await import('@codemirror/lang-python')).python(),
  csharp: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  java: async () => (await import('@codemirror/lang-java')).java(),
  kotlin: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin),
  // No auto-close tags: the editor offers no completions or typing assists beyond indentation.
  html: async () => (await import('@codemirror/lang-html')).html({ autoCloseTags: false }),
  css: async () => (await import('@codemirror/lang-css')).css(),
  scss: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/css')).sCSS),
  less: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/css')).less),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  properties: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties),
  toml: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml),
  json: async () => (await import('@codemirror/lang-json')).json(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  xml: async () => (await import('@codemirror/lang-xml')).xml({ autoCloseTags: false }),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  shell: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
  powershell: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/powershell')).powerShell),
  batch: async () => (await import('./batchLanguage')).batch,
  go: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/go')).go),
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
}

const cache = new Map<LanguageId, Promise<Extension>>()

/**
 * The syntax extension for `id`, or an empty extension for plain text. A grammar chunk that fails to
 * load (a stale build after an update, say) degrades to plain text instead of breaking the editor,
 * and is dropped from the cache so the next open retries it.
 */
export function loadLanguage(id: LanguageId): Promise<Extension> {
  if (id === 'plaintext') return Promise.resolve([])
  const cached = cache.get(id)
  if (cached) return cached
  const pending = LOADERS[id]().catch((error: unknown) => {
    cache.delete(id)
    diag.warn('[editor] language failed to load, using plain text:', id, error)
    return [] as Extension
  })
  cache.set(id, pending)
  return pending
}

const LABELS: Partial<Record<LanguageId, string>> = {
  javascript: 'JavaScript', jsx: 'JavaScript JSX', typescript: 'TypeScript', tsx: 'TypeScript JSX',
  python: 'Python', csharp: 'C#', rust: 'Rust', java: 'Java', kotlin: 'Kotlin', html: 'HTML',
  css: 'CSS', scss: 'SCSS', less: 'Less', markdown: 'Markdown', properties: 'Properties',
  toml: 'TOML', json: 'JSON', yaml: 'YAML', xml: 'XML', sql: 'SQL', shell: 'Shell',
  powershell: 'PowerShell', batch: 'Batch', go: 'Go', c: 'C', cpp: 'C++',
}

/** Human label for the status bar. */
export function languageLabel(id: LanguageId): string {
  return LABELS[id] ?? 'Plain Text'
}
