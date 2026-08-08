import { describe, it, expect } from 'vitest'
import { chunkCodeFallback, chunkCodeAST } from '@modules/search/indexers/code/ast-chunker'
import { readFileSync } from 'fs'
import { join } from 'path'

const FIXTURES = join(__dirname, '../../../fixtures/search')

describe('AST Chunker', () => {
  describe('chunkCodeFallback (regex-based)', () => {
    it('chunks TypeScript by function/class boundaries', () => {
      const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.ts', 'typescript')
      expect(chunks.length).toBeGreaterThan(0)
      const names = chunks.map(c => c.symbolName).filter(Boolean)
      expect(names).toContain('parseConfig')
      expect(names).toContain('DataService')
      expect(names).toContain('loadFile')
    })

    it('chunks Python by function/class boundaries', () => {
      const code = readFileSync(join(FIXTURES, 'sample.py'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.py', 'python')
      const names = chunks.map(c => c.symbolName).filter(Boolean)
      expect(names).toContain('SaleOrder')
      expect(names).toContain('helper_function')
    })

    it('includes imports and top-level code', () => {
      const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.ts', 'typescript')
      const hasImports = chunks.some(c => c.content.includes('import'))
      expect(hasImports).toBe(true)
    })

    it('preserves line numbers', () => {
      const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.ts', 'typescript')
      for (const chunk of chunks) {
        expect(chunk.lineStart).toBeGreaterThanOrEqual(1)
        expect(chunk.lineEnd).toBeGreaterThanOrEqual(chunk.lineStart)
      }
    })
  })

  describe('chunkCodeAST (TreeSitter)', () => {
    it('chunks TypeScript by AST nodes', async () => {
      const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
      const chunks = await chunkCodeAST(code, 'sample.ts', 'typescript')
      if (!chunks) return // TreeSitter not available in this environment
      const names = chunks.map(c => c.symbolName).filter(Boolean)
      expect(names).toContain('parseConfig')
      expect(names).toContain('DataService')
      expect(names).toContain('loadFile')
    })

    it('chunks Python by AST nodes', async () => {
      const code = readFileSync(join(FIXTURES, 'sample.py'), 'utf-8')
      const chunks = await chunkCodeAST(code, 'sample.py', 'python')
      if (!chunks) return // TreeSitter not available in this environment
      const names = chunks.map(c => c.symbolName).filter(Boolean)
      expect(names).toContain('SaleOrder')
      expect(names).toContain('helper_function')
    })

    it('returns null for unsupported language', async () => {
      const chunks = await chunkCodeAST('some code', 'file.xyz', 'cobol')
      expect(chunks).toBeNull()
    })
  })
})
