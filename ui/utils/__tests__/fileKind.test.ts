import { describe, it, expect } from 'vitest'
import { File } from 'lucide-react'
import { fileKindMeta } from '../fileKind'

describe('fileKindMeta', () => {
  it('gives every extension in a family the same icon and colour', () => {
    expect(fileKindMeta('yml')).toBe(fileKindMeta('yaml'))
    expect(fileKindMeta('jpg')).toBe(fileKindMeta('png'))
    expect(fileKindMeta('cmd')).toBe(fileKindMeta('bat'))
  })

  it('keeps the runnable kinds on their established icons and labels', () => {
    expect(fileKindMeta('ps1').label).toBe('PowerShell')
    expect(fileKindMeta('sh').label).toBe('Shell')
    expect(fileKindMeta('rdp').label).toBe('Remote Desktop')
  })

  it('distinguishes families that a single grey page used to flatten', () => {
    const kinds = ['ts', 'json', 'md', 'png', 'zip', 'exe', 'sql', 'csv']
    const icons = new Set(kinds.map((k) => fileKindMeta(k).icon))
    expect(icons.size).toBe(kinds.length)
    expect(icons.has(File)).toBe(false)
  })

  it('falls back to a neutral page, naming the extension where there is one', () => {
    expect(fileKindMeta('qqq')).toMatchObject({ label: 'QQQ file', icon: File })
    // What the scan reports for an extensionless name like `Dockerfile`.
    expect(fileKindMeta('file')).toMatchObject({ label: 'File', icon: File })
    expect(fileKindMeta('')).toMatchObject({ label: 'File', icon: File })
  })
})
