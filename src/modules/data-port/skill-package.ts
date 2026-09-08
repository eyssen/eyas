// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'node:crypto'
import { basename, dirname, extname } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { extractQuotedPhrases, splitFrontmatter } from './source-frontmatter.js'
import type { SkillAsset, SkillTransformResult } from './types.js'

const FENCES: Record<string, string> = {
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sql': 'sql',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.txt': 'text',
  '.csv': 'text',
}

/** How much of one bundled text file is inlined into the skill body. The on-disk copy is always complete. */
export const MAX_INLINE_ASSET_CHARS = 200_000

/** `true` when a string already ends with a newline — the one thing every verbatim join below checks before adding its own. */
const endsWithNewline = (s: string): boolean => s.endsWith('\n')

/**
 * The clip marker names the complete on-disk copy (P-15, P-20): the inline
 * copy inside the skill body is a rendering, clipped for size; the file
 * written to the asset directory is the record, byte-exact and complete.
 */
export const truncationMarker = (onDiskPath: string | null, relPath: string): string =>
  `… (inline copy clipped at ${MAX_INLINE_ASSET_CHARS} characters — the complete file is ${onDiskPath ? `${onDiskPath}/${relPath}` : relPath})`

/** Pre-amendment marker text, kept only inside the legacy twin (P-13) — it named no path. */
const LEGACY_TRUNCATION_MARKER = '… (truncated inline; full file on disk)'

/** Markdown files are inlined as markdown (empty fence); everything else gets a fenced block. */
export function fenceLanguage(relPath: string): string {
  const ext = extname(relPath).toLowerCase()
  if (ext === '.md' || ext === '.markdown' || ext === '.mdc') return ''
  return FENCES[ext] ?? 'text'
}

/**
 * The vocabulary a user actually types. Quoted phrases in the description come
 * first because they were written to be matched; the name, the name read aloud
 * (`alpha-ticket` → `alpha ticket`) and the H1 follow as fallbacks.
 */
export function deriveTriggers(name: string, description: string, h1: string | null): string[] {
  const out: string[] = []
  const push = (v: string | null | undefined): void => {
    const s = (v ?? '').trim()
    if (s && !out.includes(s)) out.push(s)
  }
  extractQuotedPhrases(description).forEach(push)
  push(name)
  push(name.replace(/[-_]+/g, ' '))
  push(h1)
  return out.slice(0, 24)
}

function assetBytes(content: string | Buffer): number {
  return Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8')
}

function isBinaryAsset(asset: SkillAsset): boolean {
  return asset.binary ?? Buffer.isBuffer(asset.content)
}

/**
 * A fence long enough to hold the file: markdown ends a block at the first run of
 * backticks at least as long as the opening one, so a file that itself contains
 * ``` needs a longer fence. Widening keeps the bundled file byte-for-byte what it
 * was — escaping the backticks would not.
 */
