/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntry } from '../../ide/bindings'
import { executeAction, getAction, registerAction } from '../../ide/platform/actions'
import {
  initProjectTree,
  useProjectTree,
  applyFsChange,
} from '../../ide/features/project-tree/store'
import { registerProjectTreeActions } from '../projectTreeActions'

describe('Milestone 2 Adversarial Stress Testing', () => {
  describe('projectTreeActions empirical boundary & stress testing', () => {
    let disposeActions: (() => void) | null = null

    beforeEach(() => {
      disposeActions = registerProjectTreeActions()
    })

    afterEach(() => {
      if (disposeActions) {
        disposeActions()
        disposeActions = null
      }
    })

    it('survives rapid invocations of terminal.openAt with null, malformed, and nested paths', () => {
      const action = getAction('terminal.openAt')
      expect(action).toBeDefined()

      const receivedEvents: Array<{ cwd?: string }> = []
      const listener = (e: Event) => {
        receivedEvents.push((e as CustomEvent<{ cwd?: string }>).detail)
      }
      window.addEventListener('omniterm:new-session', listener)

      try {
        const testPayloads: unknown[] = [
          null,
          undefined,
          '',
          0,
          12345,
          false,
          true,
          [],
          ['nested/array'],
          {},
          { cwd: null },
          { cwd: 123 },
          { cwd: '' },
          { cwd: '/valid/absolute/path' },
          { cwd: 'C:\\Windows\\System32\\drivers' },
          { cwd: 'nested/dir/../with/special/!@#$%^&*()_+' },
          { cwd: '/a'.repeat(200) },
          { otherField: 'ignored' },
        ]

        // Rapid burst: 500 invocations with random boundary payloads
        for (let i = 0; i < 500; i++) {
          const payload = testPayloads[i % testPayloads.length]
          action?.run({ ctx: {}, arg: payload })
        }

        expect(receivedEvents).toHaveLength(500)
        // Verify valid payloads extracted cwd correctly
        const validPathEvent = receivedEvents.find((e) => e.cwd === '/valid/absolute/path')
        expect(validPathEvent).toBeDefined()
        // Verify invalid/malformed payloads passed undefined without throwing
        const undefinedEvent = receivedEvents.find((e) => e.cwd === undefined)
        expect(undefinedEvent).toBeDefined()
      } finally {
        window.removeEventListener('omniterm:new-session', listener)
      }
    })

    it('survives rapid invocations of locate action with null, malformed, or nested paths', async () => {
      const action = getAction('p5.tree.toolbar.locate')
      expect(action).toBeDefined()

      const selectMock = vi.fn()
      const unregisterMock = registerAction({
        id: 'navigate.selectInProjectView',
        title: 'Select In Project View',
        run: (c) => selectMock(c.arg),
      })

      try {
        const malformedArgs = [
          null,
          undefined,
          '',
          '   ',
          '/deeply/nested/file/path.tsx',
          'nested/relative/path.rs',
          'https://malicious.url/payload',
          { path: '/object/instead/of/string' },
          [1, 2, 3],
        ]

        for (let i = 0; i < 300; i++) {
          const arg = malformedArgs[i % malformedArgs.length]
          await executeAction('p5.tree.toolbar.locate', arg)
        }

        expect(selectMock).toHaveBeenCalledTimes(300)
      } finally {
        unregisterMock()
      }
    })

    it('survives rapid registration and disposal cycles without memory leaks', () => {
      disposeActions?.()
      disposeActions = null

      for (let i = 0; i < 100; i++) {
        const dispose = registerProjectTreeActions()
        expect(getAction('terminal.openAt')).toBeDefined()
        expect(getAction('p5.tree.toolbar.locate')).toBeDefined()
        dispose()
        expect(getAction('terminal.openAt')).toBeUndefined()
      }
    })
  })

  describe('watcher fsChanged bursts and tree reconciliation', () => {
    function mockEntry(path: string, isDir = false): FileEntry {
      const parts = path.split('/')
      const name = parts[parts.length - 1] ?? path
      return {
        name,
        path,
        kind: isDir ? 'dir' : 'file',
        size: 100,
        mtimeMs: 1000,
        ignored: false,
        excluded: false,
        hidden: false,
      }
    }

    beforeEach(() => {
      initProjectTree('/mock/root', 'MockProject')
      useProjectTree.setState({
        listings: new Map([
          ['/mock/root', [mockEntry('/mock/root/file1.ts'), mockEntry('/mock/root/sub', true)]],
          ['/mock/root/sub', [mockEntry('/mock/root/sub/file2.ts'), mockEntry('/mock/root/sub/file3.ts')]],
        ]),
        expanded: new Set(['/mock/root', '/mock/root/sub']),
        selected: new Set(['/mock/root/sub/file2.ts', '/mock/root/file1.ts']),
        lead: '/mock/root/sub/file2.ts',
      })
    })

    it('reconciles rapid bursts of fsChanged events and drops deleted selections', async () => {
      const bursts = [
        {
          created: ['/mock/root/file_new.ts'],
          modified: ['/mock/root/file1.ts'],
          removed: [],
        },
        {
          created: [],
          modified: ['/mock/root/sub/file3.ts'],
          removed: ['/mock/root/sub/file2.ts'],
        },
        {
          created: ['/mock/root/sub/new_dir'],
          modified: [],
          removed: ['/mock/root/sub'],
        },
      ]

      // Dispatch 30 burst events rapidly
      for (let i = 0; i < 30; i++) {
        const burst = bursts[i % bursts.length]!
        await applyFsChange(burst)
      }

      const s = useProjectTree.getState()
      // File /mock/root/sub/file2.ts was deleted, so it must not be in selected
      expect(s.selected.has('/mock/root/sub/file2.ts')).toBe(false)
      // Since lead was /mock/root/sub/file2.ts and it was deleted, lead must be null
      expect(s.lead).toBeNull()
      // Root listings must remain a valid Map without throwing
      expect(s.listings).toBeInstanceOf(Map)
    })

    it('gracefully handles malformed or out-of-tree fsChanged events', async () => {
      const malformedEvents = [
        { created: [], modified: [], removed: [] },
        { created: [''], modified: ['/outside/workspace/other.ts'], removed: ['nonexistent'] },
        { created: ['/mock/root/'.repeat(50)], modified: [], removed: [] },
      ]

      for (const event of malformedEvents) {
        await expect(applyFsChange(event)).resolves.not.toThrow()
      }

      const s = useProjectTree.getState()
      expect(s.listings).toBeDefined()
    })
  })
})
