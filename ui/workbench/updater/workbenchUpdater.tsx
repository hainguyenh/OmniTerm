import { Channel, invoke } from '@tauri-apps/api/core'

import {
  call,
  commands,
  isCancelled,
  isTauri,
  nextRequestId,
  onIdeEvent,
  type UpdateInfo,
  type UpdateProgress,
  type UpdateSource,
} from '../../ide/platform/ipc'
import { t } from '../../ide/platform/i18n'
import { notifications } from '../../ide/workbench/contributions'
import { upsertTask } from '../../ide/workbench/tasks'
import { CHECK_TASK_ID, INSTALL_TASK_ID, UPDATE_KEY, progressText } from './updateTypes'
import { UpdateBalloonBody } from './UpdateBalloonBody'
import { setAvailableUpdate } from './availableUpdate'
import { effectiveUpdateSource, saveUpdateSource } from './updateSourceSetting'

let checking: Promise<void> | null = null
let installing: Promise<void> | null = null
let activeSessionChecker: (() => boolean) | null = null

/** The update source from Settings › Updates (`general.updateSource`). */
export function getUpdateSource(): UpdateSource {
  return effectiveUpdateSource()
}

export function setUpdateSource(source: UpdateSource) {
  void saveUpdateSource(source)
}

export function setActiveSessionChecker(checker: (() => boolean) | null) {
  activeSessionChecker = checker
}

export function hasActiveSessions(): boolean {
  return activeSessionChecker ? activeSessionChecker() : false
}

export function checkForUpdates(source = getUpdateSource()): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  checking ??= runCheck(source).finally(() => {
    checking = null
  })
  return checking
}

async function runCheck(source: UpdateSource): Promise<void> {
  const title = t('app.update.checking')
  let abandon = () => {}
  const abandoned = new Promise<'cancelled'>((resolve) => {
    abandon = () => resolve('cancelled')
  })
  upsertTask({
    id: CHECK_TASK_ID,
    title,
    message: null,
    fraction: null,
    done: false,
    cancel: () => abandon(),
  })

  try {
    const res = await Promise.race([call(commands.appCheckUpdate(source)), abandoned])
    if (res === 'cancelled') return
    if (!res.enabled) {
      notifications().notify({
        level: 'info',
        title: t('app.update.disabled'),
        body: t('app.update.disabledBody'),
        key: UPDATE_KEY,
        group: 'updates',
        userInitiated: true,
      })
    } else if (!res.update) {
      const info = await commands.appBuildInfo()
      notifications().notify({
        level: 'info',
        title: t('app.update.none', { version: info.version }),
        key: UPDATE_KEY,
        group: 'updates',
        userInitiated: true,
      })
    } else if (!installing) {
      notifyUpdate(res.update, true)
    }
  } catch (error) {
    notifications().notify({
      level: 'error',
      title: t('app.update.failed'),
      body: error instanceof Error ? error.message : String(error),
      key: UPDATE_KEY,
      group: 'updates',
      userInitiated: true,
    })
  } finally {
    upsertTask({ id: CHECK_TASK_ID, title, message: null, fraction: 1, done: true })
  }
}

const SOURCE_NAMES: Record<UpdateSource, string> = { github: 'GitHub', cnb: 'CNB' }

/** Offered once a download failed or was cancelled (likely too slow): the same install from the other source. */
function otherSourceAction(version: string, source: UpdateSource) {
  const other: UpdateSource = source === 'cnb' ? 'github' : 'cnb'
  return {
    label: t('app.update.retryWith', { source: SOURCE_NAMES[other] }),
    run: () => {
      setUpdateSource(other)
      void installUpdate(version, other)
    },
  }
}

/** The balloon shows the first paragraph; the whole notes are for the release page. */
export function updateSummary(notes: string | null | undefined): string | undefined {
  const text = notes?.trim()
  if (!text) return undefined
  const paragraph = text.split(/\r?\n\s*\r?\n/)[0]?.trim() || text
  return paragraph.length > 300 ? paragraph.slice(0, 300).trimEnd() + '…' : paragraph
}

