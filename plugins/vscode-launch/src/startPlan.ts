import { executePreTask } from './processIO'
import { resolvePreLaunchTask } from './tasks'
import type { DiscoveryResult, LaunchConfigItem, LaunchRunMode } from './types'
import { createDefaultVariableContext } from './variables'

export interface StartLaunchRequest {
  rootDir: string
  configIds?: readonly string[]
  compoundId?: string
  mode: LaunchRunMode
}

export interface ResolvedStartPlan {
  targets: LaunchConfigItem[]
  compoundGroupId?: string
  stopAllPeers: boolean
  warnings: string[]
  sharedPreTaskGate?: Promise<boolean>
}

export function resolveStartPlan(
  discovered: DiscoveryResult,
  request: StartLaunchRequest,
  options: { now: () => number; baseEnv?: NodeJS.ProcessEnv },
): ResolvedStartPlan {
  const allConfigs = new Map<string, LaunchConfigItem>()
  for (const file of discovered.files) {
    for (const cfg of file.configurations) {
      if (cfg.runnable) allConfigs.set(cfg.id, cfg)
    }
  }

  let targetIds: string[] = []
  let compoundGroupId: string | undefined
  let stopAllPeers = false
  let sharedPreTaskGate: Promise<boolean> | undefined
  const warnings: string[] = []

  if (request.compoundId) {
    const compound = discovered.compounds.find((c) => c.id === request.compoundId)
    if (!compound) throw new Error(`Unknown launch compound "${request.compoundId}"`)
    targetIds = [...compound.configIds]
    compoundGroupId = `${compound.id}::${options.now()}`
    stopAllPeers = compound.stopAll
    if (compound.missingTargets.length > 0) {
      warnings.push(`[compound] Skipped missing target(s): ${compound.missingTargets.join(', ')}`)
    }
    if (compound.preLaunchTask) {
      const ctx = createDefaultVariableContext(compound.workspaceFolder, options.baseEnv ?? process.env)
      const task = resolvePreLaunchTask(compound.workspaceFolder, compound.preLaunchTask, ctx)
      if (task) {
        sharedPreTaskGate = executePreTask({
          task,
          extraEnv: {},
          isStopping: () => false,
          setChild: () => {},
          onLog: () => {},
        })
      }
    }
  } else if (request.configIds && request.configIds.length > 0) {
    targetIds = Array.from(new Set(request.configIds))
  }

  if (targetIds.length === 0) {
    throw new Error('No runnable launch configurations selected')
  }

  const targets = targetIds.map((id) => {
    const found = allConfigs.get(id)
    if (!found) throw new Error(`Unknown launch configuration "${id}"`)
    return found
  })

  return {
    targets,
    compoundGroupId,
    stopAllPeers,
    warnings,
    sharedPreTaskGate,
  }
}
