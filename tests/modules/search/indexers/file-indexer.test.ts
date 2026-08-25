import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createFileIndexer } from '@modules/search/indexers/files/file-indexer'
import type { SearchSource } from '@modules/search/types'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `eyas-file-idx-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})
afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeSource(paths: string[]): SearchSource {
  return {
    id: 'file1', name: 'Docs', type: 'files', indexer: 'files',
    config: { paths },
    status: 'idle', chunkCount: 0, errorMessage: null,
    lastIndexedAt: null, createdAt: '', updatedAt: '',
  }
}

describe('FileIndexer', () => {
  it('supports files type sources', () => {
    const indexer = createFileIndexer()
    expect(indexer.supports(makeSource([testDir]))).toBe(true)
  })

  it('indexes markdown files', async () => {
    writeFileSync(join(testDir, 'doc.md'), '# Title\n\n## Section 1\n\nContent here\n')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].collection).toBe('files')
    expect(chunks[0].metadata.filePath).toBeTruthy()
  })

  it('indexes txt files', async () => {
    writeFileSync(join(testDir, 'notes.txt'), 'Some plain text notes\n')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('indexes csv files', async () => {
    writeFileSync(join(testDir, 'data.csv'), 'Name,Age,City\nAlice,30,NYC\nBob,25,LA\n')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].content).toContain('Alice')
  })

  it('skips unsupported file types', async () => {
    writeFileSync(join(testDir, 'image.png'), 'fake png')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks).toHaveLength(0)
  })
})
