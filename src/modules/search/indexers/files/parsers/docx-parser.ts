// Part of eYssen. See LICENSE file for full copyright and licensing details.

import mammoth from 'mammoth'
import TurndownService from 'turndown'
import { chunkMarkdown, type DocChunk } from '../../docs/file-reader.js'

const turndown = new TurndownService()

/**
 * Parse a DOCX buffer: convert to HTML via mammoth, then to markdown via turndown,
 * then chunk with chunkMarkdown.
 */
export async function parseDocx(buffer: Buffer, filePath: string): Promise<DocChunk[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer })
  if (!html.trim()) return []
  const markdown = turndown.turndown(html)
  if (!markdown.trim()) return []
  return chunkMarkdown(markdown, filePath)
}
