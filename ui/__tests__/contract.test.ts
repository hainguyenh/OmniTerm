import { describe, expect, it } from 'vitest'
import { PLUGIN_API_VERSION } from '@omniterm/contract'

describe('plugin contract', () => {
  it('publishes the API version used by plugin manifests', () => {
    expect(PLUGIN_API_VERSION).toBe(2)
  })
})
