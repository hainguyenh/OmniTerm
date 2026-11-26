import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const security = config.app.security

const directives = (csp) =>
  new Map(csp.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...values] = part.split(/\s+/)
    return [name, values]
  }))

for (const key of ['csp', 'devCsp']) {
  test(`${key} keeps the app from being framed, rebased or used to submit forms`, () => {
    const csp = directives(security[key])
    assert.deepEqual(csp.get('frame-ancestors'), ["'none'"])
    assert.deepEqual(csp.get('base-uri'), ["'self'"])
    // Forms post nowhere: an injected <form> cannot send data off the app (upstream d154dce4f).
    assert.deepEqual(csp.get('form-action'), ["'none'"])
    assert.deepEqual(csp.get('object-src'), ["'none'"])
  })
}
