// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { DestinationDriver, DestinationType } from './types.js'
import { createS3DestinationDriver } from './s3.js'
import { createFtpDestinationDriver } from './ftp.js'
import { createDropboxDestinationDriver } from './dropbox.js'
import { createSshDestinationDriver } from './ssh.js'

const drivers: Record<Exclude<DestinationType, 'local'>, DestinationDriver> = {
  s3: createS3DestinationDriver(),
  ftp: createFtpDestinationDriver(),
  dropbox: createDropboxDestinationDriver(),
  ssh: createSshDestinationDriver(),
}

export function getDestinationDriver(type: DestinationType): DestinationDriver | null {
  if (type === 'local') return null
  return drivers[type] ?? null
}

export function listDestinationTypes(): Array<{
  type: DestinationType
  label: string
  settings: string[]
  secrets: string[]
}> {
  return [
    {
      type: 's3',
      label: 'S3-compatible (AWS, Backblaze B2, R2, MinIO)',
      settings: ['endpoint', 'bucket', 'region', 'prefix'],
      secrets: ['accessKeyId', 'secretAccessKey'],
    },
    {
      type: 'ftp',
      label: 'FTP / FTPS',
      settings: ['host', 'port', 'path', 'secure'],
      secrets: ['username', 'password'],
    },
    {
      type: 'dropbox',
      label: 'Dropbox',
      settings: ['path'],
      secrets: ['accessToken'],
    },
    {
      type: 'ssh',
      label: 'SSH / SFTP',
      settings: ['host', 'port', 'path'],
      secrets: ['username', 'password', 'privateKey', 'passphrase'],
    },
  ]
}
