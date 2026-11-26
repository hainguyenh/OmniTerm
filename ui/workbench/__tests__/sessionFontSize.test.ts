import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TitleControlsProps } from '../../components/TitleControls'
import { resetSessionBridge, useSessionBridge } from '../sessions/sessionBridge'
import { stepSessionFontSize } from '../sessions/sessionFontSize'
import { useTitleControlsProps } from '../titleControlsStore'

afterEach(() => {
  resetSessionBridge()
  useTitleControlsProps.setState({ props: null })
})

describe('a session terminal font size', () => {
  it('steps only that terminal, and leaves a reset to the appearance controls', () => {
    const change = vi.fn()
    useTitleControlsProps.setState({ props: { onFontSizeChange: change } as unknown as TitleControlsProps })
    useSessionBridge.setState({ sessions: [{ id: 's1', connId: 'c1', name: 'Shell' }] } as never)
    stepSessionFontSize('s1', 1)
    expect(change).toHaveBeenCalledWith(1, { id: 's1', connId: 'c1' })
    stepSessionFontSize('s1', 0)
    stepSessionFontSize('missing', 1)
    expect(change).toHaveBeenCalledTimes(1)
  })
})
