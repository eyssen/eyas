import { describe, it, expect } from 'vitest'
import { packChunks } from '@modules/search/graph-rank/context-selector'
import type { SymbolNode } from '@modules/search/graph-rank/types'

function sym(id: string, over: Partial<SymbolNode> = {}): SymbolNode {
  return {
    id,
    name: id,
    filePath: '/a.ts',
    lineStart: 1,
    lineEnd: 10,
    content: 'x'.repeat(40), // ~10 tokens at 4 chars/token
    ...over,
  }
}

describe('packChunks', () => {
  it('respects the token budget', () => {
    const symbols = new Map<string, SymbolNode>()
    for (let i = 0; i < 10; i++) {
      const s = sym(`s${i}`, { filePath: `/f${i}.ts`, content: 'y'.repeat(400) })
      symbols.set(s.id, s)
    }
    const ranked = [...symbols.keys()].map((id, i) => ({ symbolId: id, score: 100 - i }))

    // Budget = 50 tokens → each chunk is 100 tokens, so at most 0 should fit.
    const { chunks, tokensUsed } = packChunks(ranked, symbols, 50, 200, 4)
    expect(chunks.length).toBe(0)
    expect(tokensUsed).toBe(0)
  })

  it('packs the highest-ranked chunks first', () => {
    const symbols = new Map<string, SymbolNode>()
    symbols.set('a', sym('a', { filePath: '/a.ts', content: 'A'.repeat(40) }))
    symbols.set('b', sym('b', { filePath: '/b.ts', content: 'B'.repeat(40) }))
    symbols.set('c', sym('c', { filePath: '/c.ts', content: 'C'.repeat(40) }))
    const ranked = [
      { symbolId: 'b', score: 30 },
      { symbolId: 'a', score: 20 },
      { symbolId: 'c', score: 10 },
    ]
    const { chunks } = packChunks(ranked, symbols, 50, 200, 4)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]!.file).toBe('/b.ts')
  })

  it('truncates chunks longer than maxChunkLines', () => {
    const longContent = Array.from({ length: 500 }, (_, i) => `line${i}`).join('\n')
    const s = sym('x', { content: longContent, lineStart: 1, lineEnd: 500 })
    const symbols = new Map<string, SymbolNode>([['x', s]])
    const { chunks } = packChunks(
      [{ symbolId: 'x', score: 1 }],
      symbols,
      100_000,
      50, // truncate to 50 lines
      4,
    )
    expect(chunks.length).toBe(1)
    const emittedLines = chunks[0]!.content.split('\n').length
    expect(emittedLines).toBe(50)
  })

  it('deduplicates overlapping chunks from the same file', () => {
    // Two symbols covering overlapping line ranges in the same file.
    const symbols = new Map<string, SymbolNode>()
    symbols.set('outer', sym('outer', {
      filePath: '/same.ts',
      lineStart: 1,
      lineEnd: 20,
      content: 'outer body',
    }))
    symbols.set('inner', sym('inner', {
      filePath: '/same.ts',
      lineStart: 5,
      lineEnd: 10,
      content: 'inner body',
    }))
    const ranked = [
      { symbolId: 'outer', score: 2 },
      { symbolId: 'inner', score: 1 },
    ]
    const { chunks } = packChunks(ranked, symbols, 100_000, 200, 4)
    // The outer is packed first; the inner overlaps it and must be skipped.
    expect(chunks.length).toBe(1)
    expect(chunks[0]!.startLine).toBe(1)
  })

  it('allows non-overlapping chunks from the same file', () => {
    const symbols = new Map<string, SymbolNode>()
    symbols.set('top', sym('top', { filePath: '/f.ts', lineStart: 1, lineEnd: 10, content: 'top' }))
    symbols.set('bot', sym('bot', { filePath: '/f.ts', lineStart: 50, lineEnd: 60, content: 'bot' }))
    const ranked = [
      { symbolId: 'top', score: 2 },
      { symbolId: 'bot', score: 1 },
    ]
    const { chunks } = packChunks(ranked, symbols, 100_000, 200, 4)
    expect(chunks.length).toBe(2)
  })

  it('returns an empty result when budget is zero', () => {
    const s = sym('a', { content: 'data' })
    const symbols = new Map([['a', s]])
    const { chunks, tokensUsed } = packChunks(
      [{ symbolId: 'a', score: 1 }],
      symbols,
      0,
      200,
      4,
    )
    expect(chunks.length).toBe(0)
    expect(tokensUsed).toBe(0)
  })
})
