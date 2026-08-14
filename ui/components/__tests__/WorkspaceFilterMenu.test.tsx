/**
 * @vitest-environment jsdom
 */
/**
 * Direct cover for the filter popover.
 *
 * `workspacePanel.filters.test.tsx` reaches this menu through the panel, which can only get at the
 * controls the default scan happens to produce. Rendering it on its own is what makes the dismiss
 * contract, the drag handle, the bulk toggles and the tree collapse levels reachable.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import WorkspaceFilterMenu from '../WorkspaceFilterMenu'
import { DEFAULT_TREE_FILTER, type TreeFilter } from '../../utils/workspaceFilter'
import { dir, file } from './workspacePanelTestUtils'

const anchor = (_over: Partial<DOMRect> = {}) =>
  ({ right: 400, bottom: 100, left: 200, top: 80, width: 200, height: 20 } as DOMRect & typeof _over)

const ENTRIES = [
  dir('tools'),
  dir('tools/deep'),
  dir('docs'),
  file('deploy.bat', 'bat', 'cmd'),
  file('tools/go.sh', 'sh', 'wsl'),
  file('tools/deep/inner.ps1', 'ps1', 'powershell'),
  file('docs/readme.md', 'md'),
  file('.env', 'env'),
  file('LICENSE', 'file'),
]

function open(over: Partial<TreeFilter> = {}, props: Record<string, unknown> = {}) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <WorkspaceFilterMenu
      filter={{ ...DEFAULT_TREE_FILTER, ...over }}
      onChange={onChange}
      entries={ENTRIES}
      anchor={anchor()}
      onClose={onClose}
      {...props}
    />,
  )
  return { onChange, onClose, view }
}

describe('WorkspaceFilterMenu placement and dismissal', () => {
  it('renders appearance controls without filter controls', () => {
    const onColorChange = vi.fn()
    const onIconChange = vi.fn()
    open({}, {
      appearanceOnly: true,
      appearanceColor: 'blue',
      appearanceIcon: 'folder',
      onAppearanceColorChange: onColorChange,
      onAppearanceIconChange: onIconChange,
      title: 'APPEARANCE Workspace',
    })

    expect(screen.getByText('APPEARANCE Workspace')).toBeInTheDocument()
    expect(screen.getByLabelText('Set color red')).toBeInTheDocument()
    expect(screen.getByLabelText('Set workspace icon star')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear workspace icon' })).toHaveTextContent('None')
    expect(screen.queryByLabelText('Scripts only')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Set color red'))
    fireEvent.click(screen.getByLabelText('Set workspace icon star'))
    expect(onColorChange).toHaveBeenCalledWith('red')
    expect(onIconChange).toHaveBeenCalledWith('star')
  })

  it('offers folder color controls alongside the filter options', () => {
    const onColorChange = vi.fn()
    open({}, { appearanceColor: 'green', onAppearanceColorChange: onColorChange })

    expect(screen.getByLabelText('Scripts only')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Set color yellow'))
    expect(onColorChange).toHaveBeenCalledWith('yellow')
  })

  it('offers applying the workspace filter to a folder', () => {
    const onApplySameAsWorkspace = vi.fn()
    open({ mode: 'all' }, { inheritWorkspaceFilter: false, onApplySameAsWorkspace, title: 'FILTER tools Folder' })

    const menu = screen.getByRole('group', { name: 'Folder filter' })
    expect(menu).toHaveTextContent('FILTER tools Folder')
    fireEvent.click(within(menu).getByLabelText('Same as workspace'))
    expect(onApplySameAsWorkspace).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without an anchor', () => {
    const { container } = render(
      <WorkspaceFilterMenu
        filter={DEFAULT_TREE_FILTER}
        onChange={vi.fn()}
        entries={ENTRIES}
        anchor={null}
        onClose={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('pins itself to the trigger, pulled back inside the viewport', () => {
    open()
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    // 400 (anchor.right) - 288 (menu width) = 112, comfortably inside an 1024px jsdom viewport.
    expect(menu).toHaveStyle({ left: '112px', top: '104px' })
  })

  it('clamps to the viewport gap when the trigger sits near the left edge', () => {
    render(
      <WorkspaceFilterMenu
        filter={DEFAULT_TREE_FILTER}
        onChange={vi.fn()}
        entries={ENTRIES}
        anchor={{ ...anchor(), right: 100 } as DOMRect}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('group', { name: 'Workspace filter' })).toHaveStyle({ left: '8px' })
  })

  it('closes on Escape but ignores every other key', () => {
    const { onClose } = open()
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on the close button', () => {
    const { onClose } = open()
    fireEvent.click(screen.getByLabelText('Close filter'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on an outside mousedown, but not on one inside it or on a trigger', () => {
    const trigger = document.createElement('button')
    trigger.setAttribute('data-filter-trigger', '')
    document.body.appendChild(trigger)
    const { onClose } = open()

    // A trigger owns its own toggle; closing here too would reopen what the mousedown dismissed.
    fireEvent.mouseDown(trigger)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(screen.getByRole('group', { name: 'Workspace filter' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
    trigger.remove()
  })

  it('stops listening once it unmounts', () => {
    const { onClose, view } = open()
    view.unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('WorkspaceFilterMenu dragging', () => {
  const titleBar = () =>
    screen.getByRole('group', { name: 'Workspace filter' }).firstElementChild as HTMLElement

  it('moves the dialog with the pointer and stops on mouseup', () => {
    open()
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(
      { left: 112, top: 104 } as DOMRect,
    )

    fireEvent.mouseDown(titleBar(), { button: 0, clientX: 150, clientY: 110 })
    fireEvent.mouseMove(window, { clientX: 350, clientY: 310 })
    expect(menu).toHaveStyle({ left: '312px', top: '304px' })

    fireEvent.mouseUp(window)
    fireEvent.mouseMove(window, { clientX: 500, clientY: 500 })
    expect(menu).toHaveStyle({ left: '312px', top: '304px' })
  })

  it('clamps a drag so the dialog can never be dropped out of reach', () => {
    open()
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 112, top: 104 } as DOMRect)

    fireEvent.mouseDown(titleBar(), { button: 0, clientX: 150, clientY: 110 })
    fireEvent.mouseMove(window, { clientX: -900, clientY: -900 })
    expect(menu).toHaveStyle({ left: '8px', top: '8px' })

    fireEvent.mouseMove(window, { clientX: 9000, clientY: 9000 })
    expect(menu).toHaveStyle({ left: '728px', top: '728px' })
  })

  it('ignores a non-primary button', () => {
    open()
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    fireEvent.mouseDown(titleBar(), { button: 2, clientX: 150, clientY: 110 })
    fireEvent.mouseMove(window, { clientX: 350, clientY: 310 })
    expect(menu).toHaveStyle({ left: '112px' })
  })

  it('returns to the trigger position when a new anchor opens it again', () => {
    const { view } = open()
    const menu = screen.getByRole('group', { name: 'Workspace filter' })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 112, top: 104 } as DOMRect)
    fireEvent.mouseDown(titleBar(), { button: 0, clientX: 150, clientY: 110 })
    fireEvent.mouseMove(window, { clientX: 350, clientY: 310 })
    expect(menu).toHaveStyle({ left: '312px' })

    view.rerender(
      <WorkspaceFilterMenu
        filter={DEFAULT_TREE_FILTER}
        onChange={vi.fn()}
        entries={ENTRIES}
        anchor={{ ...anchor(), right: 500 } as DOMRect}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('group', { name: 'Workspace filter' })).toHaveStyle({ left: '212px' })
  })
})

describe('WorkspaceFilterMenu modes', () => {
  it('seeds "Selected files" with the scripts already on screen', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByLabelText('Selected files'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'selected',
      paths: ['deploy.bat', 'tools/go.sh', 'tools/deep/inner.ps1'],
    }))
  })

  it('seeds "Selected types" with the kinds of those scripts, sorted', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByLabelText('Selected types'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'types',
      kinds: ['bat', 'ps1', 'sh'],
    }))
  })

  it('leaves an existing selection alone when switching back into its mode', () => {
    const { onChange } = open({ mode: 'all', paths: ['LICENSE'], kinds: ['md'] })
    fireEvent.click(screen.getByLabelText('Selected files'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['LICENSE'] }))
    fireEvent.click(screen.getByLabelText('Selected types'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['md'] }))
  })

  it('toggles "Show empty folders" both ways', () => {
    const { onChange } = open({ showEmptyDirs: false })
    fireEvent.click(screen.getByLabelText('Show empty folders'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showEmptyDirs: true }))
  })

  it('offers a reset only once the filter differs from the default', () => {
    const { onChange } = open()
    expect(screen.queryByText('Reset to default')).not.toBeInTheDocument()

    open({ mode: 'all' })
    fireEvent.click(screen.getAllByText('Reset to default')[0])
    expect(onChange).not.toHaveBeenCalledWith(DEFAULT_TREE_FILTER)
  })
})

describe('WorkspaceFilterMenu type picking', () => {
  it('adds and removes a single kind', () => {
    const { onChange } = open({ mode: 'types', kinds: ['bat'] })
    fireEvent.click(screen.getByLabelText('.sh'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['bat', 'sh'] }))
    fireEvent.click(screen.getByLabelText('.bat'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: [] }))
  })

  it('labels an extensionless file rather than showing a bare dot', () => {
    open({ mode: 'types' })
    expect(screen.getByLabelText('No extension')).toBeInTheDocument()
  })


  it('searches the selected-type options without changing the selected kinds', () => {
    const { onChange } = open({ mode: 'types', kinds: ['bat'] })
    fireEvent.change(screen.getByLabelText('Search selected types'), { target: { value: 'PowerShell' } })
    expect(screen.getByLabelText('.ps1')).toBeInTheDocument()
    expect(screen.queryByLabelText('.bat')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('checks and unchecks every kind at once', () => {
    const { onChange } = open({ mode: 'types' })
    const section = screen.getByRole('group', { name: 'Workspace filter' })
    fireEvent.click(within(section).getAllByText('Check all')[0])
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      kinds: expect.arrayContaining(['bat', 'sh', 'ps1', 'md', 'file']),
    }))
    fireEvent.click(within(section).getAllByText('Uncheck all')[0])
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: [] }))
  })

  it('says so when the workspace holds no files at all', () => {
    render(
      <WorkspaceFilterMenu
        filter={{ ...DEFAULT_TREE_FILTER, mode: 'types' }}
        onChange={vi.fn()}
        entries={[]}
        anchor={anchor()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('No files in this workspace.')).toBeInTheDocument()
  })
})

describe('WorkspaceFilterMenu file picking', () => {
  it('searches selected-file options by file name or path without changing selection', () => {
    const { onChange } = open({ mode: 'selected', paths: ['deploy.bat'] })
    fireEvent.change(screen.getByLabelText('Search selected files'), { target: { value: 'deep/inner' } })
    expect(screen.getByText('inner.ps1')).toBeInTheDocument()
    expect(screen.queryByText('deploy.bat')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('checks and unchecks every selectable file, excluding hidden ones', () => {
    const { onChange } = open({ mode: 'selected' })
    const section = screen.getByRole('group', { name: 'Workspace filter' })
    fireEvent.click(within(section).getAllByText('Check all')[0])
    const paths = onChange.mock.lastCall?.[0].paths as string[]
    expect(paths).toContain('deploy.bat')
    // `.env` is only visible under "All files", so ticking it would select an invisible file.
    expect(paths).not.toContain('.env')

    fireEvent.click(within(section).getAllByText('Uncheck all')[0])
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ paths: [] }))
  })

  it('collapses and expands every folder', () => {
    open({ mode: 'selected' })
    expect(screen.getByText('tools')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Collapse all folders'))
    expect(screen.queryByText('go.sh')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Expand all folders'))
    expect(screen.getByText('go.sh')).toBeInTheDocument()
  })

  it('expands only the root folders at level 1', () => {
    open({ mode: 'selected' })
    fireEvent.click(screen.getByTitle('Expand only root folders (Level 1)'))
    // Root folders stay open; anything nested inside them is folded away, so `tools/deep` offers an
    // "expand" affordance while `tools` itself still offers "collapse".
    expect(screen.getByText('go.sh')).toBeInTheDocument()
    expect(screen.queryByText('inner.ps1')).not.toBeInTheDocument()
    expect(screen.getByTitle('Collapse tools')).toBeInTheDocument()
    expect(screen.getByTitle('Expand deep')).toBeInTheDocument()
  })

  it('expands two levels deep at level 2', () => {
    open({ mode: 'selected' })
    fireEvent.click(screen.getByTitle('Expand root + second-level folders (Level 2)'))
    expect(screen.getByText('inner.ps1')).toBeInTheDocument()
  })

  it('folds a single folder shut and open again', () => {
    open({ mode: 'selected' })
    fireEvent.click(screen.getByTitle('Collapse tools'))
    expect(screen.queryByText('go.sh')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Expand tools'))
    expect(screen.getByText('go.sh')).toBeInTheDocument()
  })

  it('says so when there is nothing to pick', () => {
    render(
      <WorkspaceFilterMenu
        filter={{ ...DEFAULT_TREE_FILTER, mode: 'selected' }}
        onChange={vi.fn()}
        entries={[dir('empty')]}
        anchor={anchor()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('No files in this workspace.')).toBeInTheDocument()
  })
})
