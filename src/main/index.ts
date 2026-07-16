/**
 * Proceso principal de Electron.
 * Bootstrap: rutas -> BD -> migraciones -> backup automático -> handlers IPC -> ventana.
 * Seguridad: contextIsolation, sin nodeIntegration, navegación externa bloqueada.
 */
import { app, BrowserWindow, shell, session } from 'electron'
import { join } from 'node:path'
import { getPaths } from './paths'
import { initDatabase, getDb, closeDatabase } from './db/connection'
import { runMigrations } from './db/migrate'
import { registerHandlers } from './ipc/registerHandlers'
import { get as getSetting } from './repositories/settingsRepo'
import { backupIfStale } from './services/backup'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'Software Inc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // el preload usa ipcRenderer; el renderer sigue aislado
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Bloquear navegación/apertura externa
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const paths = getPaths()
  initDatabase(paths.dbFile)
  const version = runMigrations(getDb())
  console.log('[main] esquema en versión', version, '| datos en', paths.root)

  // Backup automático si el último tiene > 24h
  await backupIfStale(getSetting('last_backup_at'), 24).catch((e) => console.warn('[backup] ', e?.message))

  // Permitir SOLO la cámara (foto de perfil con la cámara del equipo); lo demás, denegado.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  registerHandlers(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => closeDatabase())
