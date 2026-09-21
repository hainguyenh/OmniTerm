import { describe, expect, it } from 'vitest'
import { workingFolderLabel } from '../workspaceDisplay'

const workspaces: any[] = [{
  id: 'dev',
  name: 'dev',
  order: 0,
  pins: [],
  folders: [
    { id: 'root', name: 'Bravo.UI', path: 'F:/repos/bravo-ui' },
    { id: 'nested', name: 'Components Alias', path: 'F:/repos/bravo-ui/src/components' },
  ],
}]

describe('workingFolderLabel', () => {
  it('prefers the deepest matching workspace folder alias', () => {
    expect(workingFolderLabel('F:\\repos\\bravo-ui\\src\\components\\button', workspaces)).toBe('Components Alias')
  })

  it('falls back to the cwd basename when no alias applies', () => {
    expect(workingFolderLabel('/tmp/project/src', workspaces)).toBe('src')
  })
})
