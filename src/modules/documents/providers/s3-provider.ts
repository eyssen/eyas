// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Readable } from 'node:stream'
import type { StorageProvider, FileMeta } from '../types.js'

// Our own S3 abstraction — not tied to any specific SDK.
// Implementations can wrap AWS SDK v3, MinIO client, etc.
export interface S3Client {
  putObject(key: string, data: Buffer, meta: Record<string, string>): Promise<void>
  getObject(key: string): Promise<{ data: Buffer; meta: Record<string, string> } | null>
  deleteObject(key: string): Promise<void>
  headObject(key: string): Promise<{ size: number } | null>
  getPresignedUrl(key: string, expiresIn: number): Promise<string>
}

export interface S3ProviderOptions {
  client: S3Client
  bucket: string
  /** Key prefix applied to every operation, e.g. 'documents/' */
  prefix: string
}

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function bufferToReadableStream(buffer: Buffer): ReadableStream {
  const nodeStream = Readable.from(buffer)
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk))
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err) => controller.error(err))
    },
  })
}

function metaToRecord(meta: FileMeta): Record<string, string> {
  return {
    filename: meta.filename,
    mimeType: meta.mimeType,
    sizeBytes: String(meta.sizeBytes),
  }
}

function recordToMeta(record: Record<string, string>): FileMeta {
  return {
    filename: record['filename'] ?? '',
    mimeType: record['mimeType'] ?? 'application/octet-stream',
    sizeBytes: parseInt(record['sizeBytes'] ?? '0', 10),
  }
}

export function createS3Provider(options: S3ProviderOptions): StorageProvider {
  const { client, prefix } = options

  function prefixedKey(key: string): string {
    return `${prefix}${key}`
  }

  return {
    id: 's3',
    type: 'secondary',

    async put(key: string, data: Buffer | ReadableStream, meta: FileMeta): Promise<void> {
      const buffer = data instanceof Buffer ? data : await streamToBuffer(data as ReadableStream)
      await client.putObject(prefixedKey(key), buffer, metaToRecord(meta))
    },

    async get(key: string): Promise<{ data: ReadableStream; meta: FileMeta } | null> {
      const result = await client.getObject(prefixedKey(key))
      if (result === null) return null
      return {
        data: bufferToReadableStream(result.data),
        meta: recordToMeta(result.meta),
      }
    },

    async delete(key: string): Promise<void> {
      await client.deleteObject(prefixedKey(key))
    },

    async exists(key: string): Promise<boolean> {
      const head = await client.headObject(prefixedKey(key))
      return head !== null
    },

    async getUrl(key: string, expiresIn = 3600): Promise<string | null> {
      return client.getPresignedUrl(prefixedKey(key), expiresIn)
    },
  }
}
