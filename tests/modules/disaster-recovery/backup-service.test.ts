import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBackupService, type BackupService } from '@modules/disaster-recovery/backup-service'
import type { BackupProvider, BackupMetadata } from '@modules/disaster-recovery/types'

function createMockProvider(): BackupProvider {
  const store: BackupMetadata[] = []

  return {
    id: 'mock',

    async createBackup(paths, outputPath) {
      const meta: BackupMetadata = {
        id: `backup-${store.length + 1}`,
        filename: `backup-${Date.now()}.tar.gz`,
        sizeBytes: 1024,
        createdAt: new Date().toISOString(),
        paths,
      }
      store.push(meta)
      return meta
    },

    async listBackups() {
      return [...store]
    },

    async restoreBackup(backupId, targetDir) {
      const found = store.find((b) => b.id === backupId)
      if (!found) throw new Error(`Backup ${backupId} not found`)
      // Mock restore — nothing to extract
    },
  }
}

describe('BackupService', () => {
  let svc: BackupService
  let provider: BackupProvider

  beforeEach(() => {
    provider = createMockProvider()
    svc = createBackupService(provider)
  })

  describe('createBackup', () => {
    it('creates a backup with default paths when none specified', async () => {
      const meta = await svc.createBackup()
      expect(meta.id).toBeTruthy()
      expect(meta.filename).toMatch(/\.tar\.gz$/)
      expect(meta.sizeBytes).toBeGreaterThan(0)
      // Default includes data + config + optional root files (.env, …).
      // Mock provider receives the full default path list; missing files are
      // filtered only in the local provider.
      expect(meta.paths).toEqual([
        'data',
        'config',
        '.env',
        'docker-compose.override.yml',
        'version.json',
      ])
    })

    it('creates a backup with custom paths', async () => {
      const customPaths = ['data/sqlite', 'config']
      const meta = await svc.createBackup(customPaths)
      expect(meta.paths).toEqual(customPaths)
    })

    it('returns valid metadata', async () => {
      const meta = await svc.createBackup()
      expect(meta.createdAt).toBeTruthy()
      expect(new Date(meta.createdAt).getTime()).not.toBeNaN()
    })
  })

  describe('listBackups', () => {
    it('returns empty array when no backups exist', async () => {
      const backups = await svc.listBackups()
      expect(backups).toEqual([])
    })

    it('returns all created backups', async () => {
      await svc.createBackup()
      await svc.createBackup(['config'])

      const backups = await svc.listBackups()
      expect(backups).toHaveLength(2)
    })
  })

  describe('restoreBackup', () => {
    it('restores a valid backup', async () => {
      const meta = await svc.createBackup()
      // Should not throw
      await expect(svc.restoreBackup(meta.id)).resolves.toBeUndefined()
    })

    it('throws when backup ID does not exist', async () => {
      await expect(svc.restoreBackup('nonexistent')).rejects.toThrow('not found')
    })

    it('passes target directory to provider', async () => {
      const meta = await svc.createBackup()
      const restoreSpy = vi.spyOn(provider, 'restoreBackup')
      await svc.restoreBackup(meta.id, '/tmp/restore-test')
      expect(restoreSpy).toHaveBeenCalledWith(meta.id, '/tmp/restore-test')
    })

    it('defaults target directory to current dir', async () => {
      const meta = await svc.createBackup()
      const restoreSpy = vi.spyOn(provider, 'restoreBackup')
      await svc.restoreBackup(meta.id)
      expect(restoreSpy).toHaveBeenCalledWith(meta.id, '.')
    })
  })

  describe('provider delegation', () => {
    it('delegates createBackup to provider', async () => {
      const spy = vi.spyOn(provider, 'createBackup')
      await svc.createBackup(['data/sqlite'])
      expect(spy).toHaveBeenCalledWith(['data/sqlite'], '')
    })

    it('delegates listBackups to provider', async () => {
      const spy = vi.spyOn(provider, 'listBackups')
      await svc.listBackups()
      expect(spy).toHaveBeenCalled()
    })
  })
})
