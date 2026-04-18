// ─── Auto Updater: GitHub Releases checker ───

import { app, dialog, shell, BrowserWindow } from 'electron'
import type { AppSettings } from './types'

const GITHUB_REPO = 'TheArmagan/VRCSecureLogin'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

let checkTimer: ReturnType<typeof setInterval> | null = null
let updateCallback: ((version: string) => void) | null = null

export function setUpdateCallback(cb: (version: string) => void): void {
  updateCallback = cb
}

export function startAutoUpdater(settings: Pick<AppSettings, 'autoUpdate'>): void {
  if (!settings.autoUpdate) return

  // Check on startup
  checkForUpdate()

  // Check periodically
  checkTimer = setInterval(checkForUpdate, CHECK_INTERVAL_MS)
}

export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}

async function checkForUpdate(): Promise<void> {
  try {
    const currentVersion = app.getVersion()
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'User-Agent': 'VRCSecureLogin/1.0.0',
          Accept: 'application/vnd.github.v3+json'
        }
      }
    )

    if (!response.ok) return

    const release = (await response.json()) as {
      tag_name: string
      html_url: string
      body?: string
      assets?: { name: string; browser_download_url: string }[]
    }

    const latestVersion = release.tag_name.replace(/^v/, '')

    if (isNewerVersion(latestVersion, currentVersion)) {
      console.log(`[Updater] New version available: ${latestVersion} (current: ${currentVersion})`)

      if (updateCallback) {
        updateCallback(latestVersion)
      }

      // Show notification dialog
      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (mainWindow) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Available',
          message: `VRCSecureLogin v${latestVersion} is available.`,
          detail: `You are currently running v${currentVersion}. Would you like to download the update?`,
          buttons: ['Download', 'Later'],
          defaultId: 0,
          cancelId: 1
        })

        if (result.response === 0) {
          shell.openExternal(release.html_url)
        }
      }
    }
  } catch (err) {
    console.error('[Updater] Failed to check for updates:', err)
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number)
  const currentParts = current.split('.').map(Number)

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] ?? 0
    const c = currentParts[i] ?? 0
    if (l > c) return true
    if (l < c) return false
  }

  return false
}
