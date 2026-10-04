import { describe, expect, it } from 'vitest'

import { clampLimit, DEFAULT_QUOTA_CONFIG, effectiveConfig, parseQuotaConfig, pruneOverride, wakeConfigWithEnabled } from './quotaConfig'

describe('parseQuotaConfig', () => {
  it('defaults everything for missing or malformed settings', () => {
    expect(parseQuotaConfig(undefined)).toEqual(DEFAULT_QUOTA_CONFIG)
    expect(parseQuotaConfig('nope')).toEqual(DEFAULT_QUOTA_CONFIG)
    expect(parseQuotaConfig([])).toEqual(DEFAULT_QUOTA_CONFIG)
  })

  it('keeps valid fields and clamps or rejects the rest', () => {
    const parsed = parseQuotaConfig({
      enabled: false,
      pinned: 'yes',
      display: { size: 'thick', lines: { monthly: false }, icons: { wakeButton: false }, animations: false, customArtSession: true, artSpeed: 'fast', artSize: 'large' },
      agents: {
        claude: {
          enabled: false,
          limits: { session: 250, weekly: 1, monthly: 'x' },
          suspendAtLimit: false,
          hardStopAtPct: 97.4,
          guardMinutes: 0,
          wake: { mode: 'afterReset', time: '25:00', delayMinutes: 7, prompt: '  wake up  ' },
        },
        codex: { wake: { mode: 'sometimes', time: '06:30', prompt: '   ' } },
      },
    })
    expect(parsed.enabled).toBe(false)
    expect(parsed.pinned).toBe(true)
    expect(parsed.display).toMatchObject({ size: 'thick', lines: { session: true, monthly: false }, animations: false, customArtSession: true, artSpeed: 'fast', artSize: 'large' })
    expect(parsed.display.icons.wakeButton).toBe(false)
    expect(parsed.agents.claude).toMatchObject({
      enabled: false,
      limits: { session: 100, weekly: 5, monthly: 95 },
      suspendAtLimit: false,
      hardStopAtPct: 97,
      guardMinutes: 1,
      wake: { mode: 'afterReset', time: '06:00', delayMinutes: 7, prompt: 'wake up' },
    })
    expect(parsed.agents.codex.wake).toEqual({ mode: 'off', time: '06:30', delayMinutes: 2, prompt: 'hi' })
    expect(parsed.agents.codex.hardStopAtPct).toBeNull()
    // A key stored by an older version is ignored rather than resurrecting the agent.
    expect(Object.keys(parseQuotaConfig({ agents: { antigravity: { enabled: true } } }).agents)).toEqual(['claude', 'codex', 'agy'])
  })

  it('drops the retired per-agent header icon', () => {
    const parsed = parseQuotaConfig({ agents: { claude: { icon: { mode: 'emoji', value: '🐙' } } } })
    expect(parsed.agents.claude).not.toHaveProperty('icon')
  })

  it('keeps valid pace glyphs and weeklyAutoHide, rejecting malformed ones', () => {
    const parsed = parseQuotaConfig({
      display: {
        weeklyAutoHide: false,
        pace: {
          enabled: false,
          glyphs: {
            slow: { kind: 'emoji', value: '🐌' },
            onTrack: { kind: 'emoji', value: 'way too long a string to be a glyph' },
            fast: { kind: 'image', value: 'not-supported-yet' },
            overshooting: 'not even an object',
          },
        },
      },
    })
    expect(parsed.display.weeklyAutoHide).toBe(false)
    expect(parsed.display.pace).toEqual({
      enabled: false,
      glyphs: {
        slow: { kind: 'emoji', value: '🐌' },
        onTrack: DEFAULT_QUOTA_CONFIG.display.pace.glyphs.onTrack,
        fast: DEFAULT_QUOTA_CONFIG.display.pace.glyphs.fast,
        overshooting: DEFAULT_QUOTA_CONFIG.display.pace.glyphs.overshooting,
      },
    })
  })

  it('rejects a wake prompt that fails isSafePrompt, keeping the fallback', () => {
    const parsed = parseQuotaConfig({
      agents: {
        claude: { wake: { mode: 'afterReset', prompt: 'hi & $(rm -rf ~)' } },
      },
    })
    expect(parsed.agents.claude.wake.prompt).toBe(DEFAULT_QUOTA_CONFIG.agents.claude.wake.prompt)
  })

  it('parses and validates resumeRecovery, clamping delay and validating prompt', () => {
    const parsed = parseQuotaConfig({
      agents: {
        claude: {
          resumeRecovery: { enabled: true, delaySeconds: 0, prompt: 'tiếp tục' },
        },
        codex: {
          resumeRecovery: { enabled: true, delaySeconds: 50, prompt: 'invalid $(whoami)' },
        },
      },
    })
    expect(parsed.agents.claude.resumeRecovery).toEqual({
      enabled: true,
      delaySeconds: 1,
      prompt: 'tiếp tục',
    })
    expect(parsed.agents.codex.resumeRecovery).toEqual({
      enabled: true,
      delaySeconds: 30,
      prompt: DEFAULT_QUOTA_CONFIG.agents.codex.resumeRecovery.prompt,
    })
  })
})

