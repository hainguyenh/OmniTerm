/**
 * Opaque-box Assertion Helpers for OmniTerm E2E tests.
 */

export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message)
  }
}

export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    const detail = `Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`
    throw new Error(message ? `${message} (${detail})` : detail)
  }
}

export function assertNotEqual(actual, expected, message = '') {
  if (actual === expected) {
    const detail = `Expected values to differ, but both were: ${JSON.stringify(actual)}`
    throw new Error(message ? `${message} (${detail})` : detail)
  }
}

export function assertDeepEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual, Object.keys(actual || {}).sort())
  const expectedStr = JSON.stringify(expected, Object.keys(expected || {}).sort())
  if (actualStr !== expectedStr) {
    const detail = `\nExpected: ${expectedStr}\nActual:   ${actualStr}`
    throw new Error(message ? `${message} ${detail}` : detail)
  }
}

export async function assertThrowsAsync(asyncFn, expectedMatcher = null, message = '') {
  let threw = false
  let thrownError = null

  try {
    await asyncFn()
  } catch (err) {
    threw = true
    thrownError = err
  }

  if (!threw) {
    throw new Error(message || 'Expected asynchronous function to throw, but it succeeded')
  }

  if (expectedMatcher) {
    const errorMsg = thrownError?.message || String(thrownError)
    if (typeof expectedMatcher === 'string' && !errorMsg.includes(expectedMatcher)) {
      throw new Error(`Expected error containing "${expectedMatcher}", got "${errorMsg}"`)
    } else if (expectedMatcher instanceof RegExp && !expectedMatcher.test(errorMsg)) {
      throw new Error(`Expected error matching ${expectedMatcher}, got "${errorMsg}"`)
    }
  }

  return thrownError
}

export function assertMatchesPattern(value, pattern, message = '') {
  if (typeof pattern === 'string') {
    if (!String(value).includes(pattern)) {
      throw new Error(message || `Expected string "${value}" to contain substring "${pattern}"`)
    }
  } else if (pattern instanceof RegExp) {
    if (!pattern.test(String(value))) {
      throw new Error(message || `Expected string "${value}" to match regex ${pattern}`)
    }
  } else {
    throw new Error('Pattern must be a string or RegExp')
  }
}

export function assertWithinRange(value, min, max, message = '') {
  if (value < min || value > max) {
    const detail = `Value ${value} is outside expected range [${min}, ${max}]`
    throw new Error(message ? `${message} (${detail})` : detail)
  }
}

export async function assertEventReceived(mockIpc, eventName, timeoutMs = 1000, predicate = null) {
  return new Promise((resolve, reject) => {
    let unlisten = null
    const timer = setTimeout(() => {
      unlisten?.()
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for event '${eventName}'`))
    }, timeoutMs)

    unlisten = mockIpc.listen(eventName, (payload) => {
      if (!predicate || predicate(payload)) {
        clearTimeout(timer)
        unlisten?.()
        resolve(payload)
      }
    })
  })
}

export function assertDocumentMatches(doc, expected, message = '') {
  for (const [key, val] of Object.entries(expected)) {
    if (doc[key] !== val) {
      const detail = `Document property '${key}' mismatch. Expected: ${JSON.stringify(val)}, Actual: ${JSON.stringify(doc[key])}`
      throw new Error(message ? `${message} (${detail})` : detail)
    }
  }
}
