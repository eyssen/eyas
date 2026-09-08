// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import type { StorageProvider, FileMeta } from '../types.js'

// Derives the hash-sharded file path for a given key:
// key "V1StGXR8.txt" → "{baseDir}/V1/St/V1StGXR8.txt"
function resolvePaths(baseDir: string, key: string): { filePath: string; metaPath: string } {
  const shard1 = key.slice(0, 2)
  const shard2 = key.slice(2, 4)
  const filePath = join(baseDir, shard1, shard2, key)
  const metaPath = `${filePath}.meta.json`
  return { filePath, metaPath }
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

export function createLocalProvider(baseDir: string): StorageProvider {
  return {
    id: 'local',
    type: 'primary',

    async put(key: string, data: Buffer | ReadableStream, meta: FileMeta): Promise<void> {
      const { filePath, metaPath } = resolvePaths(baseDir, key)
      await mkdir(dirname(filePath), { recursive: true })

      const buffer = data instanceof Buffer ? data : await streamToBuffer(data as ReadableStream)
      await writeFile(filePath, buffer)
      await writeFile(metaPath, JSON.stringify(meta), 'utf-8')
    },

    async get(key: string): Promise<{ data: ReadableStream; meta: FileMeta } | null> {
      const { filePath, metaPath } = resolvePaths(baseDir, key)
      try {
        await stat(filePath)
      } catch {
        return null
      }

      const [buffer, metaRaw] = await Promise.all([
        readFile(filePath),
        readFile(metaPath, 'utf-8'),
      ])

      const meta = JSON.parse(metaRaw) as FileMeta
      const nodeStream = Readable.from(buffer)
      // Wrap Node.js Readable as a Web ReadableStream
      const data = new ReadableStream({
        start(controller) {
          nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk))
          nodeStream.on('end', () => controller.close())
          nodeStream.on('error', (err) => controller.error(err))
        },
      })

      return { data, meta }
    },

    async delete(key: string): Promise<void> {
      const { filePath, metaPath } = resolvePaths(baseDir, key)
      await Promise.allSettled([unlink(filePath), unlink(metaPath)])
    },

    async exists(key: string): Promise<boolean> {
      const { filePath } = resolvePaths(baseDir, key)
      try {
        await stat(filePath)
        return true
      } catch {
        return false
      }
    },

    async getUrl(_key: string, _expiresIn?: number): Promise<string | null> {
      return null
    },
  }
}
