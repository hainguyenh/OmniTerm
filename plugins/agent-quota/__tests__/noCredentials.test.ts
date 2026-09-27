import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The sidecar must never touch a credential or the network: its only inputs are the agents' own
 * CLIs (or the user's profile launchers) and Codex's rollout logs. This fails the build if a
 * token file, an HTTP client or a request sneaks back in.
 */
const SRC = path.join(__dirname, '..', 'src')
const FORBIDDEN = [
  /credentials\.json/i,
  /auth\.json/i,
  /\bfetch\(/,
  /https?:\/\//,
  /node:https?\b/,
  /\bhttp\.request\b/,
  /api\.anthropic\.com|chatgpt\.com/i,
]

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}

describe('agent-quota sidecar', () => {
  it('reads no credential and makes no network request', () => {
    const sources = files(SRC).filter((file) => file.endsWith('.ts'))
    expect(sources.length).toBeGreaterThan(5)
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN) expect(pattern.test(text), `${path.basename(file)} matches ${pattern}`).toBe(false)
    }
  })
})
