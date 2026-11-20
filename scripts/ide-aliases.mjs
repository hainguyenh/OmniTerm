import { fileURLToPath } from 'node:url'

const ideRoot = fileURLToPath(new URL('../ui/ide', import.meta.url))

/**
 * Module aliases the IDE modules under ui/ide expect: `@/` is its source root, and `invoke` goes
 * through its routing shim (platform/tauriCore.ts) so remote windows can redirect commands.
 */
export const ideAliases = [
  { find: /^@tauri-apps\/api\/core$/, replacement: `${ideRoot}/platform/tauriCore.ts` },
  { find: /^@\//, replacement: `${ideRoot}/` },
]
