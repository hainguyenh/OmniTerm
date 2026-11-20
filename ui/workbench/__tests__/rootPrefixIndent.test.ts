import { describe, expect, it } from 'vitest'

import { ROOT_CHECKBOX_INDENT, rootPrefixIndent } from '../../ide/features/project-tree/rootToggle'

const noop = () => undefined
const actions = { toggle: noop, setDefault: noop, clearDefault: noop, openTerminal: noop }

describe('root prefix indent', () => {
  it('moves the children of a root with a checkbox past it, on or off', () => {
    const checked = new Map([
      ['d:/self/training', true],
      ['d:/self/other', false],
    ])
    expect(rootPrefixIndent(checked, actions, 'D:\\Self\\TRAINING\\')).toBe(ROOT_CHECKBOX_INDENT)
    expect(rootPrefixIndent(checked, actions, 'D:/Self/other')).toBe(ROOT_CHECKBOX_INDENT)
  })

  it('keeps the plain indent for roots without a checkbox', () => {
    const checked = new Map([['d:/self/training', true]])
    expect(rootPrefixIndent(checked, actions, 'D:/elsewhere')).toBe(0)
    // No shell actions: no checkbox is drawn at all.
    expect(rootPrefixIndent(checked, null, 'D:/Self/TRAINING')).toBe(0)
  })
})
