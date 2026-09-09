// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type DestinationType = 'local' | 's3' | 'ftp' | 'dropbox' | 'ssh'

/** Non-secret destination configuration (safe to store in data/backups/destinations.json). */
export interface DestinationConfig {
  id: string
  type: DestinationType
  name: string
  enabled: boolean
  /** Type-specific public fields (endpoint, bucket, host, path, …). */
  settings: Record<string, string>
  /**
   * Map of secret field → env var name or secrets-module key.
   * e.g. { accessKeyId: "BACKUP_S3_ACCESS_KEY", secretAccessKey: "BACKUP_S3_SECRET" }
   */
  secretRefs: Record<string, string>
}

export interface DestinationStoreFile {
  /** Primary offsite target used after every local create (null = local only). */
  primaryDestinationId: string | null
  destinations: DestinationConfig[]
}

export interface RemoteObject {
  filename: string
  sizeBytes: number
  modifiedAt?: string
}

export interface DestinationDriver {
  type: DestinationType
  /** Upload a local file to the remote destination under remoteName. */
  upload(
    localPath: string,
    remoteName: string,
    settings: Record<string, string>,
    secrets: Record<string, string>,
  ): Promise<void>
  list(
    settings: Record<string, string>,
    secrets: Record<string, string>,
  ): Promise<RemoteObject[]>
  download(
    remoteName: string,
    localPath: string,
    settings: Record<string, string>,
    secrets: Record<string, string>,
  ): Promise<void>
  test(
    settings: Record<string, string>,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }>
}

export const EMPTY_STORE: DestinationStoreFile = {
  primaryDestinationId: null,
  destinations: [],
}
