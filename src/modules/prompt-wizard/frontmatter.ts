// src/modules/prompt-wizard/frontmatter.ts
import type { WorkspaceFrontmatter } from './workspace-types.js'

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n\n?/

export function parseFrontmatter(content: string): WorkspaceFrontmatter | null {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return null
  const obj: Record<string, unknown> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  if (typeof obj.schema !== 'string' || typeof obj.agentId !== 'string' || typeof obj.generatedAt !== 'string') return null
  return obj as WorkspaceFrontmatter
}

export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, '')
}

export function injectFrontmatter(content: string, fm: WorkspaceFrontmatter): string {
  const stripped = stripFrontmatter(content)
  const lines = ['---']
  for (const [key, value] of Object.entries(fm)) lines.push(`${key}: ${value}`)
  lines.push('---', '')
  return lines.join('\n') + stripped
}
