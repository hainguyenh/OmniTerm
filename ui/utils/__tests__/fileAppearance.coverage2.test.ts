import { describe, expect, it } from 'vitest'
import { Folder, FolderOpen } from 'lucide-react'

import { fileKindMeta } from '../fileKind'
import { fileAppearance, folderAppearance } from '../fileAppearance'

describe('fileAppearance', () => {
  it.each([
    ['.gitignore', 'Git configuration'],
    ['.gitattributes', 'Git configuration'],
    ['.gitmodules', 'Git configuration'],
    ['eslint.config.js', 'ESLint configuration'],
    ['.eslintrc.json', 'ESLint configuration'],
    ['.eslintignore', 'ESLint configuration'],
    ['.prettierrc', 'Prettier configuration'],
    ['prettier.config.mjs', 'Prettier configuration'],
    ['Dockerfile', 'Docker'],
    ['docker-compose.yml', 'Docker'],
    ['compose.yaml', 'Docker'],
    ['.dockerignore', 'Docker'],
    ['vite.config.ts', 'Vite configuration'],
    ['vitest.config.ts', 'Test file'],
    ['widget.test.tsx', 'Test file'],
    ['widget.spec.mjs', 'Test file'],
    ['tauri.conf.json', 'Tauri configuration'],
    ['package.json', 'Package manifest'],
    ['pnpm-workspace.yaml', 'Package manifest'],
    ['pnpm-lock.yaml', 'Dependency lock file'],
    ['Cargo.lock', 'Dependency lock file'],
    ['Cargo.toml', 'Rust package'],
    ['tsconfig.node.json', 'TypeScript configuration'],
  ])('labels %s as %s', (name, label) => {
    expect(fileAppearance(name, 'file').label).toBe(label)
  })

  it('uses the last path segment for either separator', () => {
    expect(fileAppearance('repo\\sub\\package.json', 'json').label).toBe('Package manifest')
    expect(fileAppearance('repo/sub/.gitignore', 'file').label).toBe('Git configuration')
  })

  it('marks React sources and defers everything else to the kind table', () => {
    expect(fileAppearance('App.tsx', 'tsx').label).toBe('React component')
    expect(fileAppearance('App.jsx', 'jsx').label).toBe('React component')
    expect(fileAppearance('main.rs', 'rs')).toBe(fileKindMeta('rs'))
    expect(fileAppearance('notes', 'file')).toEqual(fileKindMeta('file'))
  })

  it('does not treat a test-like name without a script extension as a test', () => {
    expect(fileAppearance('report.test.md', 'md')).toBe(fileKindMeta('md'))
  })
})

describe('folderAppearance', () => {
  it.each([
    ['.git', 'Git folder'],
    ['.GitHub', 'Git folder'],
    ['.vscode', 'Tool configuration'],
    ['.idea', 'Tool configuration'],
    ['.agents', 'Tool configuration'],
    ['src', 'Source folder'],
    ['UI', 'Source folder'],
    ['components', 'Source folder'],
    ['crates', 'Source folder'],
    ['__tests__', 'Tests folder'],
    ['tests', 'Tests folder'],
  ])('labels %s as %s', (name, label) => {
    expect(folderAppearance(name, false).label).toBe(label)
  })

  it.each([
    ['node_modules', 'Dependencies or build output'],
    ['target', 'Dependencies or build output'],
    ['dist', 'Dependencies or build output'],
    ['docs', 'Resources folder'],
    ['assets', 'Resources folder'],
    ['public', 'Resources folder'],
    ['anything', 'Folder'],
  ])('switches the %s icon with the expanded state', (name, label) => {
    expect(folderAppearance(name, true)).toMatchObject({ label, icon: FolderOpen })
    expect(folderAppearance(name, false)).toMatchObject({ label, icon: Folder })
  })
})
