import type { ReactElement } from 'react'

import {
  activateComparisonWindowFeatures,
  activateDeploymentWindowFeatures,
  ComparisonWindow,
  DeploymentWindow,
} from '../ide/features'
import type { AuxKind } from '../ide/platform/auxWindow'
import { installKeyboardDispatcher } from '../ide/platform/keymap'
import { activateSecondaryWindow } from '../ide/workbench/activate'

import { installAuxTheme } from '../platform/theme/installAuxTheme'

/**
 * Activates the features of an auxiliary window (comparison, Sync with Deployed) of
 * project window `parent` and returns its root view. These windows load the same page as the main
 * window, so `main.tsx` routes them here before OmniTerm's shell would mount.
 */
export function mountAuxiliaryWindow(kind: AuxKind, parent: string): ReactElement {
  activateSecondaryWindow()
  installAuxTheme()
  if (kind === 'comparison') {
    activateComparisonWindowFeatures(parent)
    installKeyboardDispatcher()
    return <ComparisonWindow />
  }
  activateDeploymentWindowFeatures(parent)
  return <DeploymentWindow />
}
