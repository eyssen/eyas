// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { PDFParse } from 'pdf-parse'
import { chunkMarkdown, type DocChunk } from '../../docs/file-reader.js'

/**
 * Parse a PDF buffer into semantic chunks via text extraction + markdown chunker.
 */
export async function parsePdf(buffer: Buffer, filePath: string): Promise<DocChunk[]> {
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  const text = result.text.trim()
  if (!text) return []
  return chunkMarkdown(text, filePath)
}
