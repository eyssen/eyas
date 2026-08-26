// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createS3Provider } from '../../../src/modules/documents/providers/s3-provider.js'
import type { S3Client } from '../../../src/modules/documents/providers/s3-provider.js'

function createMockS3Client(): S3Client {
  const storage = new Map<string, { data: Buffer; meta: Record<string, string> }>()
  return {
    async putObject(key, data, meta) {
      storage.set(key, { data, meta })
    },
    async getObject(key) {
      return storage.get(key) ?? null
    },
    async deleteObject(key) {
      storage.delete(key)
    },
    async headObject(key) {
      const entry = storage.get(key)
      return entry ? { size: entry.data.length } : null
    },
    async getPresignedUrl(key, expiresIn) {
      return `https://mock.s3/${key}?expires=${expiresIn}`
    },
  }
}

async function readStream(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
}

let mockClient: S3Client

beforeEach(() => {
  mockClient = createMockS3Client()
})

describe('createS3Provider', () => {
  it('has id "s3" and type "secondary"', () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    expect(provider.id).toBe('s3')
    expect(provider.type).toBe('secondary')
  })

  it('put + get roundtrip with Buffer', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    const content = Buffer.from('hello s3')
    const meta = { filename: 'hello.txt', mimeType: 'text/plain', sizeBytes: content.length }

    await provider.put('myfile.txt', content, meta)
    const result = await provider.get('myfile.txt')

    expect(result).not.toBeNull()
    const buf = await readStream(result!.data)
    expect(buf.toString()).toBe('hello s3')
    expect(result!.meta).toEqual(meta)
  })

  it('put + get roundtrip with ReadableStream input', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    const content = Buffer.from('stream data')
    const meta = { filename: 'stream.bin', mimeType: 'application/octet-stream', sizeBytes: content.length }

    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue(content)
        controller.close()
      },
    })

    await provider.put('stream.bin', inputStream, meta)
    const result = await provider.get('stream.bin')

    expect(result).not.toBeNull()
    const buf = await readStream(result!.data)
    expect(buf.toString()).toBe('stream data')
    expect(result!.meta).toEqual(meta)
  })

  it('returns null for non-existent key', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    const result = await provider.get('nonexistent.bin')
    expect(result).toBeNull()
  })

  it('exists returns false for missing key', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    expect(await provider.exists('nonexistent.bin')).toBe(false)
  })

  it('exists returns true after put', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    const content = Buffer.from('exists check')
    const meta = { filename: 'exists.txt', mimeType: 'text/plain', sizeBytes: content.length }

    await provider.put('exists.txt', content, meta)
    expect(await provider.exists('exists.txt')).toBe(true)
  })

  it('delete removes file, exists returns false after', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    const content = Buffer.from('delete me')
    const meta = { filename: 'todelete.txt', mimeType: 'text/plain', sizeBytes: content.length }

    await provider.put('todelete.txt', content, meta)
    expect(await provider.exists('todelete.txt')).toBe(true)

    await provider.delete('todelete.txt')
    expect(await provider.exists('todelete.txt')).toBe(false)
  })

  it('getUrl returns presigned URL with default expiresIn=3600', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    const url = await provider.getUrl('myfile.txt')
    expect(url).toBe('https://mock.s3/docs/myfile.txt?expires=3600')
  })

  it('getUrl respects custom expiresIn', async () => {
    const provider = createS3Provider({ client: mockClient, bucket: 'test-bucket', prefix: 'docs/' })
    const url = await provider.getUrl('myfile.txt', 7200)
    expect(url).toBe('https://mock.s3/docs/myfile.txt?expires=7200')
  })

  it('keys are correctly prefixed', async () => {
    // Use a separate spy-style client to verify prefix is applied
    const seen: string[] = []
    const spyClient: S3Client = {
      async putObject(key) { seen.push(`put:${key}`) },
      async getObject(key) { seen.push(`get:${key}`); return null },
      async deleteObject(key) { seen.push(`del:${key}`) },
      async headObject(key) { seen.push(`head:${key}`); return null },
      async getPresignedUrl(key, exp) { seen.push(`url:${key}`); return `https://mock/${key}?e=${exp}` },
    }

    const provider = createS3Provider({ client: spyClient, bucket: 'bucket', prefix: 'uploads/' })
    const meta = { filename: 'f.bin', mimeType: 'application/octet-stream', sizeBytes: 1 }

    await provider.put('f.bin', Buffer.from('x'), meta)
    await provider.get('f.bin')
    await provider.delete('f.bin')
    await provider.exists('f.bin')
    await provider.getUrl('f.bin')

    expect(seen).toEqual([
      'put:uploads/f.bin',
      'get:uploads/f.bin',
      'del:uploads/f.bin',
      'head:uploads/f.bin',
      'url:uploads/f.bin',
    ])
  })
})
