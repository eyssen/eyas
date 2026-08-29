// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { Logger } from 'pino'
import type { BackupProvider, BackupMetadata } from './types.js'
import {
  loadDestinationStore,
  resolveSecrets,
} from './destinations/store.js'
import { getDestinationDriver } from './destinations/registry.js'
import type { DestinationConfig } from './destinations/types.js'

/**
 * Default paths for a bare-metal restore onto an empty install root.
 */
export const DEFAULT_BACKUP_PATHS = [
  'data',
  'config',
  '.env',
  'docker-compose.override.yml',
  'version.json',
] as const

export const DEFAULT_BACKUP_EXCLUDES = [
  'data/backups',
  'data/tmp',
  'data/eyas.pid',
  'data/eyas.log',
] as const

export const ALLOWED_ROOT_FILES = [
  '.env',
  'docker-compose.override.yml',
  'version.json',
] as const

export interface BackupService {
  createBackup(paths?: string[]): Promise<BackupMetadata & { remoteUploads?: string[] }>
  listBackups(): Promise<BackupMetadata[]>
  restoreBackup(id: string, targetDir?: string): Promise<void>
}

export interface BackupServiceOptions {
  logger?: Logger
  /** Resolve secret values for destination secretRefs */
  getSecret?: (key: string) => Promise<string | null>
}

export function createBackupService(
  provider: BackupProvider,
  options: BackupServiceOptions = {},
): BackupService {
  const logger = options.logger

  async function uploadToPrimary(
    meta: BackupMetadata,
  ): Promise<string[]> {
    const store = loadDestinationStore()
    if (!store.primaryDestinationId) return []
    const dest = store.destinations.find(
      (d) => d.id === store.primaryDestinationId && d.enabled,
    )
    if (!dest || dest.type === 'local') return []

    const driver = getDestinationDriver(dest.type)
    if (!driver) {
      logger?.warn({ type: dest.type }, 'No driver for backup destination')
      return []
    }

    const secrets = await resolveSecrets(dest.secretRefs, options.getSecret)
    const localArchive = join('data', 'backups', meta.filename)
    if (!existsSync(localArchive)) {
      throw new Error(`Local archive missing after create: ${localArchive}`)
    }

    const uploaded: string[] = []
    await driver.upload(localArchive, meta.filename, dest.settings, secrets)
    uploaded.push(dest.id)

    const manifestPath = `${localArchive}.json`
    if (existsSync(manifestPath)) {
      try {
        await driver.upload(manifestPath, `${meta.filename}.json`, dest.settings, secrets)
      } catch (err) {
        logger?.warn({ err }, 'Failed to upload backup manifest to remote')
      }
    }

    logger?.info({ dest: dest.id, file: meta.filename }, 'Backup uploaded to remote destination')
    recordRemoteUploads(localArchive, uploaded)
    return uploaded
  }

  return {
    async createBackup(paths) {
      const backupPaths = paths ?? [...DEFAULT_BACKUP_PATHS]
      const meta = await provider.createBackup(backupPaths, '')
      let remoteUploads: string[] = []
      try {
        remoteUploads = await uploadToPrimary(meta)
      } catch (err) {
        // Local backup succeeded; remote failure should not hide that
        const message = err instanceof Error ? err.message : String(err)
        logger?.error({ err }, 'Remote backup upload failed')
        return {
          ...meta,
          remoteUploads: [],
          // surface via paths note — API can still 201 with warning in routes
          paths: [...meta.paths, `// remote-upload-failed: ${message}`],
        }
      }
      return { ...meta, remoteUploads }
    },

    async listBackups() {
      return provider.listBackups()
    },

    async restoreBackup(id, targetDir) {
      const target = targetDir ?? '.'
      // If archive missing locally, try primary remote download
      const localList = await provider.listBackups()
      const found = localList.find((b) => b.id === id || b.filename.includes(id))
      if (!found) {
        await tryDownloadFromPrimary(id, options)
      }
      return provider.restoreBackup(id, target)
    },
  }
}

function recordRemoteUploads(localArchive: string, uploaded: string[]): void {
  const manifestPath = `${localArchive}.json`
  if (!existsSync(manifestPath) || uploaded.length === 0) return
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
    raw.remoteUploads = uploaded
    writeFileSync(manifestPath, JSON.stringify(raw, null, 2), 'utf-8')
  } catch {
    /* sidecar is optional */
  }
}

async function tryDownloadFromPrimary(
  id: string,
  options: BackupServiceOptions,
): Promise<void> {
  const store = loadDestinationStore()
  if (!store.primaryDestinationId) return
  const dest = store.destinations.find((d) => d.id === store.primaryDestinationId)
  if (!dest) return
  const driver = getDestinationDriver(dest.type)
  if (!driver) return

  const secrets = await resolveSecrets(dest.secretRefs, options.getSecret)
  // Try to find matching remote object
  let remoteName: string | null = null
  try {
    const list = await driver.list(dest.settings, secrets)
    const hit = list.find((o) => o.filename.includes(id) || o.filename.includes(id.slice(0, 8)))
    remoteName = hit?.filename ?? null
  } catch {
    // list unsupported — if id looks like a filename use it
    if (id.endsWith('.tar.gz')) remoteName = id
  }
  if (!remoteName) return

  const localPath = join('data', 'backups', remoteName)
  await driver.download(remoteName, localPath, dest.settings, secrets)
  try {
    await driver.download(`${remoteName}.json`, `${localPath}.json`, dest.settings, secrets)
  } catch {
    /* optional */
  }
}

export async function testDestination(
  dest: DestinationConfig,
  getSecret?: (key: string) => Promise<string | null>,
): Promise<{ ok: boolean; message: string }> {
  if (dest.type === 'local') {
    return { ok: true, message: 'Local destination always available' }
  }
  const driver = getDestinationDriver(dest.type)
  if (!driver) return { ok: false, message: `Unknown type: ${dest.type}` }
  const secrets = await resolveSecrets(dest.secretRefs, getSecret)
  return driver.test(dest.settings, secrets)
}