describe('overrides', () => {
  const global = DEFAULT_QUOTA_CONFIG.agents.claude

  it('layers an override over the global agent settings', () => {
    expect(effectiveConfig(global, undefined)).toBe(global)
    const wake = { mode: 'timeOfDay' as const, time: '05:30', delayMinutes: 4, prompt: 'check status' }
    const recovery = { enabled: false, delaySeconds: 5, prompt: 'tiếp tục' }
    const merged = effectiveConfig(global, { limits: { session: 70 }, suspendAtLimit: false, wake, resumeRecovery: recovery })
    expect(merged.limits).toEqual({ session: 70, weekly: 95, monthly: 95 })
    expect(merged.suspendAtLimit).toBe(false)
    expect(merged.autoResume).toBe(global.autoResume)
    expect(merged.wake).toEqual(wake)
    expect(merged.resumeRecovery).toEqual(recovery)
    expect(effectiveConfig(global, { autoResume: false }).autoResume).toBe(false)
  })

  it('prunes fields that match the global value, dropping empty overrides', () => {
    expect(pruneOverride(global, { limits: { session: 90 }, suspendAtLimit: true, autoResume: true, resumeRecovery: global.resumeRecovery })).toBeNull()
    expect(pruneOverride(global, {})).toBeNull()
    expect(pruneOverride(global, {
      limits: { session: 80, weekly: 95 },
      suspendAtLimit: false,
      autoResume: false,
      wake: { mode: 'afterReset', time: '06:00', delayMinutes: 3, prompt: 'wake' },
      resumeRecovery: { prompt: 'tiếp tục' },
    })).toEqual({
      limits: { session: 80 },
      suspendAtLimit: false,
      autoResume: false,
      wake: { mode: 'afterReset', time: '06:00', delayMinutes: 3, prompt: 'wake' },
      resumeRecovery: { prompt: 'tiếp tục' },
    })
  })

  it('clamps limits to 5–100', () => {
    expect(clampLimit(2)).toBe(5)
    expect(clampLimit(101)).toBe(100)
    expect(clampLimit(42.6)).toBe(43)
  })

  it('enables a terminal wake profile without starting a wake action', () => {
    const off = effectiveConfig(global, undefined)
    expect(wakeConfigWithEnabled(global, off, false).mode).toBe('off')
    expect(wakeConfigWithEnabled(global, off, true).mode).toBe('afterReset')
    const scheduled = { ...global, wake: { ...global.wake, mode: 'timeOfDay' as const, time: '05:30' } }
    expect(wakeConfigWithEnabled(global, scheduled, false)).toMatchObject({ mode: 'off', time: '05:30' })
    expect(wakeConfigWithEnabled(global, scheduled, true)).toMatchObject({ mode: 'timeOfDay', time: '05:30' })
  })
})
