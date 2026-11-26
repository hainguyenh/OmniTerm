import type { ReactElement } from 'react'

import DialogHost from '../../components/DialogHost'
import { useDialog, type UseDialogReturn } from '../../hooks/useDialog'

/**
 * Themed alert/confirm for a settings page: the Settings window has no MainLayout to host the
 * dialogs the legacy components ask for, so each page renders `host` itself.
 */
export function useDialogHost(): Pick<UseDialogReturn, 'showAlert' | 'showConfirm'> & { host: ReactElement } {
  const { dialogState, showAlert, showConfirm } = useDialog()
  return { showAlert, showConfirm, host: <DialogHost dialogState={dialogState} /> }
}
