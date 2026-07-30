/**
 * Tests for plugin manifest validation.
 *
 * These checks all run before the plugin's main file is `require`d, which is what makes them load-time
 * gates rather than advice: requiring a module executes its top level, so anything rejected afterwards
 * has already had its chance to run.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { describePlugin, PLUGIN_API_VERSION } = require_('../manifest.cjs')
const { KNOWN_PERMISSIONS } = require_('../host-api.cjs')

const pkg = (omnitermPlugin: unknown, over: Record<string, unknown> = {}) => ({
  name: '@test/p',
  version: '1.2.3',
  main: 'dist/index.js',
  omnitermPlugin,
  ...over,
})

const manifest = (over: Record<string, unknown> = {}) => ({
  apiVersion: PLUGIN_API_VERSION,
  hostVersion: '>=1.0.0',
  displayName: 'Test Plugin',
  permissions: ['connections'],
  ...over,
})

describe('describePlugin', () => {
  it('is not a plugin without an omnitermPlugin key', () => {
    expect(describePlugin(pkg(undefined), 'user')).toBeNull()
    expect(describePlugin({ name: 'x' }, 'user')).toBeNull()
    expect(describePlugin(null, 'user')).toBeNull()
  })

  it('builds a loadable descriptor from a valid manifest', () => {
    const d = describePlugin(pkg(manifest()), 'bundled')
    expect(d).toMatchObject({
      id: '@test/p',
      name: 'Test Plugin',
      version: '1.2.3',
      apiVersion: PLUGIN_API_VERSION,
      permissions: ['connections'],
      source: 'bundled',
      enabled: true,
      status: 'loaded',
    })
    expect(d.error).toBeUndefined()
  })

  it('falls back to the package name when displayName is absent', () => {
    expect(describePlugin(pkg(manifest({ displayName: undefined })), 'user').name).toBe('@test/p')
  })

  it('exposes the package description for the Settings plugin details', () => {
    const descriptor = describePlugin(pkg(manifest(), { description: 'A useful connection provider.' }), 'user')
    expect(descriptor.description).toBe('A useful connection provider.')
  })

  /**
   * `apiVersion` was recorded on the descriptor and never compared against the host's, so a plugin
   * built for a future contract loaded anyway and failed in whatever way its mismatch produced.
   */
  it('refuses an apiVersion this host does not implement', () => {
    for (const apiVersion of [1, 99, 0.5]) {
      const d = describePlugin(pkg(manifest({ apiVersion })), 'user')
      expect(d.status).toBe('incompatible')
      expect(d.error).toContain(String(apiVersion))
      expect(d.error).toContain(String(PLUGIN_API_VERSION))
    }
  })

  it('treats a missing apiVersion as legacy v1 and refuses it', () => {
    expect(describePlugin(pkg(manifest({ apiVersion: undefined })), 'user').status).toBe('incompatible')
  })

  it('refuses a permission the host cannot enforce', () => {
    const d = describePlugin(pkg(manifest({ permissions: ['connections', 'filesystem', 'net'] })), 'user')
    expect(d.status).toBe('incompatible')
    expect(d.error).toContain('filesystem')
    expect(d.error).toContain('net')
    // The enforceable one is not what made it fail.
    expect(d.error).not.toContain('connections')
  })

  it('accepts every permission the host enforces', () => {
    const d = describePlugin(pkg(manifest({ permissions: [...KNOWN_PERMISSIONS] })), 'user')
    expect(d.status).toBe('loaded')
  })

  it('defaults permissions to none rather than everything', () => {
    for (const permissions of [undefined, null, 'connections', {}]) {
      expect(describePlugin(pkg(manifest({ permissions })), 'user').permissions).toEqual([])
    }
  })

  it('refuses a package with no name, since the id keys every registry', () => {
    for (const name of [undefined, '', 42]) {
      const d = describePlugin(pkg(manifest(), { name }), 'user')
      expect(d.status).toBe('incompatible')
      expect(d.error).toMatch(/name/i)
    }
  })

  it('starts with no provider registered — activate() must ask for each', () => {
    const d = describePlugin(pkg(manifest()), 'user')
    expect(d.activeConnectionProvider).toBe(false)
    expect(d.activeAuthProvider).toBe(false)
    expect(d.activeInvokeHandler).toBe(false)
  })
})
