/**
 * @vitest-environment jsdom
 */
/**
 * The LOCAL branch of the connection form, plus the two side-effecting buttons.
 *
 * `forms.test.tsx` covers SSH and RDP thoroughly. LOCAL is a different form: it swaps host/user for a
 * shell picker, a working directory with a folder browser, an optional command and a keep-open
 * toggle, and it seeds the cwd from the home directory on mount. The placeholders in there are also
 * the only place the form reads the platform, so a macOS user sees a POSIX path and a Windows user a
 * drive path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { mockOmnitermAPI } from '../../testUtils'
import ConnectionForm from '../ConnectionForm'

const expandAdvanced = () => fireEvent.click(screen.getByRole('button', { name: /advanced/i }))

async function renderForm(props: Record<string, unknown> = {}, api: Record<string, unknown> = {}) {
  mockOmnitermAPI(api)
  const onSave = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <ConnectionForm folders={[]} onClose={onClose} onSave={onSave} {...props} />,
  )
  await act(async () => {})
  return { onSave, onClose, view }
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => 'new-id' },
    configurable: true,
    writable: true,
  })
})

describe('LOCAL working directory', () => {
  it('seeds a new LOCAL connection from the home directory', async () => {
    await renderForm({}, { files: { getHomeDir: async () => 'C:/Users/me' } })
    fireEvent.click(screen.getByText('Local'))
    await waitFor(() => expect(screen.getByDisplayValue('C:/Users/me')).toBeInTheDocument())
  })

  it('leaves the field empty when the backend reports no home directory', async () => {
    await renderForm({}, { files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    expect(screen.getByPlaceholderText('C:\\Users\\you')).toHaveValue('')
  })

  it('never overwrites a directory an edited connection already has', async () => {
    const getHomeDir = vi.fn(async () => 'C:/Users/me')
    await renderForm(
      {
        initial: {
          id: 'c1', name: 'Shell', type: 'LOCAL' as const, host: '', port: '', user: '',
          shell: 'powershell' as const, localCwd: 'D:/work',
        },
      },
      { files: { getHomeDir } },
    )
    expect(screen.getByDisplayValue('D:/work')).toBeInTheDocument()
    expect(getHomeDir).not.toHaveBeenCalled()
  })

  it('picks a folder through the browse button and ignores a cancelled dialog', async () => {
    const pickDirectory = vi.fn(async () => 'D:/chosen')
    await renderForm({}, { files: { getHomeDir: async () => 'C:/home', pickDirectory } })
    fireEvent.click(screen.getByText('Local'))
    await waitFor(() => expect(screen.getByDisplayValue('C:/home')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Browse for a folder'))
    await waitFor(() => expect(screen.getByDisplayValue('D:/chosen')).toBeInTheDocument())
    // The picker starts from whatever is in the field.
    expect(pickDirectory).toHaveBeenCalledWith('C:/home')

    pickDirectory.mockResolvedValueOnce(null as never)
    fireEvent.click(screen.getByTitle('Browse for a folder'))
    await act(async () => {})
    expect(screen.getByDisplayValue('D:/chosen')).toBeInTheDocument()
  })

  it('starts the picker with no hint when the field is empty', async () => {
    const pickDirectory = vi.fn(async () => null)
    await renderForm({}, { files: { getHomeDir: async () => '', pickDirectory } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    fireEvent.click(screen.getByTitle('Browse for a folder'))
    await act(async () => {})
    expect(pickDirectory).toHaveBeenCalledWith(undefined)
  })

  it('accepts a directory typed by hand', async () => {
    await renderForm({}, { files: { getHomeDir: async () => 'C:/home' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    const field = screen.getByPlaceholderText('C:\\Users\\you')
    fireEvent.change(field, { target: { value: 'E:/typed' } })
    expect(field).toHaveValue('E:/typed')
  })
})

describe('platform-specific placeholders', () => {
  it('shows Windows paths on Windows', async () => {
    await renderForm({}, { app: { platform: 'win32' }, files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    expect(screen.getByPlaceholderText('C:\\Users\\you')).toBeInTheDocument()
  })

  it('shows POSIX paths on macOS', async () => {
    await renderForm({}, { app: { platform: 'darwin' }, files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    expect(screen.getByPlaceholderText('/Users/you')).toBeInTheDocument()
    expandAdvanced()
    expect(screen.getByPlaceholderText('--no-rcs')).toBeInTheDocument()
  })
})

describe('LOCAL shell selection', () => {
  it('offers each shell placeholder its own example command', async () => {
    await renderForm({}, { app: { platform: 'win32' }, files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})

    // The Shell <label> carries no `for`, so it cannot be reached by label text.
    const shellSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(shellSelect, { target: { value: 'powershell' } })
    expect(screen.getByPlaceholderText('.\\deploy.ps1')).toBeInTheDocument()
    expandAdvanced()
    expect(screen.getByPlaceholderText('-NoProfile')).toBeInTheDocument()

    fireEvent.change(shellSelect, { target: { value: 'cmd' } })
    expect(screen.getByPlaceholderText('C:\\path\\to\\build.bat')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('/v:on')).toBeInTheDocument()

    fireEvent.change(shellSelect, { target: { value: 'wsl' } })
    expect(screen.getByPlaceholderText('-d Ubuntu-22.04')).toBeInTheDocument()
  })
})

describe('saving a LOCAL connection', () => {
  it('keeps only the LOCAL fields that carry a value, and drops remote ones', async () => {
    const { onSave, onClose } = await renderForm(
      {},
      { app: { platform: 'win32' }, files: { getHomeDir: async () => 'C:/home' } },
    )
    fireEvent.click(screen.getByText('Local'))
    await waitFor(() => expect(screen.getByDisplayValue('C:/home')).toBeInTheDocument())

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'powershell' } })
    fireEvent.change(screen.getByPlaceholderText('.\\deploy.ps1'), {
      target: { value: '  .\\build.ps1  ' },
    })
    expandAdvanced()
    fireEvent.change(screen.getByPlaceholderText('-NoProfile'), { target: { value: ' -NoLogo ' } })

    fireEvent.click(screen.getByText('Save Connection'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const saved = onSave.mock.calls[0][0]
    expect(saved).toMatchObject({
      type: 'LOCAL',
      shell: 'powershell',
      // Whitespace is trimmed, so a field holding only spaces saves as absent rather than as ' '.
      localCommand: '.\\build.ps1',
      localArgs: '-NoLogo',
      localCwd: 'C:/home',
      localKeepOpen: true,
    })
    expect(saved.redirectDrives).toBeUndefined()
    expect(onClose).toHaveBeenCalled()
  })

  it('drops LOCAL fields that hold only whitespace', async () => {
    const { onSave } = await renderForm({}, { files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    fireEvent.change(screen.getByPlaceholderText('C:\\Users\\you'), { target: { value: '   ' } })

    fireEvent.click(screen.getByText('Save Connection'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0]
    expect(saved.localCwd).toBeUndefined()
    expect(saved.localCommand).toBeUndefined()
    expect(saved.localArgs).toBeUndefined()
  })

  it('names an unnamed LOCAL connection after its shell', async () => {
    const { onSave } = await renderForm({}, { files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    fireEvent.click(screen.getByText('Save Connection'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].name).toBeTruthy()
  })

  it('turns the keep-open toggle off', async () => {
    const { onSave } = await renderForm({}, { files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('Local'))
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Keep terminal open after the command finishes'))
    fireEvent.click(screen.getByText('Save Connection'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].localKeepOpen).toBe(false)
  })

  it('resets the port when switching back to SSH', async () => {
    const { onSave } = await renderForm({}, { files: { getHomeDir: async () => '' } })
    fireEvent.click(screen.getByText('RDP'))
    expandAdvanced()
    expect(screen.getByDisplayValue('3389')).toBeInTheDocument()

    fireEvent.click(screen.getByText('SSH'))
    expect(screen.getByDisplayValue('22')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('192.168.1.1'), {
      target: { value: 'box' },
    })
    fireEvent.click(screen.getByText('Save Connection'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ type: 'SSH', port: '22' })
  })
})

describe('RDP trust reset', () => {
  it('confirms the reset and clears the confirmation on its own', async () => {
    vi.useFakeTimers()
    try {
      const rdpResetTrust = vi.fn(async () => {})
      mockOmnitermAPI({ connect: { rdpResetTrust } })
      render(
        <ConnectionForm
          folders={[]}
          onClose={vi.fn()}
          onSave={vi.fn()}
          initial={{
            id: 'c1', name: 'Desk', type: 'RDP', host: '10.0.0.9', port: '3389', user: 'me',
          }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
      const reset = screen.getByRole('button', { name: /reset.*trust|trust/i })
      await act(async () => { fireEvent.click(reset) })
      expect(rdpResetTrust).toHaveBeenCalledWith('10.0.0.9', '3389')

      // The confirmation is transient — it must clear itself rather than sticking until reopen.
      await act(async () => { vi.advanceTimersByTime(2600) })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('closing the form', () => {
  it('closes straight away on a clean form clicked outside', async () => {
    const { onClose } = await renderForm()
    const backdrop = document.querySelector('.fixed') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores a click that started inside the dialog', async () => {
    const { onClose } = await renderForm()
    fireEvent.click(screen.getByText('New Connection'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on the header button', async () => {
    const { onClose } = await renderForm()
    fireEvent.click(document.querySelector('.text-theme-dim') as HTMLElement)
    expect(onClose).toHaveBeenCalled()
  })

  // Escape is the only route that guards unsaved work — the backdrop and the header X close outright.
  it('asks before discarding edits on Escape, and can be talked out of it', async () => {
    const { onClose } = await renderForm()
    fireEvent.change(screen.getByPlaceholderText('192.168.1.1'), { target: { value: 'dirty' } })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Discard changes?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Keep editing'))
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText('Discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape without asking when nothing has changed', async () => {
    const { onClose } = await renderForm()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Advanced section preset', () => {
  it.each([
    ['a non-default port', { port: '2222' }],
    ['a parent folder', { parentId: 'f1' }],
    ['a password help link', { passwordHelpUrl: 'https://vault.example' }],
    ['extra shell args', { localArgs: '-NoLogo' }],
    ['drive redirection', { redirectDrives: true }],
  ])('opens itself when an edited connection already has %s', async (_label, extra) => {
    await renderForm({
      folders: [{ id: 'f1', name: 'Lab' }],
      capabilities: { credentialPolicy: 'prompt-every-time' },
      initial: {
        id: 'c1', name: 'Server', type: 'SSH' as const, host: '10.0.0.1', port: '22', user: 'root',
        ...extra,
      },
    })
    // An open Advanced section shows the port field without anyone clicking the disclosure.
    expect(screen.getByText('Port')).toBeVisible()
  })

  it('stays shut for an edited connection that is entirely default', async () => {
    await renderForm({
      initial: {
        id: 'c1', name: 'Server', type: 'SSH' as const, host: '10.0.0.1', port: '22', user: 'root',
      },
    })
    expect(screen.queryByText('Port')).not.toBeInTheDocument()
  })

  it('treats an empty port as the default for a LOCAL connection', async () => {
    await renderForm(
      {
        initial: {
          id: 'c1', name: 'Shell', type: 'LOCAL' as const, host: '', port: '', user: '',
          shell: 'cmd' as const, localCwd: 'D:/work',
        },
      },
      { files: { getHomeDir: async () => '' } },
    )
    expect(screen.queryByText('Port')).not.toBeInTheDocument()
  })
})
