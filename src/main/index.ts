import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
// App icon. electron-vite copies the `?asset` next to the bundled main process
// (so it resolves in dev + packaged); electron-builder generates the exe /
// installer / shortcut icons from `resources/icon.png` (the buildResources dir).
import icon from '../../resources/icon.png?asset'
import { ensureFrameworkWorkRoot } from './framework-paths'
import { getBizHawk } from './bizhawk'
import { registerFrameworkIpc } from './ipc/framework'
import { registerEditorIpc } from './ipc/editor'
import { registerBizHawkIpc } from './ipc/bizhawk'
import { registerLevelsIpc } from './ipc/levels'
import { registerRenderIpc } from './ipc/render'
import { registerSettingsIpc } from './ipc/settings'
import { registerProjectsIpc } from './ipc/projects'
import { registerDebugIpc } from './ipc/debug'
import { registerPatchesIpc } from './ipc/patches'
import { registerImportIpc } from './ipc/import'
import { registerValidationIpc } from './ipc/validation'

const isDev = !app.isPackaged

// Renderer-reported unsaved-changes flag (any dirty edit document) + a latch the
// close handler sets once the user confirms, so the second close goes through.
let hasUnsavedChanges = false
let forceClose = false
ipcMain.on('app:set-unsaved-changes', (_e, unsaved: boolean) => {
  hasUnsavedChanges = !!unsaved
})

// App version (package.json) for the About dialog.
ipcMain.handle('app:version', (): string => app.getVersion())

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    // Floor the window width so the toolbar + stage stay usable; the canvas
    // tracks the viewport (App.css `.se` grid-template-columns) so its
    // right-anchored overlays (coords readout, Reset view) never drift
    // off-screen above this minimum.
    minWidth: 1000,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Shiny Egg',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Quit guard: confirm before closing with unsaved changes. A native dialog
  // (blocking) is the standard for app-close; switching levels/projects has its
  // own in-app modals.
  win.on('close', (e) => {
    if (forceClose || !hasUnsavedChanges) return
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Discard & Quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Unsaved changes',
      message: 'Discard unsaved changes?',
      detail: 'You have unsaved edits. Quitting now will lose them.'
    })
    if (choice === 1) {
      forceClose = true
      win.close()
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

registerFrameworkIpc()
registerEditorIpc()
registerBizHawkIpc()
registerLevelsIpc()
registerRenderIpc()
registerSettingsIpc()
registerProjectsIpc()
registerDebugIpc()
registerPatchesIpc()
registerImportIpc()
registerValidationIpc()

app.whenReady().then(async () => {
  await ensureFrameworkWorkRoot()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Tear down BizHawk before quitting so we don't leak an EmuHawk process.
  getBizHawk().stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  getBizHawk().stop()
})
