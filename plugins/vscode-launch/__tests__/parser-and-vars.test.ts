import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { isSupportedLaunchVersion, parseLaunchJsonText, stripJsonc } from '../src/parser'
import { resolvePreLaunchTask } from '../src/tasks'
import { expandVariables, loadEnvFile } from '../src/variables'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniterm-vscode-launch-t1-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('stripJsonc and isSupportedLaunchVersion', () => {
  it('strips line and block comments and trailing commas while preserving URLs inside strings', () => {
    const input = `{
      // Top-level comment
      "version": "0.2.0", /* inline comment */
      "url": "http://localhost:5000//health/*keep*/",
      "escaped": "quote \\" // still inside string",
      "items": [1, 2,],
    }`
    const parsed = JSON.parse(stripJsonc(input)) as Record<string, unknown>
    expect(parsed.version).toBe('0.2.0')
    expect(parsed.url).toBe('http://localhost:5000//health/*keep*/')
    expect(parsed.escaped).toBe('quote " // still inside string')
    expect(parsed.items).toEqual([1, 2])
  })

  it('accepts version 0.2.0 and above and rejects older or malformed versions', () => {
    expect(isSupportedLaunchVersion('0.2.0')).toBe(true)
    expect(isSupportedLaunchVersion('0.2.5')).toBe(true)
    expect(isSupportedLaunchVersion('0.3.0')).toBe(true)
    expect(isSupportedLaunchVersion('1.0.0')).toBe(true)
    expect(isSupportedLaunchVersion('0.1.0')).toBe(false)
    expect(isSupportedLaunchVersion('0.0.9')).toBe(false)
    expect(isSupportedLaunchVersion('')).toBe(false)
    expect(isSupportedLaunchVersion(undefined)).toBe(false)
  })
})

describe('parseLaunchJsonText', () => {
  it('parses launch and attach configurations plus compounds for version >= 0.2.0', () => {
    const raw = `{
      // VS Code launch file
      "version": "0.2.0",
      "configurations": [
        {
          "name": "API (.NET)",
          "type": "coreclr",
          "request": "launch",
          "program": "\${workspaceFolder}/bin/Debug/net8.0/Api.dll",
          "args": ["--urls", "http://localhost:5000//v1"],
          "preLaunchTask": "build",
        },
        {
          "name": "Attach Process",
          "type": "netcoredbg",
          "request": "attach",
          "processId": "1234",
        },
      ],
      "compounds": [
        {
          "name": "Full Stack",
          "configurations": ["API (.NET)", { "name": "Web UI", "folder": "apps/web" }],
          "stopAll": true,
        },
      ],
    }`

    const parsed = parseLaunchJsonText(raw, '/repo/apps/api', 'apps/api')
    expect(parsed.error).toBeUndefined()
    expect(parsed.version).toBe('0.2.0')
    expect(parsed.configurations).toHaveLength(2)
    expect(parsed.configurations[0]).toMatchObject({
      id: 'apps/api::API (.NET)',
      name: 'API (.NET)',
      type: 'coreclr',
      request: 'launch',
      runnable: true,
      relativeFolder: 'apps/api',
      workspaceFolder: '/repo/apps/api',
      preLaunchTask: 'build',
    })
    expect(parsed.configurations[1]).toMatchObject({
      name: 'Attach Process',
      request: 'attach',
      runnable: true,
    })
    expect(parsed.compounds).toHaveLength(1)
    expect(parsed.compounds[0]).toMatchObject({
      id: 'apps/api::compound::Full Stack',
      name: 'Full Stack',
      stopAll: true,
      targets: [
        { name: 'API (.NET)' },
        { name: 'Web UI', folder: 'apps/web' },
      ],
    })
  })

  it('rejects launch.json below 0.2.0 with an explicit version error', () => {
    const raw = `{ "version": "0.1.0", "configurations": [{ "name": "Old", "type": "node", "request": "launch" }] }`
    const parsed = parseLaunchJsonText(raw, '/repo', '.')
    expect(parsed.configurations).toEqual([])
    expect(parsed.error).toContain('0.2.0')
  })

  it('captures malformed JSON syntax errors without throwing', () => {
    const parsed = parseLaunchJsonText('{ "version": "0.2.0", broken ', '/repo', '.')
    expect(parsed.configurations).toEqual([])
    expect(parsed.error).toBeTruthy()
  })
})

