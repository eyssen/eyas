// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spreadsheet/CSV parser contract. Covers the .xlsx path (binary parsing) and
// the delimited-text path (CSV with quoted fields, TSV by extension). Pins the
// behavior so the parser can be reimplemented without the abandoned `xlsx`
// (SheetJS npm build) that carries unpatched CVEs.

import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseXlsx, parseCsv } from '@modules/search/indexers/files/parsers/xlsx-parser'

async function makeXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(['name', 'age'])
  ws.addRow(['Alice', 30])
  ws.addRow(['Bob', 25])
  const ab = await wb.xlsx.writeBuffer()
  return Buffer.from(ab as ArrayBuffer)
}

describe('xlsx-parser', () => {
  it('parses an xlsx workbook into chunks with a tab-joined header prefix', async () => {
    const chunks = await parseXlsx(await makeXlsxBuffer(), '/docs/data.xlsx')
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].title).toBe('Sheet1')
    expect(chunks[0].filePath).toBe('/docs/data.xlsx')
    expect(chunks[0].content).toContain('name\tage')
    expect(chunks[0].content).toContain('Alice')
    expect(chunks[0].content).toContain('Bob')
  })

  it('parses CSV, preserving a comma inside a quoted field as one cell', () => {
    const csv = 'name,note\nAlice,"hello, world"\nBob,plain'
    const chunks = parseCsv(csv, '/docs/data.csv')
    expect(chunks[0].content).toContain('name\tnote')
    expect(chunks[0].content).toContain('hello, world')
    expect(chunks[0].content).toContain('Bob\tplain')
  })

  it('parses TSV by tab delimiter (from the .tsv extension)', () => {
    const tsv = 'a\tb\n1\t2'
    const chunks = parseCsv(tsv, '/docs/data.tsv')
    expect(chunks[0].content).toContain('a\tb')
    expect(chunks[0].content).toContain('1\t2')
  })
})
