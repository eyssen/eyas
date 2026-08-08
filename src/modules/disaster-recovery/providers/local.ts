// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join, normalize, isAbsolute } from 'path'
import { generateId } from '@shared/crypto'
import type { BackupProvider, BackupMetadata } from '../types.js'
import {
  ALLOWED_ROOT_FILES,
  DEFAULT_BACKUP_EXCLUDES,
} from '../backup-service.js'

const BACKUP_DIR = 'data/backups'

/** Allowed base directories for backup sources */
const ALLOWED_BASES = ['data', 'config']

/**
 * Validates that a path does not escape allowed base directories.
 * Prevents path traversal attacks (CWE-22).
 */
function sanitizePath(input: string): string {
  if (isAbsolute(input)) {
    throw new Error(`Absolute path rejected: ${input}`)
  }
  const normalized = normalize(input)
  if (isAbsolute(normalized) || normalized.includes('..')) {
    throw new Error(`Path traversal rejected: ${input}`)
  }
  return normalized
}

/**
 * Validates backup source paths: under data/ or config/, or an allowlisted
 * root file needed for empty-system restore (.env, version.json, …).
 */
function validateBackupPath(input: string): string {
  const safe = sanitizePath(input)
  if ((ALLOWED_ROOT_FILES as readonly string[]).includes(safe)) {
    return safe
  }
  const isAllowed = ALLOWED_BASES.some((base) => safe === base || safe.startsWith(`${base}/`))
  if (!isAllowed) {
    throw new Error(
      `Path not allowed for backup: ${input} (must be under ${ALLOWED_BASES.join(', ')} or one of ${ALLOWED_ROOT_FILES.join(', ')})`,
    )
  }
  return safe
}

/**
 * Build tar --exclude args for runtime noise / nested archives.
 * BSD tar (macOS) and GNU tar both accept repeated --exclude=PATTERN before inputs.
 */
function tarExcludeArgs(excludes: readonly string[] = DEFAULT_BACKUP_EXCLUDES): string[] {
  return excludes.flatMap((p) => [`--exclude=${p}`])
}

/** Best-effort WAL checkpoint so the packed DB is more consistent while server is live. */
function tryCheckpointSqlite(): void {
  const dbPath = 'data/sqlite/eyas.db'
  if (!existsSync(dbPath)) return
  try {
    execFileSync('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], {
      stdio: 'pipe',
      timeout: 15_000,
    })
  } catch {
    // sqlite3 CLI may be missing — still tar WAL/SHM if present
  }
}

function readLocalVersion(): string | null {
  try {
    if (!existsSync('version.json')) return null
    const v = JSON.parse(readFileSync('version.json', 'utf-8')) as { version?: string }
    return v.version ?? null
  } catch {
    return null
  }
}

export interface BackupManifest {
  schemaVersion: 1
  id: string
  filename: string
  createdAt: string
  eyasVersion: string | null
  paths: string[]
  excludes: string[]
  /** Human restore steps for an empty machine */
  restore: string[]
}

function writeManifest(meta: BackupManifest): void {
  const path = join(BACKUP_DIR, `${meta.filename}.json`)
  writeFileSync(path, JSON.stringify(meta, null, 2), 'utf-8')
}

export function createLocalBackupProvider(): BackupProvider {
  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true })
  }

  return {
    id: 'local',

    async createBackup(paths, _outputPath) {
      const id = generateId()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `backup-${timestamp}-${id.slice(0, 8)}.tar.gz`
      // Always store in BACKUP_DIR — ignore outputPath to prevent traversal
      const fullPath = join(BACKUP_DIR, filename)

      // Validate and filter to only existing allowed paths
      const existingPaths = paths
        .map(validateBackupPath)
        .filter((p) => existsSync(p))
      if (existingPaths.length === 0) {
        throw new Error('No valid paths to back up')
      }

      // Prefer a consistent SQLite snapshot when possible
      tryCheckpointSqlite()

      // Full data/ + config/ + root restore files; excludes nested backups & runtime noise
      const excludes = [...DEFAULT_BACKUP_EXCLUDES]
      const args = [
        '-czf',
        fullPath,
        ...tarExcludeArgs(excludes),
        ...existingPaths,
      ]
      execFileSync('tar', args, { stdio: 'pipe' })

      const stat = statSync(fullPath)
      const createdAt = new Date().toISOString()
      const eyasVersion = readLocalVersion()

      const manifest: BackupManifest = {
        schemaVersion: 1,
        id,
        filename,
        createdAt,
        eyasVersion,
        paths: existingPaths,
        excludes,
        restore: [
          '1. Install the same or newer EYAS (git clone https://github.com/eyssen/eyas.git && bun install).',
          eyasVersion
            ? `2. Prefer release/tag matching this backup: ${eyasVersion} (or newer with migrations).`
            : '2. Prefer a recent release from https://github.com/eyssen/eyas/releases.',
          '3. Stop EYAS if running (./bin/eyas stop).',
          '4. From the install root: tar -xzf <this-archive.tar.gz>',
          '5. Ensure data/master.key mode 600; source .env if present (chmod 600 .env).',
          '6. ./bin/eyas start  — open the UI and verify login + providers.',
        ],
      }
      writeManifest(manifest)

      return {
        id,
        filename,
        sizeBytes: stat.size,
        createdAt,
        paths: existingPaths,
        eyasVersion,
      }
    },

    async listBackups() {
      if (!existsSync(BACKUP_DIR)) return []

      const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.tar.gz'))
      return files.map((filename) => {
        const safeFilename = sanitizePath(filename)
        const fullPath = join(BACKUP_DIR, safeFilename)
        const stat = statSync(fullPath)
        // Extract ID from filename pattern: backup-<timestamp>-<id>.tar.gz
        const idMatch = filename.match(/backup-.*-([a-z0-9]+)\.tar\.gz/)
        let paths: string[] = []
        let eyasVersion: string | null = null
        const manifestPath = join(BACKUP_DIR, `${filename}.json`)
        if (existsSync(manifestPath)) {
          try {
            const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BackupManifest
            paths = m.paths ?? []
            eyasVersion = m.eyasVersion ?? null
          } catch {
            /* ignore corrupt sidecar */
          }
        }
        return {
          id: idMatch?.[1] ?? filename,
          filename,
          sizeBytes: stat.size,
          createdAt: stat.birthtime.toISOString(),
          paths,
          eyasVersion,
        }
      })
    },

    async restoreBackup(backupId, targetDir) {
      const safeTarget = sanitizePath(targetDir)

      const backups = await this.listBackups()
      const backup = backups.find((b) => b.id === backupId || b.filename.includes(backupId))
      if (!backup) {
        throw new Error(`Backup ${backupId} not found`)
      }

      // archivePath uses backup.filename from listBackups (readdirSync) — safe
      const archivePath = join(BACKUP_DIR, backup.filename)
      if (!existsSync(archivePath)) {
        throw new Error(`Backup file ${backup.filename} not found on disk`)
      }

      if (!existsSync(safeTarget)) {
        mkdirSync(safeTarget, { recursive: true })
      }

      execFileSync('tar', ['-xzf', archivePath, '-C', safeTarget], { stdio: 'pipe' })
    },
  }
}
