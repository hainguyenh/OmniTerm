import fs from 'node:fs'
import path from 'node:path'

import { stripJsonc } from './parser'
import type { VariableContext } from './variables'
import { expandStringArray, expandVariables } from './variables'

export interface ResolvedTaskSpec {
  label: string
  command: string
  args: string[]
  cwd: string
  shell: boolean
  env?: Record<string, string>
  isBackground?: boolean
  readyPattern?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function resolvePreLaunchTask(
  workspaceFolder: string,
  label: string,
  ctx: VariableContext,
): ResolvedTaskSpec | null {
  const tasksPath = path.join(workspaceFolder, '.vscode', 'tasks.json')
  if (!fs.existsSync(tasksPath)) {
    if (label.trim().toLowerCase() === 'build' && hasDotnetProject(workspaceFolder)) {
      return {
        label,
        command: 'dotnet',
        args: ['build'],
        cwd: workspaceFolder,
        shell: false,
      }
    }
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonc(fs.readFileSync(tasksPath, 'utf8')))
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) return null

  const match = parsed.tasks.find(
    (item): item is Record<string, unknown> =>
      isRecord(item) && (item.label === label || (item.type === 'npm' && `npm: ${String(item.script ?? '')}` === label)),
  )
  if (!match) return null

  const options = isRecord(match.options) ? match.options : {}
  const cwd = typeof options.cwd === 'string'
    ? path.resolve(workspaceFolder, expandVariables(options.cwd, ctx))
    : workspaceFolder
  const rawEnv = isRecord(options.env) ? options.env : undefined
  const env: Record<string, string> | undefined = rawEnv
    ? Object.fromEntries(
        Object.entries(rawEnv)
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
          .map(([k, v]) => [k, expandVariables(String(v), ctx)]),
      )
    : undefined

  let isBackground = match.isBackground === true
  let readyPattern: string | undefined

  const checkPm = (pm: unknown) => {
    if (typeof pm === 'string' && pm.includes('watch')) {
      isBackground = true
      readyPattern = readyPattern ?? '(?:watching for file changes|found 0 errors|found [0-9]+ error)'
    } else if (isRecord(pm) && isRecord(pm.background)) {
      isBackground = true
      if (typeof pm.background.endsPattern === 'string') {
        readyPattern = pm.background.endsPattern
      }
    }
  }

  if (Array.isArray(match.problemMatcher)) {
    for (const pm of match.problemMatcher) checkPm(pm)
  } else if (match.problemMatcher) {
    checkPm(match.problemMatcher)
  }

  if (!isBackground && /\b(?:watch|dev|start:web|serve)\b/i.test(label)) {
    isBackground = true
  }

  if (match.type === 'npm' && typeof match.script === 'string') {
    const subPath = typeof match.path === 'string' ? path.resolve(workspaceFolder, match.path) : cwd
    return {
      label,
      command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['run', match.script],
      cwd: subPath,
      shell: process.platform === 'win32',
      ...(env ? { env } : {}),
      ...(isBackground ? { isBackground: true } : {}),
      ...(readyPattern ? { readyPattern } : {}),
    }
  }

  if (typeof match.command !== 'string' || match.command.trim().length === 0) return null
  const command = expandVariables(match.command, ctx)
  const rawArgs = Array.isArray(match.args)
    ? match.args.map((arg) => (isRecord(arg) && typeof arg.value === 'string' ? arg.value : String(arg)))
    : []
  const args = expandStringArray(rawArgs, ctx)
  const taskType = typeof match.type === 'string' ? match.type : 'shell'

  return {
    label,
    command,
    args,
    cwd,
    shell: taskType === 'shell',
    ...(env ? { env } : {}),
    ...(isBackground ? { isBackground: true } : {}),
    ...(readyPattern ? { readyPattern } : {}),
  }
}

export function hasDotnetProject(folder: string): boolean {
  try {
    const entries = fs.readdirSync(folder)
    return entries.some((name) => /\.(?:csproj|fsproj|sln|slnx)$/i.test(name))
  } catch {
    return false
  }
}
