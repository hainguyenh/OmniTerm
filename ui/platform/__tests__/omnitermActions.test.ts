/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { allActions, executeAction, getAction } from '../../ide/platform/actions'
import { bindingsFor, effectiveBindings, useKeymap } from '../../ide/platform/keymap'
import { DEFAULT_SHORTCUTS } from '../../components/mainLayoutShared'
import { installOmniTermActions, OMNITERM_ACTIONS, omnitermActionId, omnitermKeymapOverrides, runOmniTermCommand } from '../omnitermActions'

describe('omnitermKeymapOverrides', () => {
  it('binds each OmniTerm command and takes the keystroke from the workbench action that used it', () => {
    const overrides = omnitermKeymapOverrides(
      { newSession: 'Ctrl+N', closeTab: 'Ctrl+W' },
      { 'navigate.gotoClass': ['Ctrl+N', 'Alt+Home'], 'editor.close': ['Ctrl+W'], 'navigate.back': ['Ctrl+Alt+Left'] },
    )
    expect(overrides['omniterm.newSession']).toEqual(['Ctrl+N'])
    expect(overrides['navigate.gotoClass']).toEqual(['Alt+Home'])
    expect(overrides['editor.close']).toEqual([])
    expect(overrides['navigate.back']).toBeUndefined()
  })

  it('compares keystrokes after normalising modifier order and case', () => {
    const overrides = omnitermKeymapOverrides({ newFolder: 'shift+ctrl+n' }, { 'navigate.gotoFile': ['Ctrl+Shift+N'] })
    expect(overrides['navigate.gotoFile']).toEqual([])
  })

  it('leaves actions the user rebound alone and skips empty shortcuts', () => {
    const overrides = omnitermKeymapOverrides(
      { newSession: 'Ctrl+N', newFolder: '  ' },
      { 'navigate.gotoClass': ['Ctrl+N'] },
      { 'navigate.gotoClass': ['Ctrl+Alt+N'], 'omniterm.newFolder': [] },
    )
    expect(overrides['navigate.gotoClass']).toBeUndefined()
    expect(overrides['omniterm.newFolder']).toBeUndefined()
  })

  // Regression: IDEA's F11 (Toggle Bookmark) and Ctrl+0 (Go to Bookmark 0) run whenever a project
  // is open, and the workbench dispatcher stops the key, so Full Screen and Reset Zoom never fired.
  it('takes the app-wide Full Screen and Reset Zoom keys from the workbench without binding them', () => {
    const overrides = omnitermKeymapOverrides(
      { toggleAppFullscreen: 'F11', zoomReset: 'Ctrl+0' },
      { 'navigate.toggleBookmark': ['F11'], 'navigate.gotoBookmark0': ['Ctrl+0'], 'code.fold': ['Ctrl+-'] },
    )
    expect(overrides['navigate.toggleBookmark']).toEqual([])
    expect(overrides['navigate.gotoBookmark0']).toEqual([])
    expect(overrides['code.fold']).toBeUndefined()
    expect(Object.keys(overrides).some((id) => id.startsWith('omniterm.'))).toBe(false)
  })

  it('does not rebind an OmniTerm command the user already rebound', () => {
    const overrides = omnitermKeymapOverrides({ newSession: 'Ctrl+N' }, {}, { 'omniterm.newSession': ['F9'] })
    expect(overrides['omniterm.newSession']).toBeUndefined()
  })
})

describe('installOmniTermActions', () => {
  let dispose: (() => void) | null = null
  afterEach(() => {
    dispose?.()
    dispose = null
  })

  it('registers one action per shortcut, runs it and gives OmniTerm the keystroke', async () => {
    const run = vi.fn()
    dispose = installOmniTermActions(DEFAULT_SHORTCUTS, run)

    for (const key of Object.keys(OMNITERM_ACTIONS)) expect(getAction(`omniterm.${key}`)).toBeTruthy()
    expect(await executeAction(omnitermActionId('layout3'))).toBe(true)
    expect(run).toHaveBeenCalledWith('layout3')

    expect(bindingsFor('omniterm.newSession')).toEqual(['Ctrl+N'])
    const owners = effectiveBindings().filter(([binding]) => binding === 'Ctrl+N').map(([, id]) => id)
    expect(owners).toEqual(['omniterm.newSession'])
  })

  it('removes the actions and restores the keymap on dispose', () => {
    const before = useKeymap.getState().overrides
    const undo = installOmniTermActions(DEFAULT_SHORTCUTS, vi.fn())
    expect(allActions().some(action => action.id.startsWith('omniterm.'))).toBe(true)
    undo()
    expect(allActions().some(action => action.id.startsWith('omniterm.'))).toBe(false)
    expect(useKeymap.getState().overrides).toBe(before)
  })

  it('keeps a keymap edit made after install instead of rolling it back', () => {
    const undo = installOmniTermActions(DEFAULT_SHORTCUTS, vi.fn())
    const edited = { 'editor.close': ['Ctrl+Q'] }
    useKeymap.setState({ overrides: edited })
    undo()
    expect(useKeymap.getState().overrides).toBe(edited)
    useKeymap.setState({ overrides: {} })
  })
})

describe('runOmniTermCommand', () => {
  it('dispatches the window event the keyboard shortcut uses', () => {
    const seen: Array<{ type: string; detail: unknown }> = []
    const listener = (event: Event) => seen.push({ type: event.type, detail: (event as CustomEvent).detail })
    for (const type of ['omniterm:new-session', 'omniterm:change-layout', 'omniterm:close-tab']) window.addEventListener(type, listener)
    runOmniTermCommand('newSession')
    runOmniTermCommand('layout4')
    runOmniTermCommand('closeTab')
    for (const type of ['omniterm:new-session', 'omniterm:change-layout', 'omniterm:close-tab']) window.removeEventListener(type, listener)
    expect(seen).toEqual([
      { type: 'omniterm:new-session', detail: null },
      { type: 'omniterm:change-layout', detail: { mode: 4 } },
      { type: 'omniterm:close-tab', detail: null },
    ])
  })
})
