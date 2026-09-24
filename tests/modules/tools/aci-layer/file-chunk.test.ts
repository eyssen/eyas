// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { fileChunkStrategy } from '@modules/tools/aci-layer/strategies/file-chunk'

describe('file-chunk strategy', () => {
  it('passes through small files unchanged (startLine=1, under window)', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const result = fileChunkStrategy(text, { toolName: 'file.read' })

    expect(result.truncated).toBe(false)
    expect(result.followUpHint).toBeUndefined()
    expect(result.formatted).toBe(text)
  })

  it('returns a window with header and hint for large files', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`)
    const text = lines.join('\n')

    const result = fileChunkStrategy(text, {
      toolName: 'file.read',
      options: { windowLines: 100 },
    })

    expect(result.truncated).toBe(true)
    expect(result.formatted.startsWith('[file-chunk] showing lines 1-100 of 1000\nline 1\n')).toBe(true)
    expect(result.followUpHint).toBeDefined()
    expect(result.followUpHint!).toContain('1000 lines')
  })

  it('honours startLine to slide the window', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`)
    const text = lines.join('\n')

    const result = fileChunkStrategy(text, {
      toolName: 'file.read',
      options: { windowLines: 50, startLine: 200 },
    })

    expect(result.truncated).toBe(true)
    expect(result.formatted).toContain('[file-chunk] showing lines 200-249 of 500')
    expect(result.formatted).toContain('line 200')
    expect(result.formatted).toContain('line 249')
    expect(result.formatted).not.toContain('line 199')
  })

  it('extracts .content field when raw is an object with that shape', () => {
    const content = Array.from({ length: 250 }, (_, i) => `L${i}`).join('\n')
    const result = fileChunkStrategy(
      { content, path: '/tmp/x.txt' },
      { toolName: 'file.read', options: { windowLines: 10 } },
    )
    expect(result.formatted).toContain('[file-chunk] showing lines 1-10 of 250')
  })

  it('includes pattern hint suggestion when hintPattern is given', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n')
    const result = fileChunkStrategy(lines, {
      toolName: 'file.read',
      hintPattern: 'needle',
    })
    expect(result.followUpHint).toContain('"needle"')
  })
})
