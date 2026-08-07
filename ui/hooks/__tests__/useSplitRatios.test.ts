/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSplitRatios } from '../useSplitRatios'
import { DEFAULT_RATIOS, toRatios } from '../../paneLayout'
import { mockOmnitermAPI } from '../../testUtils'

describe('useSplitRatios', () => {
  beforeEach(() => {
    mockOmnitermAPI()
  })

  it('returns the default ratios when appSettings has no splitRatios', () => {
    const appSettings: AppSettings = {
      themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
    }
    const { result } = renderHook(() => useSplitRatios(appSettings, vi.fn()))
    expect(result.current[0]).toEqual(DEFAULT_RATIOS)
  })

  it('returns ratios normalized from appSettings.splitRatios', () => {
    const appSettings: AppSettings = {
      themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
      splitRatios: { main: 0.7, cross: 0.4 },
    }
    const { result } = renderHook(() => useSplitRatios(appSettings, vi.fn()))
    expect(result.current[0]).toEqual(toRatios({ main: 0.7, cross: 0.4 }))
  })

  it('setRatios updates local state without persisting', () => {
    const appSettings: AppSettings = {
      themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
    }
    const setAppSettings = vi.fn()
    const { result } = renderHook(() => useSplitRatios(appSettings, setAppSettings))
    act(() => {
      result.current[1]({ main: 0.3, cross: 0.6 })
    })
    expect(result.current[0]).toEqual({ main: 0.3, cross: 0.6 })
    expect(setAppSettings).not.toHaveBeenCalled()
  })

  it('persist writes merged settings through setAppSettings and to settings.save', () => {
    const appSettings: AppSettings = {
      themeId: 't', fontSize: 14, smartColors: true, checkUpdatesOnStartup: true, darkMode: true,
    }
    const setAppSettings = vi.fn()
    const save = vi.fn()
    mockOmnitermAPI({ settings: { save } })
    const { result } = renderHook(() => useSplitRatios(appSettings, setAppSettings))
    act(() => {
      result.current[2]({ main: 0.25, cross: 0.75 })
    })
    const expected = { ...appSettings, splitRatios: { main: 0.25, cross: 0.75 } }
    expect(setAppSettings).toHaveBeenCalledWith(expected)
    expect(save).toHaveBeenCalledWith(expected)
  })
})
