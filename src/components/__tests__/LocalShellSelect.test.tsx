/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocalShellSelect } from '../LocalShellSelect'
import type { ShellOption } from '../../shellOptions'

const options: ShellOption[] = [
  { id: 'powershell', label: 'Windows PowerShell' },
  { id: 'cmd', label: 'Command Prompt' },
  { id: 'wsl', label: 'Windows Subsystem for Linux (WSL)' },
]

describe('LocalShellSelect', () => {
  it('renders the Shell label and select element', () => {
    render(<LocalShellSelect options={options} value="powershell" onChange={vi.fn()} labelClass="lc" selectClass="sc" />)
    expect(screen.getByText('Shell')).toBeInTheDocument()
  })

  it('renders all options', () => {
    render(<LocalShellSelect options={options} value="powershell" onChange={vi.fn()} labelClass="lc" selectClass="sc" />)
    expect(screen.getByText('Windows PowerShell')).toBeInTheDocument()
    expect(screen.getByText('Command Prompt')).toBeInTheDocument()
    expect(screen.getByText('Windows Subsystem for Linux (WSL)')).toBeInTheDocument()
  })

  it('selects the value option', () => {
    render(<LocalShellSelect options={options} value="cmd" onChange={vi.fn()} labelClass="lc" selectClass="sc" />)
    expect((screen.getByDisplayValue('Command Prompt') as HTMLOptionElement).value).toBe('cmd')
  })

  it('change calls onChange with the new value', () => {
    const onChange = vi.fn()
    render(<LocalShellSelect options={options} value="powershell" onChange={onChange} labelClass="lc" selectClass="sc" />)
    fireEvent.change(screen.getByDisplayValue('Windows PowerShell'), { target: { value: 'wsl' } })
    expect(onChange).toHaveBeenCalledWith('wsl')
  })

  it('renders an empty list as an empty select', () => {
    const { container } = render(<LocalShellSelect options={[]} value="" onChange={vi.fn()} labelClass="lc" selectClass="sc" />)
    expect(container.querySelector('select')!.children.length).toBe(0)
  })
})
