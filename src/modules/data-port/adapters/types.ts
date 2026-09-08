// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CandidateKind, CandidateTarget, ImportedNoteKind, SourceProfile } from '../types.js'

/** One importable unit, read faithfully from a source file. */
export interface SourceNote {
  /** Everything after the leading frontmatter, byte for byte. */
  body: string
  hadFrontmatter: boolean
  /** The original frontmatter object, verbatim. */
  data: Record<string, unknown>
  /** The frontmatter block as written, comments and quoting included; `null` when
   *  the file had none. Provenance keeps the source text, not a re-serialisation. */
  frontmatterRaw?: string | null
  /** The YAML error when the block was frontmatter the parser could not read and
   *  `data` came from the line-based fallback. The reader has no logger of its
   *  own; the runner reports it rather than losing the failure silently. */
  frontmatterError?: string | null
  declaredKind: ImportedNoteKind | null
  title: string
  name: string | null
  description: string | null
  tags: string[]
  aliases: string[]
  links: string[]
  /** YYYY-MM-DD or null when nothing in the file or the fs says so. */
  created: string | null
  updated: string | null
  /** Scope the source itself declared (`project` / `projectType` frontmatter); the
   *  runner honours it so the note lands under that project instead of globally. */
  project: string | null
  projectType: string | null
  sessionId: string | null
  /** ISO timestamp for episodic validFrom. */
  sessionDate: string | null
}

export interface AdapterHint {
  kind: CandidateKind
  target: CandidateTarget
  confidence: number
  /** English, for logs and server-side debugging. */
  reason: string
  /** Kebab-case machine code the UI translates (`derived-index`, `memory-note`, …). */
  reasonCode: string
  selectedByDefault: boolean
  /** Classifier-/adapter-derived tags the row keeps (`legacy`, `third-party`, `contains-secrets`). */
  tags?: string[]
  /** Declared scope for a rule (globs / applyTo string), when the source narrows it. */
  scope?: string
}

/** What the scan already knows about the file's surroundings. */
export interface ClassifyContext {
  /** The scan found an Obsidian vault marker above this file. */
  inVault?: boolean
  /** The profile the owner chose in the wizard; the registry always sets it. */
  profile?: SourceProfile
}

/** What a caller may ask of an `expand`. */
export interface ExpandOptions {
  /**
   * `false` counts the render without collecting it: every unit comes back with
   * its id, its byte size and `contentOmitted: true`, and no body is held. The
   * scan uses it so a tree of transcripts is never in memory at once; the runner
   * asks for the same units again with the content when it writes them.
   */
  withContent?: boolean
  /** Largest body one unit may carry before the render is stored as ordered parts (P-5). */
  maxBodyBytes?: number
}

/** A unit inside a container file (one conversation in a JSON export, one row in a SQLite memory). */
export interface ExpandedUnit {
  unit: string
  title: string
  preview: string
  bytes: number
  hint: AdapterHint
  /** Rendered markdown for this unit; kept in memory during the scan only. */
  content: string
  /** Structured fields of the unit, verbatim — overlaid onto the SourceNote. */
  data?: Record<string, unknown>
  created?: string | null
  updated?: string | null
  sessionId?: string | null
  sessionDate?: string | null
  /** Unit-level tags the applied item keeps (`contains-secrets`, `subagent`, `session-part:n/of`, …). */
  tags?: string[]
  /** Message turns this unit holds; `null` when the unit is not a conversation. */
  turns?: number | null
  /** `content` was counted rather than collected — ask again with `withContent` to write it. */
  contentOmitted?: boolean
}

export interface ProviderAdapter {
  id: SourceProfile
  /** Root hints shown in the wizard, `~`-relative, product-neutral. */
  rootHints: string[]
  /** 0..1 — how strongly a scanned path list looks like this provider. */
  detect(relPaths: string[]): number
  /** null = not mine; the registry asks the next adapter. `head` = first 4 000 chars. */
  classify(rel: string, head: string, ctx?: ClassifyContext): AdapterHint | null
  /** Split a container file into units. Absent = one unit per file. */
  expand?(rel: string, raw: Buffer, sourcePath?: string, opts?: ExpandOptions): ExpandedUnit[]
  /** Build the SourceNote for a unit. Absent = readSourceNote on the whole file. */
  read?(rel: string, raw: Buffer, unit: string | null, times?: { mtime?: string; birthtime?: string }): SourceNote
}