export function notifyUpdate(update: UpdateInfo, userInitiated = false): void {
  // The title bar indicator stays until the update is installed; clicking it shows this balloon again.
  setAvailableUpdate(update, (shown) => notifyUpdate(shown, true))
  notifications().notify({
    level: 'info',
    title: t('app.update.available', { version: update.version }),
    body: updateSummary(update.notes),
    sticky: true,
    key: UPDATE_KEY,
    group: 'updates',
    actions: [{ label: t('app.update.install'), run: () => void installUpdate(update.version) }],
    userInitiated,
  })
}

export function installUpdate(version: string, source = getUpdateSource()): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  installing ??= runInstall(version, source).finally(() => {
    installing = null
  })
  return installing
}

export async function requestRestart(): Promise<void> {
  if (hasActiveSessions()) {
    notifications().notify({
      level: 'warning',
      title: 'Cannot restart OmniTerm',
      body: 'A process or debug session is currently running. Please terminate it before restarting.',
      key: UPDATE_KEY,
      group: 'updates',
      userInitiated: true,
    })
    throw new Error('ActiveSessionGuardError: Cannot restart while a session is active')
  }
  await commands.appRestart().catch(() => {})
}

async function runInstall(version: string, source: UpdateSource): Promise<void> {
  const title = `Downloading update ${version}`
  const request = nextRequestId()
  const cancel = () => {
    void invoke('app_cancel_update', { token: String(request) }).catch(() => {})
    void commands.cancelRequest(request).catch(() => {})
  }
  const channel = new Channel<UpdateProgress>()

  const balloon = (actions?: Array<{ label: string; run: () => void }>) =>
    notifications().notify({
      level: 'info',
      title,
      body: <UpdateBalloonBody task={INSTALL_TASK_ID} />,
      sticky: true,
      key: UPDATE_KEY,
      group: 'updates',
      actions,
      userInitiated: true,
    })

  let installingShown = false
  channel.onmessage = (p) => {
    const { message, fraction } = progressText(p)
    if (p.type === 'installing' && !installingShown) {
      installingShown = true
      balloon()
    }
    upsertTask({
      id: INSTALL_TASK_ID,
      title,
      message,
      fraction,
      done: false,
      cancel: p.type === 'installing' ? undefined : cancel,
      uncancellable:
        p.type === 'installing' ? t('app.update.installUncancellable') : undefined,
    })
  }

  upsertTask({ id: INSTALL_TASK_ID, title, message: null, fraction: null, done: false, cancel })
  balloon([{ label: t('app.update.cancel'), run: cancel }])

  try {
    await call(commands.appInstallUpdate(source, request, channel))
  } catch (error) {
    if (isCancelled(error)) {
      notifications().notify({
        level: 'info',
        title: t('app.update.cancelled'),
        key: UPDATE_KEY,
        group: 'updates',
        actions: [otherSourceAction(version, source)],
        userInitiated: true,
      })
    } else {
      notifications().notify({
        level: 'error',
        title: t('app.update.installFailed'),
        body: error instanceof Error ? error.message : String(error),
        key: UPDATE_KEY,
        group: 'updates',
        actions: [
          { label: t('app.update.retry'), run: () => void installUpdate(version, source) },
          otherSourceAction(version, source),
        ],
        userInitiated: true,
      })
    }
    return
  } finally {
    upsertTask({ id: INSTALL_TASK_ID, title, message: null, fraction: 1, done: true })
  }

  setAvailableUpdate(null)
  notifications().notify({
    level: 'info',
    title: t('app.update.installed', { version }),
    body: t('app.update.installedBody'),
    sticky: true,
    key: UPDATE_KEY,
    group: 'updates',
    actions: [{ label: t('app.update.restart'), run: () => void requestRestart().catch(() => {}) }],
    userInitiated: true,
  })
  // The app restarts by itself; the balloon stays when a running process or debug
  // session cancels the restart, so the update applies on the next start.
  void requestRestart().catch(() => {})
}

export function installUpdateChecks(): () => void {
  const off = onIdeEvent('updateAvailable', ({ update }) => {
    if (!installing) notifyUpdate(update, false)
  })
  return () => {
    off()
  }
}
