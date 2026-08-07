type InvokeHandler = (method: string, ...args: unknown[]) => unknown

type Host = {
  registerInvokeHandler(handler: InvokeHandler): void
  services: { log(message: string): void }
}

export const name = '@omniterm/always-awake'

export function activate(host: Host): void {
  host.registerInvokeHandler((method, ..._args) => {
    if (method === 'alwaysAwake.info') {
      return {
        name: 'Always Awake',
        description: 'Prevents Windows sleep for a selected schedule, always or while terminal work is active.',
        modes: ['always', 'activeOnly'],
        durations: ['today', '24h', 'nextMonday'],
      }
    }
    throw new Error(`Unknown Always Awake method "${method}"`)
  })
  host.services.log('Always Awake activated')
}

export function deactivate(): void {}

export default { name, activate, deactivate }
