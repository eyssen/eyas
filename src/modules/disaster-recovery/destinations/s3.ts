// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync, writeFileSync } from 'fs'
import { createS3Client } from '@modules/documents/providers/s3-client-factory.js'
import type { DestinationDriver } from './types.js'

/**
 * S3-compatible object storage — AWS S3, Backblaze B2, Cloudflare R2, MinIO.
 *
 * settings: endpoint, bucket, region, prefix (optional)
 * secrets: accessKeyId, secretAccessKey
 */
export function createS3DestinationDriver(): DestinationDriver {
  return {
    type: 's3',

    async upload(localPath, remoteName, settings, secrets) {
      const client = await clientFrom(settings, secrets)
      const key = joinKey(settings.prefix, remoteName)
      const data = readFileSync(localPath)
      await client.putObject(key, data, { mimeType: 'application/gzip' })
    },

    async list(settings, secrets) {
      // Minimal list via prefix is not on our thin S3Client; use s3mini list if needed.
      // Fallback: not all clients expose list — return empty and rely on local index + remote download by name.
      void settings
      void secrets
      return []
    },

    async download(remoteName, localPath, settings, secrets) {
      const client = await clientFrom(settings, secrets)
      const key = joinKey(settings.prefix, remoteName)
      const obj = await client.getObject(key)
      if (!obj) throw new Error(`S3 object not found: ${key}`)
      writeFileSync(localPath, obj.data)
    },

    async test(settings, secrets) {
      try {
        if (!settings.endpoint || !settings.bucket) {
          return { ok: false, message: 'endpoint and bucket are required' }
        }
        if (!secrets.accessKeyId || !secrets.secretAccessKey) {
          return { ok: false, message: 'accessKeyId and secretAccessKey secrets are required' }
        }
        const client = await clientFrom(settings, secrets)
        // Probe with head on a non-existent key — auth/endpoint validation
        await client.headObject(joinKey(settings.prefix, '.eyas-probe'))
        return { ok: true, message: 'S3 endpoint reachable (credentials accepted)' }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // AccessDenied on missing key still proves auth works for some providers
        if (/NoSuchKey|NotFound|404|does not exist/i.test(msg)) {
          return { ok: true, message: 'S3 endpoint reachable' }
        }
        return { ok: false, message: msg }
      }
    },
  }
}

async function clientFrom(
  settings: Record<string, string>,
  secrets: Record<string, string>,
) {
  const { endpoint, region } = normalizeS3Settings(settings)
  return createS3Client({
    accessKeyId: secrets.accessKeyId,
    secretAccessKey: secrets.secretAccessKey,
    endpoint,
    bucket: settings.bucket,
    region,
  })
}

/** Add https:// if missing; infer Backblaze region from the hostname. */
export function normalizeS3Settings(settings: Record<string, string>): {
  endpoint: string
  region: string
} {
  const raw = (settings.endpoint ?? '').trim()
  const endpoint = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw
  const explicit = (settings.region ?? '').trim()
  if (explicit) return { endpoint, region: explicit }

  const host = endpoint.replace(/^https?:\/\//i, '').split('/')[0] ?? ''
  const b2 = host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i)
  return { endpoint, region: b2?.[1] ?? 'auto' }
}

function joinKey(prefix: string | undefined, name: string): string {
  const p = (prefix ?? '').replace(/^\/+|\/+$/g, '')
  return p ? `${p}/${name}` : name
}
