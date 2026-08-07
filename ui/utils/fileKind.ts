import {
  Binary, Braces, Database, File, FileArchive, FileCode, FileCode2, FileLock, FileSpreadsheet,
  FileTerminal, FileText, FileType, Image, Monitor, Settings, SquareTerminal, type LucideIcon,
} from 'lucide-react'

/**
 * Presentation metadata for a workspace item kind: the icon to show and a distinctive color, so the
 * tree/list and the viewer header read the file's type at a glance. `color` is a literal CSS color
 * (not a theme token) so each kind stays recognizable across light/dark themes.
 */
export interface FileKindMeta {
  label: string
  icon: LucideIcon
  color: string
}

/**
 * Kind → presentation, declared as families so one entry covers every extension that means the same
 * thing (`.yml`/`.yaml`, `.jpg`/`.png`/`.svg`, …).
 *
 * A `kind` is whatever the backend scan reported: one of the runnable kinds from `classify`, else the
 * lowercased extension. Since the tree can show every file, the long tail here is what keeps "All
 * files" legible — without it a project reads as one column of identical grey pages.
 *
 * Colors follow each ecosystem's own brand where there is one (TypeScript blue, Go cyan, Rust rust),
 * which is what makes a row scannable without reading the extension.
 */
const FAMILIES: [FileKindMeta, string[]][] = [
  // ── Runnables: the kinds `classify` produces ────────────────────────────────
  [{ label: 'Batch', icon: FileTerminal, color: '#3fb950' }, ['bat', 'cmd']],
  [{ label: 'PowerShell', icon: FileCode, color: '#4aa3ff' }, ['ps1', 'psm1', 'psd1']],
  [{ label: 'Shell', icon: SquareTerminal, color: '#c586c0' }, ['sh', 'bash', 'zsh', 'fish']],
  [{ label: 'Remote Desktop', icon: Monitor, color: '#2dd4bf' }, ['rdp']],

  // ── Source ─────────────────────────────────────────────────────────────────
  [{ label: 'JavaScript', icon: FileCode2, color: '#f0db4f' }, ['js', 'mjs', 'cjs', 'jsx']],
  [{ label: 'TypeScript', icon: FileCode2, color: '#3178c6' }, ['ts', 'mts', 'cts', 'tsx']],
  [{ label: 'Python', icon: FileCode2, color: '#ffd343' }, ['py', 'pyi', 'pyw']],
  [{ label: 'Rust', icon: FileCode2, color: '#dea584' }, ['rs']],
  [{ label: 'Go', icon: FileCode2, color: '#00add8' }, ['go']],
  [{ label: 'Ruby', icon: FileCode2, color: '#cc342d' }, ['rb', 'erb', 'gemspec']],
  [{ label: 'Java', icon: FileCode2, color: '#e76f00' }, ['java', 'gradle', 'kt', 'kts']],
  [{ label: 'C#', icon: FileCode2, color: '#9b4f96' }, ['cs', 'csproj', 'sln']],
  [{ label: 'C / C++', icon: FileCode2, color: '#649ad2' }, ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp']],
  [{ label: 'PHP', icon: FileCode2, color: '#777bb4' }, ['php']],
  [{ label: 'Source', icon: FileCode2, color: '#89b4fa' }, ['swift', 'dart', 'lua', 'pl', 'r', 'scala', 'ex', 'exs', 'vb']],

  // ── Web ────────────────────────────────────────────────────────────────────
  [{ label: 'HTML', icon: FileCode, color: '#e34c26' }, ['html', 'htm', 'vue', 'svelte', 'hbs', 'ejs']],
  [{ label: 'Stylesheet', icon: FileType, color: '#563d7c' }, ['css', 'scss', 'sass', 'less', 'styl']],

  // ── Data & config ──────────────────────────────────────────────────────────
  [{ label: 'JSON', icon: Braces, color: '#cbcb41' }, ['json', 'json5', 'jsonc', 'ndjson', 'map']],
  [{ label: 'YAML', icon: Braces, color: '#f4bf75' }, ['yml', 'yaml']],
  [{ label: 'Config', icon: Settings, color: '#8fbcbb' }, ['toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'editorconfig']],
  [{ label: 'XML', icon: FileCode, color: '#f1662a' }, ['xml', 'xaml', 'plist', 'svg']],
  [{ label: 'SQL', icon: Database, color: '#dd6b20' }, ['sql', 'db', 'sqlite', 'sqlite3', 'mdb']],
  [{ label: 'Spreadsheet', icon: FileSpreadsheet, color: '#3fb950' }, ['csv', 'tsv', 'xls', 'xlsx', 'ods']],

  // ── Documents ──────────────────────────────────────────────────────────────
  [{ label: 'Markdown', icon: FileText, color: '#6fb3d2' }, ['md', 'markdown', 'mdx', 'rst', 'adoc']],
  [{ label: 'PDF', icon: FileText, color: '#e5252a' }, ['pdf']],
  [{ label: 'Document', icon: FileText, color: '#4b8bf5' }, ['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx']],
  [{ label: 'Text', icon: FileText, color: '#9ca3af' }, ['txt', 'log', 'out', 'diff', 'patch']],

  // ── Assets & binaries ──────────────────────────────────────────────────────
  [{ label: 'Image', icon: Image, color: '#a074c4' }, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'avif']],
  [{ label: 'Font', icon: FileType, color: '#c9a227' }, ['ttf', 'otf', 'woff', 'woff2', 'eot']],
  [{ label: 'Archive', icon: FileArchive, color: '#d4a72c' }, ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'iso']],
  [{ label: 'Binary', icon: Binary, color: '#8b949e' }, ['exe', 'msi', 'dll', 'so', 'dylib', 'bin', 'obj', 'pdb', 'lib', 'wasm', 'class', 'pyc']],
  [{ label: 'Secret', icon: FileLock, color: '#f0883e' }, ['pem', 'key', 'crt', 'cer', 'pfx', 'p12', 'ppk', 'asc', 'gpg']],
  [{ label: 'Lock file', icon: FileLock, color: '#8b949e' }, ['lock', 'lockb']],
]

const META: Record<string, FileKindMeta> = {}
for (const [meta, kinds] of FAMILIES) {
  for (const kind of kinds) META[kind] = meta
}

/**
 * Look up metadata for a kind, falling back to a neutral default.
 *
 * The fallback still has to be good: an unlisted extension gets a plain dim page and its extension as
 * the label (`TOML file`) rather than being flagged as something unrecognized, and `file` — what the
 * scan reports for an extensionless name like `Dockerfile` — reads simply as "File".
 */
export function fileKindMeta(kind: string): FileKindMeta {
  if (META[kind]) return META[kind]
  const label = !kind || kind === 'file' ? 'File' : `${kind.toUpperCase()} file`
  return { label, icon: File, color: 'var(--theme-dim)' }
}
