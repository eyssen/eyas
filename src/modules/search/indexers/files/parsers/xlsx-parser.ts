// Part of eYssen. See LICENSE file for full copyright and licensing details.

import ExcelJS from 'exceljs'
import type { DocChunk } from '../../docs/file-reader.js'

const ROWS_PER_CHUNK = 50

/**
 * Convert worksheet rows into DocChunk[], grouping every ROWS_PER_CHUNK rows.
 * The header row is used as a context prefix for each chunk.
 */
function sheetToChunks(
  rows: string[][],
  filePath: string,
  sheetName: string,
): DocChunk[] {
  if (rows.length === 0) return []

  const [headerRow, ...dataRows] = rows
  const header = headerRow.join('\t')

  const chunks: DocChunk[] = []

  for (let start = 0; start < dataRows.length; start += ROWS_PER_CHUNK) {
    const slice = dataRows.slice(start, start + ROWS_PER_CHUNK)
    const rowRange = `${start + 1}-${start + slice.length}`
    const content = [header, ...slice.map(r => r.join('\t'))].join('\n')
    chunks.push({
      content,
      title: sheetName,
      section: rowRange,
      filePath,
    })
  }

  // If dataRows was empty, emit a single chunk with just the header
  if (dataRows.length === 0 && header) {
    chunks.push({ content: header, title: sheetName, section: '', filePath })
  }

  return chunks
}

/**
 * Parse an Excel (.xlsx) buffer with exceljs (MIT). We deliberately do NOT use
 * the abandoned `xlsx`/SheetJS npm build, which ships unpatched CVEs
 * (prototype-pollution + ReDoS) and would run over arbitrary indexed files.
 *
 * Each sheet is indexed separately; every 50 rows become one chunk. Legacy
 * binary `.xls` (BIFF) is not supported by exceljs — such files throw here and
 * are skipped by the caller's try/catch.
 */
export async function parseXlsx(buffer: Buffer, filePath: string): Promise<DocChunk[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)

  const chunks: DocChunk[] = []

  workbook.eachSheet((sheet) => {
    const rows: string[][] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      // includeEmpty preserves gaps so columns stay tab-aligned within a row.
      row.eachCell({ includeEmpty: true }, (cell) => {
        // cell.text is exceljs's display string for any value type
        // (string/number/date/formula/richtext/hyperlink).
        cells.push(cell.text ?? '')
      })
      rows.push(cells)
    })
    chunks.push(...sheetToChunks(rows, filePath, sheet.name))
  })

  return chunks
}

/**
 * Minimal RFC 4180-style delimited parser: handles quoted fields with embedded
 * delimiters, newlines, and escaped (doubled) quotes. Sufficient for indexing
 * CSV/TSV into searchable rows; no external dependency.
 */
function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let sawAny = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++ } // escaped quote
        else inQuotes = false
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') { inQuotes = true; sawAny = true }
    else if (ch === delimiter) { row.push(field); field = ''; sawAny = true }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; sawAny = false }
    else if (ch === '\r') { /* swallow; \r\n handled by the \n branch */ }
    else { field += ch; sawAny = true }
  }
  // Flush the trailing field/row if the file did not end with a newline.
  if (sawAny || field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Parse a CSV / TSV string. The delimiter is chosen from the file extension
 * (.tsv → tab, otherwise comma). Treated as a single-sheet workbook.
 */
export function parseCsv(content: string, filePath: string): DocChunk[] {
  const delimiter = filePath.toLowerCase().endsWith('.tsv') ? '\t' : ','
  const rows = parseDelimited(content, delimiter)
  const sheetName = filePath.split('/').pop() ?? 'sheet'
  return sheetToChunks(rows, filePath, sheetName)
}
