// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { S3Client } from './s3-provider.js'

interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
  region: string
}

export async function createS3Client(creds: S3Credentials): Promise<S3Client> {
  if (typeof globalThis.Bun !== 'undefined') {
    return createBunS3Client(creds)
  }
  return createMiniS3Client(creds)
}

function createBunS3Client(creds: S3Credentials): S3Client {
  const bunS3 = new Bun.S3Client({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    endpoint: creds.endpoint,
    bucket: creds.bucket,
    region: creds.region,
  })

  return {
    async putObject(key: string, data: Buffer, meta: Record<string, string>): Promise<void> {
      await bunS3.file(key).write(data, { type: meta.mimeType })
    },

    async getObject(key: string): Promise<{ data: Buffer; meta: Record<string, string> } | null> {
      const file = bunS3.file(key)
      const exists = await file.exists()
      if (!exists) return null
      const arrayBuffer = await file.arrayBuffer()
      return {
        data: Buffer.from(arrayBuffer),
        meta: {},
      }
    },

    async deleteObject(key: string): Promise<void> {
      await bunS3.file(key).delete()
    },

    async headObject(key: string): Promise<{ size: number } | null> {
      const file = bunS3.file(key)
      const exists = await file.exists()
      if (!exists) return null
      return { size: file.size }
    },

    async getPresignedUrl(key: string, expiresIn: number): Promise<string> {
      return bunS3.file(key).presign({ expiresIn })
    },
  }
}

async function createMiniS3Client(creds: S3Credentials): Promise<S3Client> {
  // s3mini's exported symbol name varies between versions; import as `any`
  // and pick the constructor off the namespace. The `S3Client` we refer to
  // elsewhere in this file is a local alias type, not the actual export.
  const s3mini = (await import('s3mini')) as any
  const MiniS3 = s3mini.S3Client ?? s3mini.default
  const client = new MiniS3({
    accessKey: creds.accessKeyId,
    secretKey: creds.secretAccessKey,
    endPoint: creds.endpoint,
    bucket: creds.bucket,
    region: creds.region,
    pathStyle: false,
  })

  return {
    async putObject(key: string, data: Buffer, meta: Record<string, string>): Promise<void> {
      await client.putObject(key, data, { 'Content-Type': meta.mimeType })
    },

    async getObject(key: string): Promise<{ data: Buffer; meta: Record<string, string> } | null> {
      try {
        const response = await client.getObject(key)
        const arrayBuffer = await response.arrayBuffer()
        return {
          data: Buffer.from(arrayBuffer),
          meta: {},
        }
      } catch {
        return null
      }
    },

    async deleteObject(key: string): Promise<void> {
      await client.deleteObject(key)
    },

    async headObject(key: string): Promise<{ size: number } | null> {
      try {
        const response = await client.headObject(key)
        const contentLength = response.headers.get('content-length')
        return { size: contentLength ? parseInt(contentLength, 10) : 0 }
      } catch {
        return null
      }
    },

    async getPresignedUrl(key: string, expiresIn: number): Promise<string> {
      return client.getPresignedUrl('GET', key, expiresIn)
    },
  }
}
