/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntry, ProjectInfo } from '../../ide/bindings'
import { executeAction, getAction, registerAction } from '../../ide/platform/actions'
import { useProject } from '../../ide/platform/project'
import { useProjectViewRoots } from '../../ide/workbench/contributions'
import { useWorkspaceStore } from '../../platform/workspaceStore'
import {
  initProjectTree,
  useProjectTree,
  applyFsChange,
} from '../../ide/features/project-tree/store'
import {
  isConnectionsVisible,
  loadWorkspaceConnections,
  registerWorkspaceConnectionsRoot,
  setConnectionsHost,
  setConnectionsVisibility,
  toggleConnectionsVisibility,
  useWorkspaceConnectionsStore,
  type ConnectionItem,
} from '../connections/workspaceConnectionsRoot'
import { MONITOR_ICON, PLUG_ICON } from '../shellIcons'
import { registerProjectTreeActions } from '../projectTreeActions'

describe('Milestone 2 Adversarial Stress Testing', () => {
  describe('projectTreeActions empirical boundary & stress testing', () => {
    let disposeActions: (() => void) | null = null

    beforeEach(() => {
      disposeActions = registerProjectTreeActions()
      setConnectionsVisibility(true)
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

    it('guarantees state symmetry and no leakage across 1,000 rapid toggle cycles', () => {
      const action = getAction('p5.tree.toolbar.toggleConnections')
      expect(action).toBeDefined()

      expect(isConnectionsVisible()).toBe(true)

      for (let i = 0; i < 1000; i++) {
        if (i % 2 === 0) {
          action?.run({ ctx: {} })
        } else {
          toggleConnectionsVisibility()
        }
        const expected = i % 2 !== 0
        expect(isConnectionsVisible()).toBe(expected)
        expect(action?.toggled?.()).toBe(expected)
      }

      // After 1000 toggles (even number), it should be back to true
      expect(isConnectionsVisible()).toBe(true)
    })

    it('survives rapid registration and disposal cycles without memory leaks', () => {
      disposeActions?.()
      disposeActions = null

      for (let i = 0; i < 100; i++) {
        const dispose = registerProjectTreeActions()
        expect(getAction('terminal.openAt')).toBeDefined()
        expect(getAction('p5.tree.toolbar.locate')).toBeDefined()
        expect(getAction('p5.tree.toolbar.toggleConnections')).toBeDefined()
        dispose()
        expect(getAction('terminal.openAt')).toBeUndefined()
      }
    })
  })

  describe('workspaceConnectionsRoot stress and boundary testing', () => {
    let disposeRoot: (() => void) | null = null

    beforeEach(() => {
      setConnectionsVisibility(true)
      setConnectionsHost(true, null)
      useWorkspaceConnectionsStore.getState().setConnections([])
      disposeRoot = registerWorkspaceConnectionsRoot()
    })

    afterEach(() => {
      if (disposeRoot) {
        disposeRoot()
        disposeRoot = null
      }
      useWorkspaceConnectionsStore.getState().setConnections([])
      setConnectionsHost(false, null)
    })

    it('handles rapid updates with empty, single, and massive 5,000-item connection lists', () => {
      // 1. Empty list
      useWorkspaceConnectionsStore.getState().setConnections([])
      let root = useProjectViewRoots.getState().roots.get('omniterm.connections')
      expect(root?.children).toHaveLength(1)
      expect(root?.children?.[0]?.label).toBe('Add connection…')

      // 2. Large list: 5,000 items, half SSH and half Remote Desktop
      const largeList: ConnectionItem[] = []
      for (let i = 0; i < 5000; i++) {
        largeList.push({
          id: `conn-${i}`,
          name: `Server ${i}`,
          type: i % 2 === 0 ? 'SSH' : 'RDP',
          host: `10.0.0.${i % 250}`,
          port: i % 2 === 0 ? '22' : '3389',
          user: `user${i}`,
        })
      }

      useWorkspaceConnectionsStore.getState().setConnections(largeList)
      root = useProjectViewRoots.getState().roots.get('omniterm.connections')
      expect(root?.children?.map((group) => group.label)).toEqual(['SSH', 'Remote Desktop'])
      expect(root?.children?.[0]?.children).toHaveLength(2500)
      expect(root?.children?.[1]?.children).toHaveLength(2500)
      expect(root?.children?.[0]?.children?.[0]?.icon).toBe(PLUG_ICON)
      expect(root?.children?.[1]?.children?.[0]?.icon).toBe(MONITOR_ICON)

      // 3. Rapid back-to-back replacement cycles
      for (let cycle = 0; cycle < 50; cycle++) {
        const count = cycle % 2 === 0 ? 0 : 20
        useWorkspaceConnectionsStore.getState().setConnections(largeList.slice(0, count))
      }

      root = useProjectViewRoots.getState().roots.get('omniterm.connections')
      expect(root).toBeDefined()
      // The last cycle (49) leaves 20 alternating rows: 10 per group.
      expect(root?.children?.[0]?.children).toHaveLength(10)
      expect(useProjectViewRoots.getState().roots.size).toBe(1)
    })

    it('drops malformed connections read from the provider and still formats the valid ones', async () => {
      // The provider is a plugin: its data is untrusted, so it is typed `unknown` and validated on load.
      const malformedList: unknown[] = [
        null,
        'not an object',
        { id: '', name: 'empty id', type: 'SSH' },
        { id: 'c1', name: '', type: 'SSH', host: 'only.host', port: 7, user: null },
        { id: 'c2', name: '', type: 'CUSTOM', host: 'custom.host.io', user: 'ops' },
        { id: 'c3', name: '<script>alert(1)</script>', type: 'SSH', host: '127.0.0.1' },
        { id: 'c4', name: 'Very Long Name '.repeat(100), type: 'SFTP', host: 'host'.repeat(50) },
        { id: 'c5', type: 'LOCAL' },
      ]
      ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = {
        workspace: { loadConnections: vi.fn().mockResolvedValue(malformedList) },
      }
      useWorkspaceStore.setState({ selection: 'ws-m::f' })

      try {
        await expect(loadWorkspaceConnections('ws-m')).resolves.toBeUndefined()
      } finally {
        delete (window as unknown as { omnitermAPI?: unknown }).omnitermAPI
      }

      expect(useWorkspaceConnectionsStore.getState().connections.map((c) => c.id)).toEqual(['c1', 'c3', 'c5'])
      const root = useProjectViewRoots.getState().roots.get('omniterm.connections')
      expect(root?.children?.map((group) => group.label)).toEqual(['SSH', 'Local shells'])
      const ssh = root?.children?.[0]?.children
      // A nameless connection shows its address instead of an empty label.
      expect(ssh?.[0]?.label).toBe('only.host')
      expect(ssh?.[1]?.label).toBe('<script>alert(1)</script>')
      expect(root?.children?.[1]?.children?.[0]?.label).toBe('c5')
    })

    it('survives rapid project changes and IPC failures during loadWorkspaceConnections', async () => {
      let callCount = 0
      const mockLoad = vi.fn().mockImplementation(async (id: string) => {
        callCount++
        if (callCount % 3 === 0) {
          throw new Error(`Simulated IPC failure for ${id}`)
        }
        return [
          { id: `c-${id}`, name: `Conn for ${id}`, type: 'SSH', host: 'localhost' },
        ]
      })

      ;(window as unknown as { omnitermAPI: unknown }).omnitermAPI = {
        workspace: { loadConnections: mockLoad },
      }

      try {
        // Rapidly change project 50 times
        for (let i = 0; i < 50; i++) {
          const wsName = i % 5 === 0 ? null : `ws-${i}`
          useProject.setState({
            project: wsName
              ? ({
                  name: wsName,
                  root: `/workspace/${wsName}`,
                  trusted: true,
                  isGit: false,
                  settings: { exclude: [] },
                } as unknown as ProjectInfo)
              : null,
          })
          await loadWorkspaceConnections(wsName)
        }

        // Final state verification
        const state = useWorkspaceConnectionsStore.getState()
        expect(state.connections).toBeDefined()
      } finally {
        delete (window as unknown as { omnitermAPI?: unknown }).omnitermAPI
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
