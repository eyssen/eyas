// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface BackupMetadata {
  id: string
  filename: string
  sizeBytes: number
  createdAt: string
  paths: string[]
  /** EYAS version (from version.json) when the backup was created — for empty-system restore. */
  eyasVersion?: string | null
  /** Destination ids the archive was uploaded to after the local write. */
  remoteUploads?: string[]
}

export interface BackupProvider {
  id: string
  createBackup(paths: string[], outputPath: string): Promise<BackupMetadata>
  listBackups(): Promise<BackupMetadata[]>
  restoreBackup(backupId: string, targetDir: string): Promise<void>
}
