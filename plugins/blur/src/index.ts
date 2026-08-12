type InvokeHandler = (method: string, ...args: unknown[]) => unknown

type Host = {
  registerInvokeHandler(handler: InvokeHandler): void
  services: { log(message: string): void }
}

export const name = '@omniterm/blur'

export function activate(host: Host): void {
  host.registerInvokeHandler((method) => {
    if (method === 'blur.info') {
      return {
        name: 'Blur',
        description: 'Softly blurs OmniTerm windows while they are inactive.',
        min: 0,
        max: 16,
        step: 1,
      }
    }
    throw new Error(`Unknown Blur method "${method}"`)
  })
  host.services.log('Blur activated')
}

export function deactivate(): void {}

export default { name, activate, deactivate }
