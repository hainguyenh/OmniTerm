import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createLaunchScanner } from '../src/scanner'

const tempDirs: string[] = []

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-vscode-launch-scan-'))
  tempDirs.push(dir)
  return dir
}

function writeLaunch(baseDir: string, relDir: string, content: string): string {
  const folder = relDir === '.' ? baseDir : path.join(baseDir, relDir)
  const vscodeDir = path.join(folder, '.vscode')
  fs.mkdirSync(vscodeDir, { recursive: true })
  const filePath = path.join(vscodeDir, 'launch.json')
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('createLaunchScanner', () => {
  it('discovers root and subfolder launch.json files, skips ignored folders, and resolves compounds', () => {
    const repo = makeTempRepo()
    writeLaunch(
      repo,
      '.',
      `{
        "version": "0.2.0",
        "configurations": [
          { "name": "Gateway", "type": "node", "request": "launch", "program": "index.js" }
        ],
        "compounds": [
          {
            "name": "All Services",
            "configurations": [
              "Gateway",
              { "name": "Auth API", "folder": "apps/auth" },
              "Gateway",
              "Missing Worker"
            ],
            "stopAll": true
          }
        ]
      }`,
    )
    writeLaunch(
      repo,
      'apps/auth',
      `{
        "version": "0.2.0",
        "configurations": [
          { "name": "Auth API", "type": "coreclr", "request": "launch", "program": "Auth.dll" }
        ]
      }`,
    )
    writeLaunch(
      repo,
      'node_modules/pkg',
      `{
        "version": "0.2.0",
        "configurations": [{ "name": "ShouldIgnore", "type": "node", "request": "launch" }]
      }`,
    )
    writeLaunch(
      repo,
      'services/legacy',
      `{ "version": "0.1.0", "configurations": [{ "name": "Old", "type": "node", "request": "launch" }] }`,
    )

    const scanner = createLaunchScanner({ maxDepth: 4 })
    const result = scanner.discover(repo, ['codium'])

    expect(result.editors).toEqual(['codium'])
    expect(result.files.map((f) => f.relativeFolder)).toEqual(['.', 'apps/auth', 'services/legacy'])
    expect(result.files[0].configurations[0].id).toBe('.::Gateway')
    expect(result.files[1].configurations[0].id).toBe('apps/auth::Auth API')
    expect(result.files[2].error).toContain('0.2.0')

    expect(result.compounds).toHaveLength(1)
    expect(result.compounds[0]).toMatchObject({
      name: 'All Services',
      configIds: ['.::Gateway', 'apps/auth::Auth API'],
      missingTargets: ['Missing Worker'],
      stopAll: true,
    })
  })

  it('refreshes cached launch.json when mtime changes on disk', () => {
    const repo = makeTempRepo()
    const launchFile = writeLaunch(
      repo,
      '.',
      `{ "version": "0.2.0", "configurations": [{ "name": "V1", "type": "node", "request": "launch" }] }`,
    )

    const scanner = createLaunchScanner()
    expect(scanner.discover(repo).files[0].configurations[0].name).toBe('V1')

    fs.writeFileSync(
      launchFile,
      `{ "version": "0.2.0", "configurations": [{ "name": "V2", "type": "node", "request": "launch" }] }`,
      'utf8',
    )
    const future = new Date(Date.now() + 5_000)
    fs.utimesSync(launchFile, future, future)

    expect(scanner.discover(repo).files[0].configurations[0].name).toBe('V2')
  })

  it('survives symlink loops and non-existent roots without throwing', () => {
    const repo = makeTempRepo()
    writeLaunch(
      repo,
      'sub',
      `{ "version": "0.2.0", "configurations": [{ "name": "Svc", "type": "node", "request": "launch" }] }`,
    )
    try {
      fs.symlinkSync(repo, path.join(repo, 'sub', 'loop'), 'junction')
    } catch {
      // Symlink privileges may be restricted; test still verifies non-existent root safety.
    }

    const scanner = createLaunchScanner({ maxDepth: 4 })
    const found = scanner.discover(repo)
    expect(found.files).toHaveLength(1)
    expect(scanner.discover(path.join(repo, 'does-not-exist')).files).toEqual([])
  })
})