function fenceFor(text: string): string {
  let longest = 0
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The inline copy, verbatim up to the cap; the clip is the ONLY change ever made to an asset's bytes (P-15). */
function inlineText(content: string | Buffer, onDiskDir: string | null, relPath: string): string {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content
  // UTF-16 length is an upper bound on the code-point count, so a file under the
  // cap by units is under it by code points too and never needs the array.
  if (text.length <= MAX_INLINE_ASSET_CHARS) return text
  // Clipped by code point: slicing by UTF-16 unit can cut a surrogate pair in
  // half and leave a lone surrogate in the skill body.
  const points = Array.from(text)
  if (points.length <= MAX_INLINE_ASSET_CHARS) return text
  return `${points.slice(0, MAX_INLINE_ASSET_CHARS).join('')}\n${truncationMarker(onDiskDir, relPath)}`
}

/** The pre-amendment inline clip: `.trimEnd()`ed first, no on-disk path named (P-13). */
function inlineTextLegacy(content: string | Buffer): string {
  const text = (Buffer.isBuffer(content) ? content.toString('utf8') : content).trimEnd()
  if (text.length <= MAX_INLINE_ASSET_CHARS) return text
  const points = Array.from(text)
  if (points.length <= MAX_INLINE_ASSET_CHARS) return text
  return `${points.slice(0, MAX_INLINE_ASSET_CHARS).join('')}\n${LEGACY_TRUNCATION_MARKER}`
}

/**
 * A fenced, verbatim rendering of one non-markdown asset: the closing fence
 * lands on its own line whether or not the file itself ends with one, and
 * nothing else about the text is touched.
 */
function fenced(text: string, lang: string): string {
  const fence = fenceFor(text)
  return `${fence}${lang}\n${text}${endsWithNewline(text) ? '' : '\n'}${fence}\n`
}

/**
 * Two relative paths in true UTF-8 byte order — the ONE comparator every part of
 * the import orders package files with, so the scanner's asset list, the content
 * digest taken over the assembled body and the applied skill cannot drift apart.
 *
 * `Buffer.compare` rather than `<`, which compares UTF-16 code units. The two
 * disagree for any name mixing astral characters with BMP characters above
 * U+E000: `📄` is U+1F4C4 (lead unit 0xD83D, first UTF-8 byte 0xF0) and `Ａ` is
 * U+FF21 (unit 0xFF21, first byte 0xEF), so the rules order them oppositely.
 * Byte order is the one every other tool on the file agrees with. Never
 * `localeCompare`, whose result depends on the host locale and would make the
 * digest machine-dependent.
 */
export function compareRelPathBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * By path, byte order, on a COPY: the assembled body — and the content digest
 * taken over it — is then the same whatever order the scanner happened to walk
 * the directory in.
 */
export function sortAssetsByPath(assets: SkillAsset[]): SkillAsset[] {
  return [...assets].sort((a, b) => compareRelPathBytes(a.relPath, b.relPath))
}

/**
 * The skill body plus every bundled file, appended verbatim. A binary file is
 * named and sized rather than inlined; `onDiskDir`, when the importer kept a
 * copy on disk, tells the agent where the runnable originals live.
 *
 * `notBundled` names the files of the package that were deliberately left OUT —
 * too large to inline, or possible secrets (A7.8). Without this the owner finds
 * a lone noise row in the scan and no trace of the file in the skill that
 * referenced it, and an agent following the skill's own instructions runs into
 * a missing file with no explanation.
 */
export function assembleSkillContent(
  body: string,
  assets: SkillAsset[],
  onDiskDir: string | null,
  notBundled: ReadonlyArray<{ relPath: string; bytes: number; reason: string; notDownloaded?: boolean }> = [],
): string {
  if (!assets.length && !notBundled.length) return body
  // The body's own trailing blank lines (if any) survive verbatim; only a body
  // with NO trailing newline at all gets exactly one added, so the `---` rule
  // never runs into the body's last line of text.
  const parts = [`${body}${endsWithNewline(body) ? '' : '\n'}`, '---', '']
  if (assets.length) parts.push('## Bundled files (imported verbatim)', '')
  if (onDiskDir) {
    parts.push(`Files are also stored at \`${onDiskDir.replace(/\/?$/, '/')}\` so scripts can be run from there.`, '')
  }
  const sorted = sortAssetsByPath(assets)
  sorted.forEach((a, i) => {
    const isLastSection = i === sorted.length - 1 && !notBundled.length
    if (isBinaryAsset(a)) {
      const kib = Math.max(1, Math.round(assetBytes(a.content) / 1024))
      parts.push(`### ${a.relPath} (binary, ${kib} KiB, stored on disk)`)
      if (!isLastSection) parts.push('')
      return
    }
    const lang = fenceLanguage(a.relPath)
    const text = inlineText(a.content, onDiskDir, a.relPath)
    parts.push(`### ${a.relPath}`, '')
    // Markdown is inlined as markdown, verbatim (its own trailing newline, if
    // any, is kept); everything else is fenced, verbatim inside the fence.
    parts.push(lang === '' ? `${text}${endsWithNewline(text) ? '' : '\n'}` : fenced(text, lang))
    if (!isLastSection) parts.push('')
  })
  if (notBundled.length) {
    /*
     * A-76. What actually REACHES this list, checked against its producers
     * rather than against what the section was once for:
     *
     *   service.ts — the bundled path resolves outside the package directory,
     *                logged "not read"
     *   service.ts — the file could not be read at import time
     *   scan-path.ts — the file's bytes were never on this machine (A-66),
     *                  the only producer that sets `notDownloaded`
     *
     * A clipped inline copy is NOT among them: `inlineText` clips in place and
     * writes its own truncation marker into the body, never touching this list.
     * Neither is a P-17 file. So the earlier intro described two cases that
     * cannot occur, and A-74's rewrite made it worse by adding "the complete
     * copy is in this skill's asset directory" — a promise that is false for
     * every one of the three real producers, since not one of them writes
     * anything to the asset directory. An agent following the skill would open
     * a path that does not exist.
     *
     * So neither branch promises a copy. The split stays, because the REMEDY
     * differs: a placeholder is one the owner can tick to get, and the other two
     * are not.
     */
    const byPath = (a: { relPath: string }, b: { relPath: string }): number =>
      compareRelPathBytes(a.relPath, b.relPath)
    const line = (f: { relPath: string; bytes: number; reason: string }): string =>
      `- \`${f.relPath}\` (${Math.max(1, Math.round(f.bytes / 1024))} KiB) — ${f.reason}`
    // Byte-wise, like the assets above, so the section does not depend on the
    // order the scanner happened to walk the directory in.
    const unwritten = [...notBundled].filter((f) => !f.notDownloaded).sort(byPath)
    const absent = [...notBundled].filter((f) => f.notDownloaded).sort(byPath)

    parts.push('### Not bundled', '')
    if (unwritten.length) {
      parts.push('A file below belongs to this package but was not written to this skill\'s asset directory. Each line says why:', '')
      for (const f of unwritten) parts.push(line(f))
      if (absent.length) parts.push('')
    }
    if (absent.length) {
      parts.push('A file below belongs to this package but its bytes were not on this machine when it was imported — it is stored in the cloud and was deliberately not downloaded. There is NO local copy of it, in the asset directory or anywhere else:', '')
      for (const f of absent) parts.push(line(f))
    }
  }
  return parts.join('\n')
}

/** Pre-amendment shape, kept ONLY to recognise packages imported before R11.5 (P-13). */
export function assembleSkillContentLegacy(
  body: string,
  assets: SkillAsset[],
  onDiskDir: string | null,
  notBundled: ReadonlyArray<{ relPath: string; bytes: number; reason: string; notDownloaded?: boolean }> = [],
): string {
  if (!assets.length && !notBundled.length) return body
  const parts = [body.trimEnd(), '', '---', '']
  if (assets.length) parts.push('## Bundled files (imported verbatim)', '')
  if (onDiskDir) {
    parts.push(`Files are also stored at \`${onDiskDir.replace(/\/?$/, '/')}\` so scripts can be run from there.`, '')
  }
  for (const a of sortAssetsByPath(assets)) {
    if (isBinaryAsset(a)) {
      const kib = Math.max(1, Math.round(assetBytes(a.content) / 1024))
      parts.push(`### ${a.relPath} (binary, ${kib} KiB, stored on disk)`, '')
      continue
    }
    const text = inlineTextLegacy(a.content)
    const lang = fenceLanguage(a.relPath)
    parts.push(`### ${a.relPath}`, '')
    if (lang === '') parts.push(text, '')
    else {
      const fence = fenceFor(text)
      parts.push(fence + lang, text, fence, '')
    }
  }
  if (notBundled.length) {
    parts.push('### Not bundled', '')
    parts.push('These files belong to the package but were left out of the import:', '')
    const left = [...notBundled].sort((a, b) => compareRelPathBytes(a.relPath, b.relPath))
    for (const f of left) {
      const kib = Math.max(1, Math.round(f.bytes / 1024))
      parts.push(`- \`${f.relPath}\` (${kib} KiB) — ${f.reason}`)
    }
    parts.push('')
  }
  return parts.join('\n').trimEnd()
}

/**
 * The frontmatter keys a skill row actually has a field for. Everything else —
 * `allowed-tools`, `argument-hint`, `model`, `metadata`, whatever the next
 * assistant invents — would otherwise be read and then dropped, so it is kept
 * in the body instead (`## Source frontmatter`). Nothing the source declared is
 * lost, and the fenced block is inert text to any agent reading the skill.
 */
function unmappedFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const mapped = new Set(['name', 'description'])
  if (Array.isArray(data.trigger_patterns)) mapped.add('trigger_patterns')
  else if (Array.isArray(data.triggers)) mapped.add('triggers')
  if (Array.isArray(data.capabilities)) mapped.add('capabilities')
  else if (Array.isArray(data.tags)) mapped.add('tags')
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!mapped.has(key)) out[key] = value
  }
  return out
}

