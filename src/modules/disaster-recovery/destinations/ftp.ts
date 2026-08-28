// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createWriteStream } from 'fs'
import { Client } from 'basic-ftp'
import type { DestinationDriver } from './types.js'

/**
 * FTP / FTPS remote destination.
 *
 * settings: host, port (default 21), path (remote directory), secure ("true"|"false")
 * secrets: username, password
 */
export function createFtpDestinationDriver(): DestinationDriver {
  return {
    type: 'ftp',

    async upload(localPath, remoteName, settings, secrets) {
      const client = await connect(settings, secrets)
      try {
        const dir = settings.path || '/'
        await client.ensureDir(dir)
        await client.uploadFrom(localPath, remoteName)
      } finally {
        client.close()
      }
    },

    async list(settings, secrets) {
      const client = await connect(settings, secrets)
      try {
        const dir = settings.path || '/'
        const list = await client.list(dir)
        return list
          .filter((f) => f.isFile && f.name.endsWith('.tar.gz'))
          .map((f) => ({
            filename: f.name,
            sizeBytes: f.size,
            modifiedAt: f.modifiedAt?.toISOString(),
          }))
      } finally {
        client.close()
      }
    },

    async download(remoteName, localPath, settings, secrets) {
      const client = await connect(settings, secrets)
      try {
        const dir = settings.path || '/'
        await client.cd(dir)
        await client.downloadTo(createWriteStream(localPath), remoteName)
      } finally {
        client.close()
      }
    },

    async test(settings, secrets) {
      try {
        const client = await connect(settings, secrets)
        client.close()
        return { ok: true, message: `FTP connected to ${settings.host}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

async function connect(
  settings: Record<string, string>,
  secrets: Record<string, string>,
): Promise<Client> {
  const client = new Client(30_000)
  await client.access({
    host: settings.host,
    port: parseInt(settings.port || '21', 10),
    user: secrets.username,
    password: secrets.password,
    secure: settings.secure === 'true' || settings.secure === '1',
  })
  return client
}
