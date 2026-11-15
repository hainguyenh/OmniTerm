import CloseConfirmModal from '../../components/CloseConfirmModal'

import { answerCloseConfirm, useCloseConfirm } from './sessionClose'

/** The "Close Terminal" dialog a busy session tab asks before it closes. */
export function SessionCloseConfirmHost() {
  const request = useCloseConfirm((state) => state.request)
  if (!request) return null
  return (
    <CloseConfirmModal
      isMultiple={request.multiple}
      onCancel={() => answerCloseConfirm(false)}
      onConfirm={(applyToAll) => answerCloseConfirm(true, applyToAll)}
    />
  )
}
