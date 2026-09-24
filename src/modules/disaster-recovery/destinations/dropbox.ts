// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync, writeFileSync } from 'fs'
import type { DestinationDriver } from './types.js'

/**
 * Dropbox destination via HTTP API (no SDK — MIT-friendly, zero dep).
 *
 * settings: path (folder, e.g. /eyas-backups)
 * secrets: accessToken (Dropbox API access token or short-lived token)
 */
export function createDropboxDestinationDriver(): DestinationDriver {
  return {
    type: 'dropbox',

    async upload(localPath, remoteName, settings, secrets) {
      const token = secrets.accessToken
      if (!token) throw new Error('Dropbox accessToken secret is required')
      const destPath = joinDropboxPath(settings.path, remoteName)
      const data = readFileSync(localPath)
      const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            path: destPath,
            mode: 'overwrite',
            autorename: false,
            mute: true,
          }),
        },
        body: data,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Dropbox upload failed (${res.status}): ${text.slice(0, 300)}`)
      }
    },

    async list(settings, secrets) {
      const token = secrets.accessToken
      if (!token) throw new Error('Dropbox accessToken secret is required')
      const path = settings.path || ''
      const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: path || '', recursive: false }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Dropbox list failed (${res.status}): ${text.slice(0, 300)}`)
      }
      const json = (await res.json()) as {
        entries?: Array<{ '.tag'?: string; name?: string; size?: number; server_modified?: string }>
      }
      return (json.entries ?? [])
        .filter((e) => e['.tag'] === 'file' && e.name?.endsWith('.tar.gz'))
        .map((e) => ({
          filename: e.name!,
          sizeBytes: e.size ?? 0,
          modifiedAt: e.server_modified,
        }))
    },

    async download(remoteName, localPath, settings, secrets) {
      const token = secrets.accessToken
      if (!token) throw new Error('Dropbox accessToken secret is required')
      const destPath = joinDropboxPath(settings.path, remoteName)
      const res = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({ path: destPath }),
        },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Dropbox download failed (${res.status}): ${text.slice(0, 300)}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(localPath, buf)
    },

    async test(settings, secrets) {
      try {
        if (!secrets.accessToken) {
          return { ok: false, message: 'accessToken secret is required' }
        }
        const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secrets.accessToken}`,
          },
        })
        if (!res.ok) {
          const text = await res.text()
          return { ok: false, message: `Dropbox auth failed: ${text.slice(0, 200)}` }
        }
        const acct = (await res.json()) as { email?: string; name?: { display_name?: string } }
        return {
          ok: true,
          message: `Dropbox OK (${acct.name?.display_name ?? acct.email ?? 'account'}) path=${settings.path || '/'}`,
        }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

function joinDropboxPath(folder: string | undefined, name: string): string {
  const base = (folder ?? '').replace(/\/+$/, '')
  if (!base || base === '/') return `/${name}`
  return base.startsWith('/') ? `${base}/${name}` : `/${base}/${name}`
}
