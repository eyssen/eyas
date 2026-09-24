// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ExtensionPack, InstalledExtension } from './types.js'
import { extensionRegistry } from './registry.js'

export function createExtensionManager(db: any, logger: any, dataDir: string) {
  const extensionsDir = `${dataDir}/extensions`

  function toInstalled(raw: any): InstalledExtension {
    return {
      id: raw.id,
      version: raw.version,
      licenseAcceptedAt: raw.license_accepted_at,
      installedAt: raw.installed_at,
      updatedAt: raw.updated_at,
      enabled: raw.enabled === 1,
      installPath: raw.install_path,
    }
  }

  return {
    /** List all available extension packs from registry */
    listAvailable(): (ExtensionPack & { status: string })[] {
      const installed = this.listInstalled()
      const installedMap = new Map(installed.map(i => [i.id, i]))

      return extensionRegistry.map(pack => {
        const inst = installedMap.get(pack.id)
        let status = 'available'
        if (inst) {
          status = inst.version === pack.version ? 'installed' : 'update-available'
          if (!inst.enabled) status = 'disabled'
        }
        return { ...pack, status }
      })
    },

    /** List installed extensions */
    listInstalled(): InstalledExtension[] {
      const rows = db.all(sql`SELECT * FROM installed_extensions ORDER BY installed_at DESC`) as any[]
      return rows.map(toInstalled)
    },

    /** Get installed extension by ID */
    getInstalled(id: string): InstalledExtension | null {
      const rows = db.all(sql`SELECT * FROM installed_extensions WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toInstalled(rows[0]) : null
    },

    /** Install an extension pack (requires prior license acceptance) */
    async install(packId: string): Promise<{ ok: boolean; error?: string; installPath?: string }> {
      const pack = extensionRegistry.find(p => p.id === packId)
      if (!pack) return { ok: false, error: 'Extension not found in registry' }

      const existing = this.getInstalled(packId)
      if (existing) return { ok: false, error: 'Extension already installed' }

      try {
        const { mkdir, writeFile, unlink } = await import('fs/promises')
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const execFileAsync = promisify(execFile)

        const installPath = `${packId}`
        const fullPath = `${extensionsDir}/${installPath}`
        await mkdir(fullPath, { recursive: true })

        // Download archive
        const response = await fetch(pack.downloadUrl)
        if (!response.ok) return { ok: false, error: `Download failed: ${response.status} ${response.statusText}` }

        // Verify checksum if provided
        const buffer = await response.arrayBuffer()
        if (pack.sha256) {
          const hasher = new Bun.CryptoHasher('sha256')
          hasher.update(new Uint8Array(buffer))
          const actual = hasher.digest('hex')
          if (actual !== pack.sha256) {
            return { ok: false, error: `Checksum mismatch: expected ${pack.sha256}, got ${actual}` }
          }
        }

        // Extract tar.gz to install path (using execFile — no shell injection)
        const tarPath = `${fullPath}/_download.tar.gz`
        await writeFile(tarPath, new Uint8Array(buffer))
        await execFileAsync('tar', ['-xzf', tarPath, '-C', fullPath])
        await unlink(tarPath)

        // Record installation in DB
        const now = new Date().toISOString()
        db.run(sql`INSERT INTO installed_extensions (id, version, license, license_compat, license_accepted_at, installed_at, updated_at, enabled, install_path)
          VALUES (${pack.id}, ${pack.version}, ${pack.license}, ${pack.licenseCompat}, ${now}, ${now}, ${now}, 1, ${installPath})`)

        logger.info({ packId, version: pack.version, path: installPath }, 'Extension installed')
        return { ok: true, installPath }
      } catch (err: any) {
        logger.error({ packId, error: err.message }, 'Extension installation failed')
        return { ok: false, error: err.message }
      }
    },

    /** Uninstall an extension */
    async uninstall(packId: string): Promise<{ ok: boolean; error?: string }> {
      const installed = this.getInstalled(packId)
      if (!installed) return { ok: false, error: 'Extension not installed' }

      try {
        const { rm } = await import('fs/promises')
        const fullPath = `${extensionsDir}/${installed.installPath}`
        await rm(fullPath, { recursive: true, force: true })

        db.run(sql`DELETE FROM installed_extensions WHERE id = ${packId}`)
        logger.info({ packId }, 'Extension uninstalled')
        return { ok: true }
      } catch (err: any) {
        logger.error({ packId, error: err.message }, 'Extension uninstall failed')
        return { ok: false, error: err.message }
      }
    },

    /** Toggle extension enabled/disabled */
    toggle(packId: string): { ok: boolean; enabled?: boolean } {
      const installed = this.getInstalled(packId)
      if (!installed) return { ok: false }

      const now = new Date().toISOString()
      const newEnabled = installed.enabled ? 0 : 1
      db.run(sql`UPDATE installed_extensions SET enabled = ${newEnabled}, updated_at = ${now} WHERE id = ${packId}`)
      return { ok: true, enabled: newEnabled === 1 }
    },

    /** Get the directory where extensions store their skill files */
    getExtensionsDir(): string {
      return extensionsDir
    },

    /** Get all enabled extension skill directories for the skill loader */
    getEnabledSkillDirs(): string[] {
      const installed = this.listInstalled()
      return installed
        .filter(i => i.enabled)
        .map(i => `${extensionsDir}/${i.installPath}`)
    },
  }
}