/** The body with its unmapped frontmatter appended as a fenced YAML block. The body is never trimmed (R11.5). */
export function appendSourceFrontmatter(body: string, data: Record<string, unknown>): string {
  const rest = unmappedFrontmatter(data)
  if (Object.keys(rest).length === 0) return body
  let yaml: string
  try {
    yaml = stringifyYaml(rest)
  } catch {
    // A value YAML cannot round-trip costs the provenance block, never the skill.
    return body
  }
  if (!yaml) return body
  const fence = fenceFor(yaml)
  return `${body}${endsWithNewline(body) ? '' : '\n'}\n## Source frontmatter\n\n${fence}yaml\n${yaml}${endsWithNewline(yaml) ? '' : '\n'}${fence}\n`
}

/** Pre-amendment shape, kept ONLY to recognise packages imported before R11.5 (P-13). */
export function appendSourceFrontmatterLegacy(body: string, data: Record<string, unknown>): string {
  const rest = unmappedFrontmatter(data)
  if (Object.keys(rest).length === 0) return body
  let yaml: string
  try {
    yaml = stringifyYaml(rest).trimEnd()
  } catch {
    return body
  }
  if (!yaml) return body
  const fence = fenceFor(yaml)
  return `${body.trimEnd()}\n\n## Source frontmatter\n\n${fence}yaml\n${yaml}\n${fence}\n`
}

