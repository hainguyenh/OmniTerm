import { Atom, Boxes, Braces, Container, FileLock, Folder, FolderCode, FolderCog, FolderGit2, FolderOpen, GitBranch, Hexagon, Package, Settings, ShieldCheck, TestTube2, Zap } from 'lucide-react'

import { fileKindMeta, type FileKindMeta } from './fileKind'

/** Filename conventions are visual hints, never a claim about Git or lint state. */
export function fileAppearance(name: string, kind: string): FileKindMeta {
  const lower = name.split(/[\\/]/).pop()?.toLowerCase() ?? name.toLowerCase()
  if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') return { label: 'Git configuration', icon: GitBranch, color: '#f07860' }
  if (lower.startsWith('eslint.config.') || lower.startsWith('.eslintrc') || lower === '.eslintignore') return { label: 'ESLint configuration', icon: ShieldCheck, color: '#a69af2' }
  if (lower.startsWith('.prettier') || lower.startsWith('prettier.config.')) return { label: 'Prettier configuration', icon: Settings, color: '#e5bc89' }
  if (lower === 'dockerfile' || lower.startsWith('docker-compose.') || lower.startsWith('compose.') || lower === '.dockerignore') return { label: 'Docker', icon: Container, color: '#58b4ee' }
  if (lower.startsWith('vite.config.')) return { label: 'Vite configuration', icon: Zap, color: '#b8a0fa' }
  if (lower.startsWith('vitest.config.') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) return { label: 'Test file', icon: TestTube2, color: '#91c975' }
  if (lower === 'tauri.conf.json') return { label: 'Tauri configuration', icon: Hexagon, color: '#ffc56a' }
  if (lower === 'package.json' || lower === 'pnpm-workspace.yaml') return { label: 'Package manifest', icon: Package, color: '#91c975' }
  if (lower === 'pnpm-lock.yaml' || lower === 'cargo.lock') return { label: 'Dependency lock file', icon: FileLock, color: '#e9b967' }
  if (lower === 'cargo.toml') return { label: 'Rust package', icon: Boxes, color: '#dea584' }
  if (lower.startsWith('tsconfig')) return { label: 'TypeScript configuration', icon: Braces, color: '#6daaf2' }
  if (kind === 'tsx' || kind === 'jsx') return { label: 'React component', icon: Atom, color: '#64cbea' }
  return fileKindMeta(kind)
}

export function folderAppearance(name: string, expanded: boolean): FileKindMeta {
  const lower = name.toLowerCase()
  if (lower === '.git' || lower === '.github') return { label: 'Git folder', icon: FolderGit2, color: '#f07860' }
  if (lower === '.vscode' || lower === '.idea' || lower === '.agents') return { label: 'Tool configuration', icon: FolderCog, color: '#a69af2' }
  if (lower === 'src' || lower === 'ui' || lower === 'components' || lower === 'crates') return { label: 'Source folder', icon: FolderCode, color: '#6daaf2' }
  if (lower === '__tests__' || lower === 'tests') return { label: 'Tests folder', icon: FolderCode, color: '#91c975' }
  if (lower === 'node_modules' || lower === 'target' || lower === 'dist') return { label: 'Dependencies or build output', icon: expanded ? FolderOpen : Folder, color: 'var(--theme-dim)' }
  if (lower === 'docs' || lower === 'assets' || lower === 'public') return { label: 'Resources folder', icon: expanded ? FolderOpen : Folder, color: '#64cbea' }
  return { label: 'Folder', icon: expanded ? FolderOpen : Folder, color: 'var(--theme-warning)' }
}
