import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { detectInstalledEditors, resolveEditorBinary } from './netcoredbg'
import type { EditorKind } from './types'

export interface VariableContext {
  workspaceFolder: string
  userHome?: string
  pathSeparator?: string
  env?: Readonly<Record<string, string | undefined>>
  editors?: readonly EditorKind[]
}

export function createDefaultVariableContext(
  workspaceFolder: string,
  extraEnv?: Readonly<Record<string, string | undefined>>,
  editors?: readonly EditorKind[],
): VariableContext {
  return {
    workspaceFolder,
    userHome: os.homedir(),
    pathSeparator: path.sep,
    env: { ...process.env, ...(extraEnv ?? {}) },
    editors,
  }
}

export function expandVariables(value: string, ctx: VariableContext): string {
  const folder = ctx.workspaceFolder
  const basename = path.basename(folder)
  const home = ctx.userHome ?? os.homedir()
  const sep = ctx.pathSeparator ?? path.sep
  const envMap = ctx.env ?? process.env

  return value.replace(/\$\{([^}]+)\}/g, (full, rawExpr: string) => {
    const expr = rawExpr.trim()
    if (expr === 'workspaceFolder' || expr === 'workspaceRoot') return folder
    if (expr.startsWith('workspaceFolder:')) return folder
    if (expr === 'workspaceFolderBasename') return basename
    if (expr === 'userHome') return home
    if (expr === 'pathSeparator' || expr === '/') return sep
    if (expr === 'cwd') return folder
    if (expr === 'execPath') {
      const editors = ctx.editors ?? detectInstalledEditors({ env: envMap })
      const pref = editors.includes('codium') ? 'codium' : 'code'
      const resolved = resolveEditorBinary(pref, { env: envMap })
      return resolved?.bin ?? pref
    }
    if (expr.startsWith('env:')) {
      const varName = expr.slice(4).trim()
      return envMap[varName] ?? ''
    }
    return full
  })
}

export function expandStringArray(values: readonly string[] | undefined, ctx: VariableContext): string[] {
  if (!values) return []
  return values.map((item) => expandVariables(item, ctx))
}

export function loadEnvFile(envFilePath: string): Record<string, string> {
  if (!envFilePath || !fs.existsSync(envFilePath)) return {}
  let raw = ''
  try {
    raw = fs.readFileSync(envFilePath, 'utf8')
  } catch {
    return {}
  }

  const parsed: Record<string, string> = {}
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const eqIndex = body.indexOf('=')
    if (eqIndex <= 0) continue
    const key = body.slice(0, eqIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let val = body.slice(eqIndex + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    parsed[key] = val
  }
  return parsed
}