describe('expandVariables, loadEnvFile, and resolvePreLaunchTask', () => {
  it('expands workspace, home, pathSeparator, and env variables', () => {
    const ctx = {
      workspaceFolder: '/work/my-service',
      userHome: '/home/dev',
      pathSeparator: '/',
      env: { API_PORT: '8080' },
    }
    const result = expandVariables(
      '${workspaceFolder}${/}dist/${workspaceFolderBasename}-${env:API_PORT}-${userHome}-${pathSeparator}',
      ctx,
    )
    expect(result).toBe('/work/my-service/dist/my-service-8080-/home/dev-/')
  })

  it('loads .env files with comments, export prefixes, and single/double quotes', () => {
    const dir = makeTempDir()
    const envPath = path.join(dir, '.env')
    fs.writeFileSync(
      envPath,
      [
        '# comment',
        'PORT=4000',
        'export HOST="127.0.0.1"',
        "SECRET='abc=123'",
      ].join('\n'),
      'utf8',
    )
    expect(loadEnvFile(envPath)).toEqual({
      PORT: '4000',
      HOST: '127.0.0.1',
      SECRET: 'abc=123',
    })
  })

  it('resolves preLaunchTask from sibling .vscode/tasks.json with JSONC comments', () => {
    const dir = makeTempDir()
    const vscodeDir = path.join(dir, '.vscode')
    fs.mkdirSync(vscodeDir, { recursive: true })
    fs.writeFileSync(
      path.join(vscodeDir, 'tasks.json'),
      `{
        // Build tasks
        "version": "2.0.0",
        "tasks": [
          {
            "label": "build",
            "command": "dotnet",
            "type": "process",
            "args": ["build", "\${workspaceFolder}/App.csproj"],
          },
        ],
      }`,
      'utf8',
    )

    const resolved = resolvePreLaunchTask(dir, 'build', {
      workspaceFolder: dir,
      userHome: os.homedir(),
      pathSeparator: path.sep,
      env: {},
    })
    expect(resolved).toEqual({
      label: 'build',
      command: 'dotnet',
      args: ['build', `${dir}/App.csproj`],
      cwd: dir,
      shell: false,
    })
  })

  it('resolves implicit dotnet build fallback, npm script tasks, options.cwd/env, and handles invalid tasks.json', () => {
    const dotnetDir = makeTempDir()
    fs.writeFileSync(path.join(dotnetDir, 'Service.csproj'), '<Project />', 'utf8')
    const ctx = {
      workspaceFolder: dotnetDir,
      userHome: os.homedir(),
      pathSeparator: path.sep,
      env: { TAG: 'v1' },
    }
    expect(resolvePreLaunchTask(dotnetDir, 'build', ctx)).toMatchObject({
      command: 'dotnet',
      args: ['build'],
      cwd: dotnetDir,
    })
    expect(resolvePreLaunchTask(dotnetDir, 'unknown-task', ctx)).toBeNull()

    const npmDir = makeTempDir()
    fs.mkdirSync(path.join(npmDir, '.vscode'), { recursive: true })
    fs.writeFileSync(
      path.join(npmDir, '.vscode', 'tasks.json'),
      JSON.stringify({
        version: '2.0.0',
        tasks: [
          {
            type: 'npm',
            script: 'compile',
            path: 'packages/ui',
            options: { env: { BUILD_TAG: '${env:TAG}', RETRIES: 2 } },
          },
          {
            label: 'custom-arg-obj',
            command: 'node',
            options: { cwd: '${workspaceFolder}/sub' },
            args: [{ value: '--check' }, 'entry.js'],
          },
        ],
      }),
      'utf8',
    )
    const npmCtx = { ...ctx, workspaceFolder: npmDir }
    const npmTask = resolvePreLaunchTask(npmDir, 'npm: compile', npmCtx)
    expect(npmTask?.args).toEqual(['run', 'compile'])
    expect(npmTask?.env).toEqual({ BUILD_TAG: 'v1', RETRIES: '2' })

    const customTask = resolvePreLaunchTask(npmDir, 'custom-arg-obj', npmCtx)
    expect(customTask?.args).toEqual(['--check', 'entry.js'])
    expect(customTask?.shell).toBe(true)

    const badDir = makeTempDir()
    fs.mkdirSync(path.join(badDir, '.vscode'), { recursive: true })
    fs.writeFileSync(path.join(badDir, '.vscode', 'tasks.json'), '{ invalid', 'utf8')
    expect(resolvePreLaunchTask(badDir, 'build', { ...ctx, workspaceFolder: badDir })).toBeNull()
  })

  it('detects background watcher tasks and custom problemMatcher patterns', () => {
    const dir = makeTempDir()
    fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, '.vscode', 'tasks.json'),
      JSON.stringify({
        version: '2.0.0',
        tasks: [
          {
            label: 'watch:tsc',
            command: 'tsc',
            args: ['-w'],
            problemMatcher: ['$tsc-watch'],
          },
          {
            label: 'dev:server',
            command: 'npm',
            args: ['run', 'dev'],
            isBackground: true,
            problemMatcher: {
              background: {
                endsPattern: 'ready on http',
              },
            },
          },
          {
            label: 'start:web',
            command: 'npm',
            args: ['start'],
          },
        ],
      }),
      'utf8',
    )
    const ctx = {
      workspaceFolder: dir,
      userHome: os.homedir(),
      pathSeparator: path.sep,
      env: {},
    }
    const tscTask = resolvePreLaunchTask(dir, 'watch:tsc', ctx)
    expect(tscTask?.isBackground).toBe(true)
    expect(tscTask?.readyPattern).toContain('watching for file changes')

    const devTask = resolvePreLaunchTask(dir, 'dev:server', ctx)
    expect(devTask?.isBackground).toBe(true)
    expect(devTask?.readyPattern).toBe('ready on http')

    const webTask = resolvePreLaunchTask(dir, 'start:web', ctx)
    expect(webTask?.isBackground).toBe(true)
  })
})
