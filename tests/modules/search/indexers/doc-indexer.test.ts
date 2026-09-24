import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDocIndexer } from '@modules/search/indexers/docs/doc-indexer'
import { chunkMarkdown } from '@modules/search/indexers/docs/file-reader'
import type { SearchSource } from '@modules/search/types'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `eyas-doc-idx-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})
afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeSource(config: Record<string, unknown>): SearchSource {
  return {
    id: 'doc1', name: 'Test Docs', type: 'docs', indexer: 'docs',
    config, status: 'idle', chunkCount: 0, errorMessage: null,
    lastIndexedAt: null, createdAt: '', updatedAt: '',
  }
}

describe('chunkMarkdown', () => {
  it('chunks by H2 headings', () => {
    const md = '# Title\n\nIntro\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B\n'
    const chunks = chunkMarkdown(md, 'test.md')
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const sections = chunks.map(c => c.section).filter(Boolean)
    expect(sections).toContain('Section A')
    expect(sections).toContain('Section B')
  })

  it('falls back to fixed chunks when no headings', () => {
    const md = 'Just plain text without any headings.\n'.repeat(100)
    const chunks = chunkMarkdown(md, 'plain.txt')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('sets title from H1', () => {
    const md = '# My Doc\n\n## Section\n\nContent\n'
    const chunks = chunkMarkdown(md, 'doc.md')
    expect(chunks.some(c => c.title === 'My Doc')).toBe(true)
  })
})

describe('DocIndexer', () => {
  it('supports docs type sources', () => {
    const indexer = createDocIndexer()
    expect(indexer.supports(makeSource({}))).toBe(true)
    expect(indexer.supports({ ...makeSource({}), type: 'code' } as any)).toBe(false)
  })

  it('indexes local markdown files', async () => {
    writeFileSync(join(testDir, 'guide.md'), '# Guide\n\n## Step 1\n\nDo this\n\n## Step 2\n\nDo that\n')
    writeFileSync(join(testDir, 'notes.txt'), 'Some notes here\n')
    const indexer = createDocIndexer()
    const chunks = await indexer.index(makeSource({ paths: [testDir] }))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].collection).toBe('docs')
    expect(chunks[0].sourceId).toBe('doc1')
  })
})
