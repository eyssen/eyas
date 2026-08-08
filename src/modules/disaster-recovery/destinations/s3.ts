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
      const client = await createS3Client({
        accessKeyId: secrets.accessKeyId,
        secretAccessKey: secrets.secretAccessKey,
        endpoint: settings.endpoint,
        bucket: settings.bucket,
        region: settings.region || 'auto',
      })
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
      const client = await createS3Client({
        accessKeyId: secrets.accessKeyId,
        secretAccessKey: secrets.secretAccessKey,
        endpoint: settings.endpoint,
        bucket: settings.bucket,
        region: settings.region || 'auto',
      })
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
        const client = await createS3Client({
          accessKeyId: secrets.accessKeyId,
          secretAccessKey: secrets.secretAccessKey,
          endpoint: settings.endpoint,
          bucket: settings.bucket,
          region: settings.region || 'auto',
        })
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

function joinKey(prefix: string | undefined, name: string): string {
  const p = (prefix ?? '').replace(/^\/+|\/+$/g, '')
  return p ? `${p}/${name}` : name
}
