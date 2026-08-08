// Part of eYssen. See LICENSE file for full copyright and licensing details.

import matter from 'gray-matter'
import type { VaultFrontmatter } from '../types.js'

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
  }

  return { frontmatter, content: content.trim() }
}

export function serializeVaultFile(frontmatter: VaultFrontmatter, content: string): string {
  return matter.stringify(content, frontmatter)
}
