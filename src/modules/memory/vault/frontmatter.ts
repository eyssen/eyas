// Part of eYssen. See LICENSE file for full copyright and licensing details.

import matter from 'gray-matter'
import { MEMORY_KINDS, type MemoryKind, type VaultFrontmatter } from '../types.js'

export interface ParsedVaultFile {
  frontmatter: VaultFrontmatter
  content: string
}

export function parseVaultFile(raw: string): ParsedVaultFile {
  const { data, content } = matter(raw)

  const frontmatter: VaultFrontmatter = {
    title: data.title ?? 'Untitled',
    tags: Array.isArray(data.tags) ? data.tags : [],
    tier: data.tier === 'procedural' ? 'procedural' : 'semantic',
    links: Array.isArray(data.links) ? data.links : [],
    aliases: Array.isArray(data.aliases) ? data.aliases.map(String) : undefined,
    created: data.created ?? new Date().toISOString().split('T')[0],
    updated: data.updated ?? new Date().toISOString().split('T')[0],
    embedding_hash: data.embedding_hash,
    // An unknown kind degrades to "not declared" rather than travelling into
    // the prompt index: frontmatter is hand-editable, and later model-written.
    kind: (MEMORY_KINDS as readonly string[]).includes(data.kind) ? data.kind as MemoryKind : undefined,
    summary: typeof data.summary === 'string' && data.summary.trim() ? data.summary.trim() : undefined,
    project: typeof data.project === 'string' && data.project.trim() ? data.project.trim() : undefined,
    projectType: typeof data.projectType === 'string' && data.projectType.trim() ? data.projectType.trim() : undefined,
  }

  return { frontmatter, content: content.trim() }
}

export function serializeVaultFile(frontmatter: VaultFrontmatter, content: string): string {
  return matter.stringify(content, frontmatter)
}
