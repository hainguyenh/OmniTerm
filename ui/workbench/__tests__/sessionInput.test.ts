import { describe, expect, it } from 'vitest'

import { SESSION_KIND, parseSessionInput, sessionInput } from '../sessions/sessionInput'

describe('session input', () => {
  it('stores nothing but the session id', () => {
    expect(sessionInput('abc_1234')).toEqual({
      kind: SESSION_KIND,
      key: 'session:abc_1234',
      data: { sessionId: 'abc_1234' },
    })
    expect(parseSessionInput(sessionInput('abc_1234'))).toBe('abc_1234')
  })

  it('survives a JSON round trip (the saved editor session)', () => {
    const restored = JSON.parse(JSON.stringify(sessionInput('x-1'))) as ReturnType<typeof sessionInput>
    expect(parseSessionInput(restored)).toBe('x-1')
  })

  it.each([
    ['another kind', { kind: 'file', key: 'session:a', data: { sessionId: 'a' } }],
    ['a key that disagrees with the data', { kind: SESSION_KIND, key: 'session:b', data: { sessionId: 'a' } }],
    ['extra fields (host, user, folder would be PII)', { kind: SESSION_KIND, key: 'session:a', data: { sessionId: 'a', host: 'h' } }],
    ['no data', { kind: SESSION_KIND, key: 'session:a' }],
    ['array data', { kind: SESSION_KIND, key: 'session:a', data: ['a'] }],
    ['a non-string id', { kind: SESSION_KIND, key: 'session:1', data: { sessionId: 1 } }],
    ['an empty id', { kind: SESSION_KIND, key: 'session:', data: { sessionId: '' } }],
    ['an id with whitespace or control characters', { kind: SESSION_KIND, key: 'session:a b', data: { sessionId: 'a b' } }],
    ['an oversized id', { kind: SESSION_KIND, key: `session:${'a'.repeat(201)}`, data: { sessionId: 'a'.repeat(201) } }],
  ])('rejects %s', (_label, input) => {
    expect(parseSessionInput(input)).toBeNull()
  })

  it('rejects a missing input', () => {
    expect(parseSessionInput(null)).toBeNull()
    expect(parseSessionInput(undefined)).toBeNull()
  })
})
