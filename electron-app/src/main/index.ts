import { app, shell, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers, loadAndApplySettings } from './lib/ipc-handlers'
import { apiServer } from './lib/api-server'
import { accountManager } from './lib/account-manager'
import { pipelineManager } from './lib/pipeline-manager'
import { registerProtocol, handleDeepLink, setDeepLinkDeps, registerDeepLinkIpc } from './lib/deeplink-handler'
import { startAutoUpdater, stopAutoUpdater, setUpdateCallback } from './lib/auto-updater'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 500,
    show: false,
    frame: false,
    resizable: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Minimize to tray instead of closing
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('VRCSecureLogin')

  updateTrayMenu()

  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

async function updateTrayMenu(): Promise<void> {
  if (!tray) return

  const accounts = await accountManager.getAccounts()
  const accountItems: Electron.MenuItemConstructorOptions[] = accounts.map((a) => ({
    label: `${a.displayName} (${a.status})`,
    enabled: false
  }))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    { label: 'Accounts', enabled: false },
    ...accountItems,
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Handle deep link from second instance
    const deepLinkUrl = commandLine.find((arg) => arg.startsWith('vrcsl://'))
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl)
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Register deep link protocol
  registerProtocol()

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('rest.armagan.vrcsecurelogin')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Create main window
    mainWindow = createWindow()

    // Register IPC handlers
    registerIpcHandlers(mainWindow)
    registerDeepLinkIpc()

    // Load settings and apply
    const settings = await loadAndApplySettings()

    // Set up deep link handler dependencies
    setDeepLinkDeps({
      mainWindow
    })

    // Set up auto-updater
    setUpdateCallback((version) => {
      mainWindow?.webContents.send('vrcsl:updateAvailable', version)
    })
    startAutoUpdater(settings)

    // Start API server
    try {
      await apiServer.start()
      console.log('[VRCSL] API server started')
    } catch (err) {
      console.error('[VRCSL] Failed to start API server:', err)
      dialog.showErrorBox(
        'VRCSecureLogin',
        `Failed to start API server on port ${settings.apiPort}. Is another instance running?`
      )
    }

    // Start account session keep-alive
    accountManager.startKeepAlive()

    // Start pipeline connections
    await pipelineManager.startAll()

    // Create system tray
    createTray()

    // Update tray when accounts change
    accountManager.on('account-online', () => updateTrayMenu())
    accountManager.on('account-offline', () => updateTrayMenu())
    accountManager.on('account-removed', () => updateTrayMenu())
    accountManager.on('session-refreshed', () => updateTrayMenu())

    // Handle deep link on startup (Windows)
    const deepLinkUrl = process.argv.find((arg) => arg.startsWith('vrcsl://'))
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      }
    })

    // Handle open-url for deep links (Linux)
    app.on('open-url', (_event, url) => {
      handleDeepLink(url)
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    stopAutoUpdater()
    accountManager.stopKeepAlive()
    pipelineManager.stopAll()
    apiServer.stop()
  })

  app.on('window-all-closed', () => {
    // Don't quit — tray keeps running
  })
}
