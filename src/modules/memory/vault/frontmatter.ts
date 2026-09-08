// Part of eYssen. See LICENSE file for full copyright and licensing details.

import matter from 'gray-matter'
import { MEMORY_KINDS, type MemoryKind, type VaultFrontmatter } from '../types.js'

export interface ParsedVaultFile {
  frontmatter: VaultFrontmatter
  content: string
}

/**
 * `tags` in exactly the shape this file's reader will keep.
 *
 * The reader takes `tags` only when it is a real array and discards every other
 * shape as `[]`. That mattered for more than tidiness (D-7, door 10): a writer
 * that asked `hasSecretsTag` about a caller's raw value was asking about
 * something the store would throw away — a JSON-STRING encoding of the tag list
 * reads as already-flagged to `hasSecretsTag`, which accepts that encoding, and
 * as `[]` to this reader. The note was then written holding a credential with
 * its tags reading back empty. So every writer that has to reason about tags
 * normalises through here FIRST and writes the normalised value, and the reader
 * uses the same function: one canonical form, asked and stored identically.
 */
export function normaliseFrontmatterTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.map((t) => String(t)) : []
}

/**
 * Whether a caller-supplied `tags` value is one the vault can actually keep.
 * Absent and `null` mean "not specified"; anything else that is not an array
 * would be silently discarded, so a route rejects it rather than accepting a
 * request whose tags it is about to drop.
 */
export function isStorableTagsValue(tags: unknown): boolean {
  return tags === undefined || tags === null || Array.isArray(tags)
}

export function parseVaultFile(raw: string): ParsedVaultFile {
  // The explicit (empty) options object opts out of gray-matter's unbounded
  // process-global cache, which keeps every raw string it has ever been handed
  // for the lifetime of the process.
  const { data, content } = matter(raw, {})

  const frontmatter: VaultFrontmatter = {
    title: data.title ?? 'Untitled',
    tags: normaliseFrontmatterTags(data.tags),
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
    // Import provenance. Read back so that rewriting a note (capture spreads the
    // parsed frontmatter) cannot silently strip where the note came from.
    source:
      data.source && typeof data.source === 'object' && !Array.isArray(data.source)
        ? (data.source as Record<string, unknown>)
        : undefined,
  }

  // VERBATIM (R11.5): a body's leading and trailing blank lines, its indentation
  // and its CRLF endings all survive the round trip, so a note written byte for
  // byte reads back byte for byte and an importer can tell an untouched note
  // from an edited one. gray-matter has already applied the only two changes
  // this file sanctions — the leading byte-order mark is stripped (an encoding
  // signature, not text) and the closing delimiter's own line terminator is
  // consumed. `serializeVaultFile` adds one trailing newline to a body that has
  // none; that is the writer's documented normalisation, and the other exception.
  //
  // A caller that wants the body without its surrounding whitespace must trim it
  // itself: the note-writer's history appender does, and the vault indexer's
  // derived `content_text` already did.
  return { frontmatter, content }
}

/**
 * js-yaml refuses to dump `undefined`, and an optional field left unset is not
 * an error.
 *
 * Exported because `parseVaultFile` is what creates the problem: it sets an
 * absent optional key to an explicit `undefined` rather than omitting it, so
 * anyone spreading a read-back frontmatter into a new object carries those keys
 * forward into the dumper. One copy, next to the parser that needs it.
 */
export function omitUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries({ ...obj }).filter(([, v]) => v !== undefined)) as T
}

export function serializeVaultFile(frontmatter: VaultFrontmatter, content: string): string {
  // The object form is load-bearing: given a bare string, gray-matter parses it
  // as a file first and a body that itself opens with `---` loses its own head.
  return matter.stringify({ content }, omitUndefined(frontmatter))
}
