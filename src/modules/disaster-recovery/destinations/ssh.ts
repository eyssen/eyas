// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync, writeFileSync } from 'fs'
import { Client } from 'ssh2'
import type { DestinationDriver } from './types.js'

/**
 * SFTP over SSH.
 *
 * settings: host, port (default 22), path (remote directory)
 * secrets: username, password OR privateKey (PEM string) + optional passphrase
 */
export function createSshDestinationDriver(): DestinationDriver {
  return {
    type: 'ssh',

    async upload(localPath, remoteName, settings, secrets) {
      const data = readFileSync(localPath)
      await withSftp(settings, secrets, async (sftp, path) => {
        const remote = joinRemote(path, remoteName)
        await ensureRemoteDir(sftp, path)
        await putBuffer(sftp, remote, data)
      })
    },

    async list(settings, secrets) {
      return withSftp(settings, secrets, async (sftp, path) => {
        const list = await readdir(sftp, path || '.')
        return list
          .filter((f) => f.filename.endsWith('.tar.gz') && f.attrs)
          .map((f) => ({
            filename: f.filename,
            sizeBytes: f.attrs?.size ?? 0,
            modifiedAt: f.attrs?.mtime
              ? new Date(f.attrs.mtime * 1000).toISOString()
              : undefined,
          }))
      })
    },

    async download(remoteName, localPath, settings, secrets) {
      await withSftp(settings, secrets, async (sftp, path) => {
        const remote = joinRemote(path, remoteName)
        const buf = await getBuffer(sftp, remote)
        writeFileSync(localPath, buf)
      })
    },

    async test(settings, secrets) {
      try {
        await withSftp(settings, secrets, async (sftp, path) => {
          await readdir(sftp, path || '.')
        })
        return { ok: true, message: `SSH/SFTP connected to ${settings.host}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

function joinRemote(dir: string, name: string): string {
  const base = (dir || '.').replace(/\/+$/, '')
  return `${base}/${name}`
}

async function withSftp<T>(
  settings: Record<string, string>,
  secrets: Record<string, string>,
  fn: (sftp: any, path: string) => Promise<T>,
): Promise<T> {
  const conn = new Client()
  const path = settings.path || '.'
  return new Promise<T>((resolve, reject) => {
    conn
      .on('ready', () => {
        conn.sftp(async (err, sftp) => {
          if (err) {
            conn.end()
            reject(err)
            return
          }
          try {
            const result = await fn(sftp, path)
            conn.end()
            resolve(result)
          } catch (e) {
            conn.end()
            reject(e)
          }
        })
      })
      .on('error', reject)
      .connect({
        host: settings.host,
        port: parseInt(settings.port || '22', 10),
        username: secrets.username,
        password: secrets.password || undefined,
        privateKey: secrets.privateKey || undefined,
        passphrase: secrets.passphrase || undefined,
        readyTimeout: 20_000,
      })
  })
}

function putBuffer(sftp: any, remote: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remote)
    stream.on('error', reject)
    stream.on('close', () => resolve())
    stream.end(data)
  })
}

function getBuffer(sftp: any, remote: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = sftp.createReadStream(remote)
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function readdir(sftp: any, path: string): Promise<Array<{ filename: string; attrs?: { size?: number; mtime?: number } }>> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err: Error | null, list: any[]) => {
      if (err) reject(err)
      else resolve(list ?? [])
    })
  })
}

function ensureRemoteDir(sftp: any, path: string): Promise<void> {
  if (!path || path === '.' || path === '/') return Promise.resolve()
  return new Promise((resolve) => {
    sftp.mkdir(path, (err: Error | null) => {
      // ignore "already exists"
      void err
      resolve()
    })
  })
}
