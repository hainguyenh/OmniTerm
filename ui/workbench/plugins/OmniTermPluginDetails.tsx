import { lazy, Suspense } from 'react'

import { executeAction } from '../../ide/platform/actions'
import { closePluginsDialog } from '../../ide/features/plugins/pluginsDialogStore'

const BuiltinPluginsPage = lazy(() =>
  import('../settings/OmniTermPages').then((m) => ({ default: m.BuiltinPluginsPage })),
)

/** A plugin's Configure link leaves the dialog for that plugin's Settings page. */
function openPluginSettings(page: string): void {
  closePluginsDialog()
  void executeAction('file.settings', page)
}

/** The Plugins dialog's details pane for one of OmniTerm's Node plugins. */
export function OmniTermPluginDetails({ id }: { id: string }) {
  return (
    <Suspense fallback={null}>
      <BuiltinPluginsPage openPage={openPluginSettings} onlyPluginId={id} />
    </Suspense>
  )
}