/**
 * A skill package read off disk, with no model in the loop: the frontmatter is
 * the metadata, the body is the body, and the bundled files travel alongside
 * until apply time.
 */
export function buildSkillFromPackage(input: {
  relativePath: string
  raw: string
  assets: SkillAsset[]
  /**
   * What the package holds but the import did not write to the asset directory,
   * so the body can name it (A7.8). `notDownloaded` marks the one producer
   * whose remedy differs — the owner can tick that row and get the file.
   *
   * A-77: the flag has to be IN this type. Without it the array only carried it
   * by reference, and the first person to `.map()` this list would drop the flag,
   * silently turning every placeholder back into the wrong sentence with the
   * whole suite still green.
   */
  notBundled?: Array<{ relPath: string; bytes: number; reason: string; notDownloaded?: boolean }>
  /** The SKILL.md file itself (or its container) looked like a secret, independent of any asset. */
  containsSecrets?: boolean
}): SkillTransformResult {
  const { data, body } = splitFrontmatter(input.raw)
  const rel = input.relativePath.replace(/\\/g, '/')
  const base = basename(rel)
  const stem = base.replace(/\.(md|markdown|mdc|txt)$/i, '')
  const dir = basename(dirname(rel))
  // A SKILL.md is named after the directory it defines; every other file is
  // named after itself, or `.claude/commands/deploy.md` would become "commands".
  const fallbackName = base.toLowerCase() === 'skill.md' && dir && dir !== '.' ? dir : stem
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
  const declaredTriggers = Array.isArray(data.trigger_patterns)
    ? data.trigger_patterns.map(String)
    : Array.isArray(data.triggers)
      ? data.triggers.map(String)
      : []
  const capabilities = Array.isArray(data.capabilities)
    ? data.capabilities.map(String)
    : Array.isArray(data.tags)
      ? data.tags.map(String)
      : []
  // A flag, never a refusal (D-7): the SKILL.md's own frontmatter/body OR any
  // bundled asset may be the reason, and either is enough to tag the package.
  const containsSecrets = input.containsSecrets || input.assets.some((a) => a.containsSecrets) || undefined
  return {
    name,
    description,
    trigger_patterns: [...new Set([...declaredTriggers, ...deriveTriggers(name, description, h1)])],
    capabilities,
    content: appendSourceFrontmatter(body, data),
    skill_type: 'knowledge',
    assets: input.assets,
    ...(input.notBundled?.length ? { notBundled: input.notBundled } : {}),
    ...(containsSecrets ? { containsSecrets: true } : {}),
    sourcePath: input.relativePath,
    rawSha256: createHash('sha256').update(input.raw).digest('hex'),
  }
}
