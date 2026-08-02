import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createCodeIndexer } from '@modules/search/indexers/code/code-indexer'
import type { ContentIndexer, SearchSource } from '@modules/search/types'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let indexer: ContentIndexer
let testDir: string

beforeEach(() => {
  indexer = createCodeIndexer()
  testDir = join(tmpdir(), `eyas-code-idx-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'main.ts'), 'export function hello() { return "hi" }\n')
  writeFileSync(join(testDir, 'utils.py'), 'def greet(name):\n    return f"Hello {name}"\n')
  writeFileSync(join(testDir, 'readme.txt'), 'Not a code file\n')
  mkdirSync(join(testDir, 'node_modules'), { recursive: true })
  writeFileSync(join(testDir, 'node_modules', 'dep.ts'), 'should be excluded')
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeSource(paths: string[], exclude: string[] = []): SearchSource {
  return {
    id: 'src1', name: 'Test', type: 'code', indexer: 'code',
    config: { paths, exclude },
    status: 'idle', chunkCount: 0, errorMessage: null, lastIndexedAt: null,
    createdAt: '', updatedAt: '',
  }
}

describe('CodeIndexer', () => {
  it('supports code type sources', () => {
    expect(indexer.supports(makeSource([testDir]))).toBe(true)
    expect(indexer.supports({ ...makeSource([testDir]), type: 'docs' } as any)).toBe(false)
  })

  it('indexes code files and produces chunks', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
    const files = new Set(chunks.map(c => c.metadata.filePath))
    expect(files.size).toBeGreaterThanOrEqual(2)
  })

  it('excludes node_modules by default', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    const paths = chunks.map(c => c.metadata.filePath!)
    expect(paths.some(p => p.includes('node_modules'))).toBe(false)
  })

  it('skips non-code files', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    const paths = chunks.map(c => c.metadata.filePath!)
    expect(paths.some(p => p.includes('readme.txt'))).toBe(false)
  })

  it('sets correct metadata on chunks', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    const tsChunk = chunks.find(c => c.metadata.filePath?.endsWith('main.ts'))!
    expect(tsChunk.metadata.language).toBe('typescript')
    expect(tsChunk.metadata.lineStart).toBeGreaterThanOrEqual(1)
    expect(tsChunk.sourceId).toBe('src1')
    expect(tsChunk.collection).toBe('code')
  })
})
