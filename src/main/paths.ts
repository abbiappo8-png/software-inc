/**
 * Rutas de almacenamiento en el dispositivo (Windows 11).
 *
 * Todo vive bajo app.getPath('userData'), que en Windows resuelve a
 *   C:\Users\<usuario>\AppData\Roaming\<NombreApp>\
 *
 *   userData\
 *   ├─ data\      escuela.db (+ -wal, -shm)
 *   ├─ media\     persons\<id>\profile.jpg + profile_thumb.jpg
 *   ├─ exports\   PDF / Excel generados
 *   ├─ backups\   copias de la BD
 *   ├─ files\     biblioteca de la pestaña "Archivos" (Excels del negocio)
 *   └─ logs\
 */
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export interface AppPaths {
  root: string
  dataDir: string
  dbFile: string
  mediaDir: string
  personsMediaDir: string
  exportsDir: string
  backupsDir: string
  logsDir: string
  /** Biblioteca de archivos de la pestaña "Archivos" (Excels del negocio, etc.) */
  filesDir: string
}

let cached: AppPaths | null = null

export function getPaths(): AppPaths {
  if (cached) return cached
  const root = app.getPath('userData')
  const p: AppPaths = {
    root,
    dataDir: join(root, 'data'),
    dbFile: join(root, 'data', 'escuela.db'),
    mediaDir: join(root, 'media'),
    personsMediaDir: join(root, 'media', 'persons'),
    exportsDir: join(root, 'exports'),
    backupsDir: join(root, 'backups'),
    logsDir: join(root, 'logs'),
    filesDir: join(root, 'files')
  }
  for (const dir of [p.dataDir, p.mediaDir, p.personsMediaDir, p.exportsDir, p.backupsDir, p.logsDir, p.filesDir]) {
    mkdirSync(dir, { recursive: true })
  }
  cached = p
  return p
}
