import type { ContentBlock } from './types.js'

export function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

export function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}
