/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConnectionAdvanced from '../ConnectionAdvanced'

const baseProps = {
  defaultOpen: true,
  isEdit: false,
  argsPlaceholder: 'e.g. --login',
  port: '',
  onPortChange: vi.fn(),
  localArgs: '',
  onLocalArgsChange: vi.fn(),
  folderOptions: [
    { id: 'f1', label: 'Sub A' },
    { id: 'f2', label: 'Sub B' },
  ],
  parentId: '',
  onParentIdChange: vi.fn(),
  rootLabel: 'My Workspace',
  showPasswordHelp: false,
  passwordHelpUrl: '',
  onPasswordHelpUrlChange: vi.fn(),
  redirectDrives: false,
  onRedirectDrivesToggle: vi.fn(),
  trustReset: false,
  onResetTrust: vi.fn(),
  inputClass: 'ic',
  labelClass: 'lc',
}

describe('ConnectionAdvanced', () => {
  beforeEach(() => {
    Object.values(baseProps).forEach((v) => {
      if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockClear?.()
    })
  })

  it('renders collapsed by default when defaultOpen=false', () => {
    render(<ConnectionAdvanced {...baseProps} defaultOpen={false} type="SSH" />)
    expect(screen.queryByText('Port')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('toggles the section open and closed', () => {
    render(<ConnectionAdvanced {...baseProps} defaultOpen={false} type="SSH" />)
    const trigger = screen.getByRole('button', { name: /Advanced/ })
    fireEvent.click(trigger)
    expect(screen.getByText('Port')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(trigger)
    expect(screen.queryByText('Port')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows port input for SSH with placeholder 22', () => {
    render(<ConnectionAdvanced {...baseProps} type="SSH" />)
    const input = screen.getByPlaceholderText('22') as HTMLInputElement
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '2222' } })
    expect(baseProps.onPortChange).toHaveBeenCalledWith('2222')
  })

  it('shows port input for RDP with placeholder 3389', () => {
    render(<ConnectionAdvanced {...baseProps} type="RDP" />)
    expect(screen.getByPlaceholderText('3389')).toBeInTheDocument()
  })

  it('shows extra-args input for LOCAL, no port field', () => {
    render(<ConnectionAdvanced {...baseProps} type="LOCAL" />)
    expect(screen.getByText('Extra arguments')).toBeInTheDocument()
    expect(screen.queryByText('Port')).not.toBeInTheDocument()
  })

  it('renders parent folder select with root + folder options', () => {
    render(<ConnectionAdvanced {...baseProps} type="SSH" />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(screen.getByText('My Workspace')).toBeInTheDocument()
    expect(screen.getByText('Sub A')).toBeInTheDocument()
    expect(screen.getByText('Sub B')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'f1' } })
    expect(baseProps.onParentIdChange).toHaveBeenCalledWith('f1')
  })

  it('renders password help field only when showPasswordHelp=true', () => {
    const { rerender } = render(<ConnectionAdvanced {...baseProps} type="SSH" showPasswordHelp={false} />)
    expect(screen.queryByText(/password help/i)).not.toBeInTheDocument()
    rerender(<ConnectionAdvanced {...baseProps} type="SSH" showPasswordHelp />)
    // PasswordHelpField renders an URL input — query by the URL input type
    expect(document.querySelector('input[type="url"]')).toBeInTheDocument()
  })

  it('renders RDP file transfer ToggleRow and toggles it', () => {
    render(<ConnectionAdvanced {...baseProps} type="RDP" />)
    expect(screen.getByText('File Transfer')).toBeInTheDocument()
    expect(screen.getByText('Share local drives with remote')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Share local drives with the remote session' })
    fireEvent.click(toggle)
    expect(baseProps.onRedirectDrivesToggle).toHaveBeenCalledTimes(1)
  })

  it('hides RDP file transfer for SSH', () => {
    render(<ConnectionAdvanced {...baseProps} type="SSH" />)
    expect(screen.queryByText('File Transfer')).not.toBeInTheDocument()
  })

  it('renders RDP trust reset button only when isEdit=true and type=RDP', () => {
    const { rerender } = render(<ConnectionAdvanced {...baseProps} type="RDP" isEdit={false} />)
    expect(screen.queryByText('Reset security trust')).not.toBeInTheDocument()
    rerender(<ConnectionAdvanced {...baseProps} type="RDP" isEdit />)
    expect(screen.getByText('Reset security trust')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Reset security trust'))
    expect(baseProps.onResetTrust).toHaveBeenCalledTimes(1)
  })

  it('shows trust-reset wording when trustReset=true', () => {
    render(<ConnectionAdvanced {...baseProps} type="RDP" isEdit trustReset />)
    expect(screen.getByText(/Trust reset/)).toBeInTheDocument()
    expect(screen.queryByText('Reset security trust')).not.toBeInTheDocument()
  })

  it('hides RDP trust reset when type=SSH even in edit', () => {
    render(<ConnectionAdvanced {...baseProps} type="SSH" isEdit />)
    expect(screen.queryByText('Security')).not.toBeInTheDocument()
  })
})
