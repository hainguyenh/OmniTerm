import { beforeEach, describe, expect, it } from 'vitest'

import type { ResumeRecoveryConfig } from '../quotaConfig'
import type { ResumeRecoveryIO } from '../resumeRecovery'

import {
  cancelResumeRecovery,
  clearAllResumeRecovery,
  hasResumeError,
  isResumeRecoveryPending,
  scheduleResumeRecovery,
} from '../resumeRecovery'

describe('resumeRecovery', () => {
  describe('hasResumeError', () => {
    it('detects single-line Claude interrupted response error', () => {
      const lines = [
        'user@box:~$ claude',
        'Thinking...',
        'API Error: The response stopped arriving. The response above may be incomplete.',
        '> ',
      ]
      expect(hasResumeError(lines)).toBe(true)
    })

    it('detects wrapped error across multiple rows', () => {
      const lines = [
        'API Error: The response stopped',
        'arriving. The response above may be incomplete.',
      ]
      expect(hasResumeError(lines)).toBe(true)
    })

    it('detects partial matched signature case-insensitively', () => {
      expect(hasResumeError(['api error: the response stopped arriving'])).toBe(true)
      expect(hasResumeError(['the response above may be incomplete'])).toBe(true)
    })

    it('returns false for clean output or empty lines', () => {
      expect(hasResumeError([])).toBe(false)
      expect(hasResumeError(['Hello, how can I help you today?', '> '])).toBe(false)
      expect(hasResumeError(['Process exited with code 0'])).toBe(false)
    })
  })

  describe('scheduleResumeRecovery', () => {
    let nowTime: number
    let timers: Array<{ id: number; callback: () => void; ms: number }>
    let timerCounter: number
    let sent: Array<{ sessionId: string; data: string }>
    let notices: Array<{ level: string; message: string }>
    let userInputs: Map<string, number>
    let screens: Map<string, string[] | null>

    const fakeIO: ResumeRecoveryIO = {
      send: (sessionId, data) => sent.push({ sessionId, data }),
      readScreen: (sessionId) => screens.get(sessionId) ?? null,
      lastUserInputAt: (sessionId) => userInputs.get(sessionId),
      now: () => nowTime,
      setTimer: (callback, ms) => {
        const id = ++timerCounter
        timers.push({ id, callback, ms })
        return id
      },
      clearTimer: (handle) => {
        timers = timers.filter((t) => t.id !== handle)
      },
      pushNotice: (level, message) => notices.push({ level, message }),
    }

    const runTimers = () => {
      const pending = [...timers]
      timers = []
      for (const t of pending) {
        t.callback()
      }
    }

    beforeEach(() => {
      nowTime = 10_000
      timers = []
      timerCounter = 0
      sent = []
      notices = []
      userInputs = new Map()
      screens = new Map()
      clearAllResumeRecovery(fakeIO)
    })

    const defaultConfig: ResumeRecoveryConfig = {
      enabled: true,
      delaySeconds: 3,
      prompt: 'continue',
    }

    it('does nothing when enabled is false', () => {
      scheduleResumeRecovery('s1', { ...defaultConfig, enabled: false }, fakeIO)
      expect(isResumeRecoveryPending('s1')).toBe(false)
      expect(timers).toHaveLength(0)
    })

    it('does nothing when prompt is empty or whitespace', () => {
      scheduleResumeRecovery('s1', { ...defaultConfig, prompt: '   ' }, fakeIO)
      expect(isResumeRecoveryPending('s1')).toBe(false)
      expect(timers).toHaveLength(0)
    })

    it('schedules a timer with converted delay milliseconds', () => {
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)
      expect(isResumeRecoveryPending('s1')).toBe(true)
      expect(timers).toHaveLength(1)
      expect(timers[0].ms).toBe(3_000)
    })

    it('sends prompt + return when error is found on terminal screen', () => {
      screens.set('s1', [
        'API Error: The response stopped arriving. The response above may be incomplete.',
      ])
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)
      expect(sent).toHaveLength(0)

      nowTime += 3_000
      runTimers()

      expect(sent).toEqual([{ sessionId: 's1', data: 'continue\r' }])
      expect(notices).toHaveLength(1)
      expect(notices[0].message).toContain('Sent "continue"')
      expect(isResumeRecoveryPending('s1')).toBe(false)
    })

    it('supports custom prompt such as Vietnamese "tiếp tục"', () => {
      screens.set('s1', [
        'API Error: The response stopped arriving.',
      ])
      scheduleResumeRecovery('s1', { ...defaultConfig, prompt: 'tiếp tục' }, fakeIO)

      nowTime += 3_000
      runTimers()

      expect(sent).toEqual([{ sessionId: 's1', data: 'tiếp tục\r' }])
      expect(notices[0].message).toContain('Sent "tiếp tục"')
    })

    it('does not send prompt if user typed after resume (safety guard)', () => {
      screens.set('s1', [
        'API Error: The response stopped arriving. The response above may be incomplete.',
      ])
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)

      // User typed at nowTime + 500ms
      userInputs.set('s1', nowTime + 500)

      nowTime += 3_000
      runTimers()

      expect(sent).toHaveLength(0)
      expect(notices).toHaveLength(0)
    })

    it('sends prompt if user typed before resume (not after)', () => {
      screens.set('s1', [
        'API Error: The response stopped arriving. The response above may be incomplete.',
      ])
      // User typed before resume
      userInputs.set('s1', nowTime - 1_000)

      scheduleResumeRecovery('s1', defaultConfig, fakeIO)

      nowTime += 3_000
      runTimers()

      expect(sent).toEqual([{ sessionId: 's1', data: 'continue\r' }])
    })

    it('does not send prompt if screen has no error', () => {
      screens.set('s1', ['Normal finished output', '> '])
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)

      nowTime += 3_000
      runTimers()

      expect(sent).toHaveLength(0)
      expect(notices).toHaveLength(0)
    })

    it('does not send prompt if readScreen returns null', () => {
      screens.set('s1', null)
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)

      nowTime += 3_000
      runTimers()

      expect(sent).toHaveLength(0)
    })

    it('replaces existing pending check if scheduled again for the same session', () => {
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)
      expect(timers).toHaveLength(1)
      const firstTimerId = timers[0].id

      scheduleResumeRecovery('s1', { ...defaultConfig, delaySeconds: 5 }, fakeIO)
      expect(timers).toHaveLength(1)
      expect(timers[0].id).not.toBe(firstTimerId)
      expect(timers[0].ms).toBe(5_000)
    })

    it('cancelResumeRecovery cancels timer and removes pending state', () => {
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)
      expect(isResumeRecoveryPending('s1')).toBe(true)

      cancelResumeRecovery('s1', fakeIO)
      expect(isResumeRecoveryPending('s1')).toBe(false)
      expect(timers).toHaveLength(0)
    })

    it('clearAllResumeRecovery clears multiple sessions', () => {
      scheduleResumeRecovery('s1', defaultConfig, fakeIO)
      scheduleResumeRecovery('s2', defaultConfig, fakeIO)
      expect(isResumeRecoveryPending('s1')).toBe(true)
      expect(isResumeRecoveryPending('s2')).toBe(true)

      clearAllResumeRecovery(fakeIO)
      expect(isResumeRecoveryPending('s1')).toBe(false)
      expect(isResumeRecoveryPending('s2')).toBe(false)
      expect(timers).toHaveLength(0)
    })
  })
})
