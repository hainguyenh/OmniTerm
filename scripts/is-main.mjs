/**
 * "Was this module run as the CLI?" — for scripts that are both an executable gate and an importable
 * module.
 *
 * Node hands `import.meta.url` back already resolved through symlinks, but leaves `process.argv[1]`
 * exactly as the caller typed it. Comparing the two raw therefore returns false whenever the
 * checkout, the temp dir, or any parent directory is a symlink — and a gate whose `if (isMain)`
 * never fires exits 0 having done nothing. A check that passes by not running is worse than no check
 * at all, so both sides are canonicalized here, in one place.
 */

import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const canonical = (value) => {
  try {
    return realpathSync(value)
  } catch {
    // A path that cannot be resolved (deleted mid-run, or a permission wall) still has to compare
    // as *something* rather than throw out of a module's top level.
    return path.resolve(value)
  }
}

/** @param {string} moduleUrl the caller's `import.meta.url` */
export const isMain = (moduleUrl) =>
  Boolean(process.argv[1]) && canonical(fileURLToPath(moduleUrl)) === canonical(process.argv[1])
