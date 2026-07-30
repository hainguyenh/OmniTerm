import { useEffect, useState } from 'react'
import { loadShellOptions, type ShellOption } from '../shellOptions'

/**
 * The shells this machine can start, probed once on mount.
 *
 * Starts empty and settles a tick later, so callers that hold a selected shell must re-validate it
 * against the result (see `pickShell`) — the saved value may name a shell that is not installed here.
 */
export function useShellOptions(): ShellOption[] {
  const [options, setOptions] = useState<ShellOption[]>([])
  useEffect(() => {
    void loadShellOptions().then(setOptions)
  }, [])
  return options
}
