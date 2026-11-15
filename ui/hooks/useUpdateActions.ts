import { useState } from 'react'
import type { UseDialogReturn } from './useDialog'

interface UpdateActionsInput {
  updateState: UpdateState | null
  setUpdateState: (state: UpdateState | null) => void
  showAlert: UseDialogReturn['showAlert']
}

/**
 * Update-channel actions for the main layout: check now, download portable/installer builds,
 * and manage the skipped version. Split out of useMainLayoutBase so the layout hook stays about
 * session/pane orchestration — these handlers only touch the updates bridge and the shared alert
 * dialog.
 */
export function useUpdateActions({ updateState, setUpdateState, showAlert }: UpdateActionsInput) {
  const [updateChecking, setUpdateChecking] = useState(false)
  const [installerChoiceOpen, setInstallerChoiceOpen] = useState(false)

  const checkForUpdates = async () => {
    setInstallerChoiceOpen(false)
    setUpdateChecking(true)
    try {
      setUpdateState(await window.omnitermAPI.updates.check())
    } catch (err) {
      await showAlert(`Could not check for updates: ${err instanceof Error ? err.message : String(err)}`, {
        title: 'Update Check Failed',
        tone: 'error',
      })
    } finally {
      setUpdateChecking(false)
    }
  }

  const handleDownloadPortable = async () => {
    if (!updateState?.latest)
      return
    const defaultName = `OmniTerm-Portable-${updateState.latest}.exe`
    const savePath = await window.omnitermAPI.updates.showSaveDialog(defaultName)
    if (!savePath)
      return
    try {
      setUpdateChecking(true)
      await window.omnitermAPI.updates.downloadPortable(savePath)
    } catch (err) {
      showAlert(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { title: 'Download Error', tone: 'error' })
    } finally {
      setUpdateChecking(false)
    }
  }

  const handleDownloadInstaller = async (installNow: boolean) => {
    setInstallerChoiceOpen(false)
    try {
      setUpdateChecking(true)
      await window.omnitermAPI.updates.downloadInstaller(installNow)
    } catch (err) {
      showAlert(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { title: 'Download Error', tone: 'error' })
    } finally {
      setUpdateChecking(false)
    }
  }

  const skipThisVersion = async () => {
    if (updateState?.latest)
      setUpdateState(await window.omnitermAPI.updates.skip(updateState.latest))
  }

  const clearSkippedVersion = async () => {
    const s = await window.omnitermAPI.updates.skip(null)
    setUpdateState(s)
  }

  return {
    updateChecking,
    setUpdateChecking,
    installerChoiceOpen,
    setInstallerChoiceOpen,
    checkForUpdates,
    handleDownloadPortable,
    handleDownloadInstaller,
    skipThisVersion,
    clearSkippedVersion,
  }
}
