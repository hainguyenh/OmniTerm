import { describe, expect, it } from 'vitest'

import type { WorkspaceEntry } from '@omniterm/contract'

import { rasterImageMime } from '../imageFile'
import { entryOpenable } from '../scriptTree'

describe('rasterImageMime', () => {
  it('maps the viewer formats case-insensitively', () => {
    expect(rasterImageMime('a.png')).toBe('image/png')
    expect(rasterImageMime('photo.JPG')).toBe('image/jpeg')
    expect(rasterImageMime('x.jpeg')).toBe('image/jpeg')
    expect(rasterImageMime('spin.gif')).toBe('image/gif')
    expect(rasterImageMime('favicon.ico')).toBe('image/x-icon')
    expect(rasterImageMime('a.webp')).toBe('image/webp')
    expect(rasterImageMime('a.bmp')).toBe('image/bmp')
    expect(rasterImageMime('a.avif')).toBe('image/avif')
  })

  it('leaves text, undecodable and extensionless names to other viewers', () => {
    expect(rasterImageMime('icon.svg')).toBeNull()
    expect(rasterImageMime('scan.tiff')).toBeNull()
    expect(rasterImageMime('.png')).toBeNull()
    expect(rasterImageMime('Makefile')).toBeNull()
  })
})

describe('entryOpenable', () => {
  const entry = (name: string, viewable: boolean): WorkspaceEntry => ({
    id: `f/${name}`, name, path: `f/${name}`, kind: name.split('.').pop() ?? '', isDir: false, viewable,
  })

  it('opens raster images even though the scan marks them not viewable as text', () => {
    expect(entryOpenable(entry('logo.png', false))?.path).toBe('f/logo.png')
    expect(entryOpenable(entry('setup.exe', false))).toBeUndefined()
    expect(entryOpenable(entry('notes.md', true))?.path).toBe('f/notes.md')
  })
})
