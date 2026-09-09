// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalProvider } from '../../../src/modules/documents/providers/local-provider.js'

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'eyas-docs-test-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

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

describe('createLocalProvider', () => {
  it('has id "local" and type "primary"', () => {
    const provider = createLocalProvider(baseDir)
    expect(provider.id).toBe('local')
    expect(provider.type).toBe('primary')
  })

  it('put + get roundtrip with Buffer', async () => {
    const provider = createLocalProvider(baseDir)
    const content = Buffer.from('hello, world')
    const meta = { filename: 'hello.txt', mimeType: 'text/plain', sizeBytes: content.length }

    await provider.put('Ab12hello.txt', content, meta)
    const result = await provider.get('Ab12hello.txt')

    expect(result).not.toBeNull()
    const buf = await readStream(result!.data)
    expect(buf.toString()).toBe('hello, world')
    expect(result!.meta).toEqual(meta)
  })

  it('put + get roundtrip with ReadableStream input', async () => {
    const provider = createLocalProvider(baseDir)
    const content = Buffer.from('stream input')
    const meta = { filename: 'stream.bin', mimeType: 'application/octet-stream', sizeBytes: content.length }

    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue(content)
        controller.close()
      },
    })

    await provider.put('Cd34stream.bin', inputStream, meta)
    const result = await provider.get('Cd34stream.bin')

    expect(result).not.toBeNull()
    const buf = await readStream(result!.data)
    expect(buf.toString()).toBe('stream input')
    expect(result!.meta).toEqual(meta)
  })

  it('returns null for non-existent key', async () => {
    const provider = createLocalProvider(baseDir)
    const result = await provider.get('XX00nonexistent.bin')
    expect(result).toBeNull()
  })

  it('exists returns false for missing key', async () => {
    const provider = createLocalProvider(baseDir)
    expect(await provider.exists('XX00nonexistent.bin')).toBe(false)
  })

  it('delete removes file, exists returns false after', async () => {
    const provider = createLocalProvider(baseDir)
    const content = Buffer.from('delete me')
    const meta = { filename: 'todelete.txt', mimeType: 'text/plain', sizeBytes: content.length }

    await provider.put('Ef56todelete.txt', content, meta)
    expect(await provider.exists('Ef56todelete.txt')).toBe(true)

    await provider.delete('Ef56todelete.txt')
    expect(await provider.exists('Ef56todelete.txt')).toBe(false)
  })

  it('delete does not throw if file is already gone', async () => {
    const provider = createLocalProvider(baseDir)
    // Should complete without error
    await provider.delete('Gh78missing.txt')
  })

  it('uses hash-sharded directory structure', async () => {
    const provider = createLocalProvider(baseDir)
    const key = 'V1StGXR8.txt'
    const content = Buffer.from('sharded')
    const meta = { filename: key, mimeType: 'text/plain', sizeBytes: content.length }

    await provider.put(key, content, meta)

    const expectedPath = join(baseDir, 'V1', 'St', key)
    const fileStat = await stat(expectedPath)
    expect(fileStat.isFile()).toBe(true)

    const metaStat = await stat(`${expectedPath}.meta.json`)
    expect(metaStat.isFile()).toBe(true)
  })

  it('getUrl always returns null', async () => {
    const provider = createLocalProvider(baseDir)
    expect(await provider.getUrl('any-key')).toBeNull()
    expect(await provider.getUrl('any-key', 3600)).toBeNull()
  })
})
