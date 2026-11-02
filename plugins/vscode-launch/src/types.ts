export type LaunchRunMode = 'run' | 'debug'

export type EditorKind = 'codium' | 'code'

export type LaunchRunStatus = 'starting' | 'running' | 'exited' | 'failed' | 'stopped'

export interface RawCompoundTarget {
  name: string
  folder?: string
}

export interface LaunchConfigItem {
  id: string
  name: string
  type: string
  request: string
  runnable: boolean
  workspaceFolder: string
  relativeFolder: string
  program?: string
  runtimeExecutable?: string
  runtimeArgs?: string[]
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  envFile?: string
  module?: string
  python?: string
  projectPath?: string
  cargoArgs?: string[]
  preLaunchTask?: string
  stopOnEntry?: boolean
  console?: string
  port?: number
  processId?: number | string
  url?: string
}

export interface RawCompoundItem {
  id: string
  name: string
  relativeFolder: string
  workspaceFolder: string
  targets: RawCompoundTarget[]
  stopAll: boolean
  preLaunchTask?: string
}

export interface LaunchCompoundItem {
  id: string
  name: string
  relativeFolder: string
  workspaceFolder: string
  configIds: string[]
  missingTargets: string[]
  stopAll: boolean
  preLaunchTask?: string
}

export interface ParsedLaunchFile {
  version: string
  workspaceFolder: string
  relativeFolder: string
  configurations: LaunchConfigItem[]
  compounds: RawCompoundItem[]
  error?: string
}

export interface DiscoveredLaunchFile {
  launchJsonPath: string
  workspaceFolder: string
  relativeFolder: string
  version: string
  configurations: LaunchConfigItem[]
  error?: string
}

export interface DiscoveryResult {
  rootDir: string
  files: DiscoveredLaunchFile[]
  compounds: LaunchCompoundItem[]
  editors: EditorKind[]
}

export interface AttachDescriptor {
  kind: 'netcoredbg-server' | 'dotnet-pid' | 'node-inspector' | 'debugpy' | 'dlv' | 'generic'
  host?: string
  port?: number
  pid?: number
  wsUrl?: string
  attachJson?: string
  note?: string
}

export interface LaunchRunSummary {
  runId: string
  configId: string
  name: string
  type: string
  mode: LaunchRunMode
  status: LaunchRunStatus
  rootDir: string
  workspaceFolder: string
  relativeFolder: string
  cwd: string
  terminalCommand: string
  pid?: number
  exitCode?: number | null
  startedAt: number
  endedAt?: number
  listeningUrls: string[]
  attach?: AttachDescriptor
  error?: string
}

export interface LaunchLogLine {
  seq: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  timestamp: number
}

export interface LaunchLogChunk {
  runId: string
  lines: LaunchLogLine[]
  nextSeq: number
  truncated: boolean
}
