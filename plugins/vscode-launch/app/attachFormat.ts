import type { AttachDescriptor } from '../src/types'

export function describeAttachEndpoint(attach: AttachDescriptor): string {
  if (attach.kind === 'netcoredbg-server') {
    return `netcoredbg server ${attach.host ?? '127.0.0.1'}:${attach.port ?? ''}`
  }
  if (attach.kind === 'dotnet-pid') {
    return `dotnet PID ${attach.pid ?? 'pending'} (install netcoredbg for VSCodium server mode)`
  }
  if (attach.wsUrl) return attach.wsUrl
  if (attach.port !== undefined) return `${attach.host ?? '127.0.0.1'}:${attach.port}`
  if (attach.pid !== undefined) return `PID ${attach.pid}`
  return attach.note ?? 'Debug session active'
}
