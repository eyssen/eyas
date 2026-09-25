// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { chmodSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { findLedgerRefBySha, hasLedgerRef } from './ledger.js'
import { legacyBody } from './source-frontmatter.js'
import type { ApplyDeps, StoredEpisodic } from './pipeline/apply.js'

/** Memoises the first answer for the life of the deps object it lives on. */
function lazy<T>(fn: () => T): () => T {
  let done = false
  let value: T
  return () => {
    if (!done) {
      value = fn()
      done = true
    }
    return value
  }
}

/** A JSON array column read back as a string list; anything else is "no tags". */
function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * The closest ancestor of `path` that actually exists, resolved through every
 * link on the way — `null` when nothing on the chain can be resolved.
 *
 * Used before a directory is created rather than after: `mkdirSync(…, {
 * recursive: true })` happily builds a tree THROUGH a symlink, so checking only
 * once the directory exists means the check comes after the package has already
 * planted folders wherever the link pointed.
 */
function realNearestExistingAncestor(path: string): string | null {
  let current = path
  // A path deeper than this inside one package is not a path; it is an attack
  // or a broken archive, and either way the walk must terminate.
  for (let depth = 0; depth < 64; depth++) {
    try {
      return realpathSync(current)
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
  return null
}

/**
 * What the importer needs from the running server, in the shape a module context
 * happens to have. Every service is optional and read at call time: a module
 * that is switched off leaves its slot `undefined`, and apply then reports the
 * item as skipped rather than pretending it filed it.
 *
 * This is deliberately structural rather than `ModuleContext`, so the wiring
 * below can be exercised against a real database and a real temp directory in a
 * test — the two idempotency queries and the asset-path wall are the pieces most
 * worth locking down, and a factory buried inside `onStart` cannot be reached.
 */
export interface ApplyDepsHost {
  db: EyasDb
  logger?: {
    info?: (o: unknown, m?: string) => void
    warn?: (o: unknown, m?: string) => void
  }
  memory?: {
    episodic?: { create: (input: unknown) => { id: string } }
    vault?: {
      write: (path: string, frontmatter: Record<string, unknown>, content: string) => void
      exists: (path: string) => boolean
      /** `frontmatter` is the vault's own typed object; apply reads its tags off it. */
      read: (path: string) => { content: string; frontmatter?: unknown } | null
    }
    indexer?: { indexAll: () => number }
  }
  skills?: {
    loader?: {
      create: (input: Parameters<NonNullable<ApplyDeps['skills']>['create']>[0]) => { id: string }
      getByName: (name: string) => { id: string; content: string; capabilities?: string[] } | null
    }
  }
  agents?: {
    registry?: {
      get: (id: string) => { id: string; systemPrompt?: string; source: string; tags?: string[] } | undefined
      create: (input: Parameters<NonNullable<ApplyDeps['agents']>['create']>[0]) => { id: string }
    }
  }
  /** The live tool registry, so an imported persona's tool names are checked against it. */
  tools?: { registry?: { has: (name: string) => boolean } }
}

export interface BuildApplyDepsInput {
  host: ApplyDepsHost
  dataDir: string
  createProposal: ApplyDeps['createProposal']
  /** Current body of an agent workspace file, or of a project type's prompt. */
  readWorkspaceFile: (agentId: string, file: string) => string | null
  /** Whose workspace an approved rules import lands in. */
  resolveDefaultAgentId: () => string | null
}

/**
 * The production `ApplyDeps`. Built fresh per job so a module that started after
 * the importer is still picked up, and so a service that has gone away since the
 * last import is seen as gone.
 *
 * The two workspace lookups are passed in rather than imported: they live in the
 * module entry point, which imports this file.
 */
export function buildApplyDeps(input: BuildApplyDepsInput): ApplyDeps {
  const { host, dataDir, createProposal } = input
  const memory = host.memory
  const skills = host.skills?.loader
  const registry = host.agents?.registry
  const logger = host.logger

  /**
   * Decided ONCE per `buildApplyDeps()` call (= once per job): are there
   * import-sourced episodic rows the ledger does not cover with a digest? Only
   * then is the tag scan below ever run — otherwise every new row would pay a
   * full-table `LIKE` over a JSON column, which is O(N²) across a 17 000-
   * transcript import at the amendment's ten-times-larger target.
   */
  const hasLegacyEpisodic = lazy(() => {
    try {
      return (
        host.db.all(
          sql`SELECT 1 FROM episodic_memories e
              WHERE e.source_id LIKE 'import:%'
                AND NOT EXISTS (
                  SELECT 1 FROM data_port_applied a
                  WHERE a.kind = 'episodic' AND a.ref = e.id AND a.sha256 IS NOT NULL
                )
              LIMIT 1`,
        ) as unknown[]
      ).length > 0
    } catch {
      // No ledger table yet (a first run on an older install): every imported
      // row is legacy by definition, so the scan is allowed.
      return true
    }
  })

  return {
    episodic: memory?.episodic
      ? {
          // R11.4/D-4: never an embedding on the import path — the row is
          // embedded later by the ordinary background pass.
          create: (input) => memory.episodic!.create({ ...input, embed: false }),
          /**
           * An already-imported row, found by the digest of the body it was made
           * from. The LEDGER answers first: it is indexed on `(kind, sha256)`,
           * so a re-run of a large import costs one keyed lookup per item
           * instead of a scan.
           *
           * The `sha:` tag scan behind it is the pre-ledger fallback, and it
           * runs only while rows the ledger cannot account for still exist.
           * `tags` is a JSON array column, hence the quoted match — an unquoted
           * `%sha:x%` would also hit `sha:xyz`.
           */
          findImported: (sha) => {
            // An install whose ledger table does not exist yet has no ledger to
            // answer from; the tag scan below still does.
            let ref: string | null = null
            try {
              ref = findLedgerRefBySha(host.db, 'episodic', sha)
            } catch {
              ref = null
            }
            if (ref) {
              const row = readEpisodic(host.db, ref)
              // A ledger row whose artifact has since been deleted is not a hit:
              // the item has to be imported again.
              if (row) return row
            }
            if (!hasLegacyEpisodic()) return null
            const legacy = (
              host.db.all(
                sql`SELECT id, source_id, tags FROM episodic_memories
                    WHERE source_id LIKE 'import:%' AND tags LIKE ${`%"sha:${sha}"%`} LIMIT 1`,
              ) as Array<{ id: string; source_id: string | null; tags: string | null }>
            )[0]
            return legacy
              ? { id: legacy.id, sourceId: legacy.source_id ?? null, tags: parseJsonArray(legacy.tags) }
              : null
          },
          /**
           * A-24 / A-8b — the same row, brought up to date. The body is replaced
           * by the verbatim bytes, the row's `sha:` tag by the verbatim digest,
           * and `addTags` merged into whatever the row already carries, so a tag
           * the owner added by hand survives.
           */
          restamp: (id, { content, sha, addTags }) => {
            const row = readEpisodic(host.db, id)
            if (!row) return
            const tags = [
              ...new Set([...(row.tags ?? []).filter((t) => !t.startsWith('sha:')), ...addTags, `sha:${sha}`]),
            ]
            host.db.run(
              sql`UPDATE episodic_memories SET content = ${content}, tags = ${JSON.stringify(tags)} WHERE id = ${id}`,
            )
          },
        }
      : undefined,
    vault: memory?.vault
      ? {
          write: (path, frontmatter, content) => memory.vault!.write(path, frontmatter, content),
          exists: (path) => memory.vault!.exists(path),
          // Apply compares against what is already on disk; without a reader
          // every re-import would land on a `-2` conflict sibling. The
          // frontmatter travels with the body so an already-stored note can be
          // re-tagged without losing what it declared — copied into a plain
          // object, because that is the shape the writer takes back.
          read: (path) => {
            const entry = memory.vault!.read(path)
            if (!entry) return null
            const frontmatter =
              entry.frontmatter && typeof entry.frontmatter === 'object'
                ? ({ ...entry.frontmatter } as Record<string, unknown>)
                : {}
            return { content: entry.content, frontmatter }
          },
        }
      : undefined,
    indexer: memory?.indexer,
    skills: skills
      ? {
          create: (input) => skills.create(input),
          /**
           * User-owned rows only: an import must never mistake a shipped skill
           * for its own earlier work. `capabilities` comes back through the
           * database rather than the loader's own shape, so the import job and
           * the secrets tag can be read off the row either way.
           */
          findByName: (name) => {
            const row = skills.getByName(name)
            if (!row) return null
            return { ...row, capabilities: row.capabilities ?? readSkillCapabilities(host.db, row.id) }
          },
          /**
           * Any earlier import whose assembled body hashes the same, found by the
           * `content-sha:` capability tag — so a package that came back under a
           * different name is recognised rather than imported twice.
           * `capabilities` is a JSON array column, hence the quoted match.
           */
          findByContentSha: (sha) => {
            try {
              const row = (
                host.db.all(
                  sql`SELECT id, capabilities FROM skills
                      WHERE source = 'user' AND capabilities LIKE ${`%"content-sha:${sha}"%`}
                      LIMIT 1`,
                ) as Array<{ id: string; capabilities: string | null }>
              )[0]
              return row ? { id: row.id, capabilities: parseJsonArray(row.capabilities) } : null
            } catch {
              return null
            }
          },
          /**
           * A-24 / A-8b / A-14 — an already-stored skill brought up to date in
           * place: the verbatim assembled body, its `content-sha:` capability
           * replaced by the verbatim digest, and `addCapabilities` merged in.
           * Never a second row, so the operator's own edits to the skill's other
           * capabilities survive.
           */
          restamp: (id, { content, sha, addCapabilities }) => {
            const capabilities = [
              ...new Set([
                ...readSkillCapabilities(host.db, id).filter((c) => !c.startsWith('content-sha:')),
                ...addCapabilities,
                `content-sha:${sha}`,
              ]),
            ]
            host.db.run(
              sql`UPDATE skills SET content = ${content}, capabilities = ${JSON.stringify(capabilities)},
                  updated_at = ${new Date().toISOString()} WHERE id = ${id} AND source = 'user'`,
            )
          },
          /**
           * Bundled files land in their own directory under the data dir. The
           * second wall behind apply's own path check: a name that resolves
           * outside the target directory is dropped, never sanitised.
           *
           * Three walls, because the package came from outside — an archive,
           * someone else's machine — and only the first of them is about the
           * NAME. `resolve` is purely lexical and `writeFileSync` follows links,
           * so a link planted inside the package would carry the write out of
           * the tree while every string still looked local.
           */
          writeAssets: (dirName, assets) => {
            const dir = resolve(dataDir, 'skills', 'imported', dirName)
            mkdirSync(dir, { recursive: true })
            // Resolved once: the data dir itself may sit under a linked path
            // (a macOS temp dir does), so every check compares real to real.
            const realDir = realpathSync(dir)
            const dropped: Array<{ path: string; reason: string }> = []

            for (const asset of assets) {
              const full = resolve(dir, asset.relPath)
              // 1. The name itself, before anything is created on disk.
              if (!full.startsWith(dir + sep)) {
                dropped.push({ path: asset.relPath, reason: 'name escapes the asset directory' })
                continue
              }

              // 2. Where the parent would REALLY be, checked BEFORE anything is
              // created: `mkdirSync` follows a symlink and builds through it, so
              // refusing afterwards would already have planted directories
              // wherever the link pointed.
              const parentDir = dirname(full)
              const anchor = realNearestExistingAncestor(parentDir)
              if (!anchor) {
                dropped.push({ path: asset.relPath, reason: 'parent directory could not be resolved' })
                continue
              }
              if (anchor !== realDir && !anchor.startsWith(realDir + sep)) {
                dropped.push({ path: asset.relPath, reason: 'parent directory resolves outside the asset directory' })
                continue
              }
              mkdirSync(parentDir, { recursive: true })

              // The same check again on what now exists: between the two lines
              // above, only this process created anything, but the file the
              // package names may still be a link planted earlier.
              let realParent: string
              try {
                realParent = realpathSync(parentDir)
              } catch {
                dropped.push({ path: asset.relPath, reason: 'parent directory could not be resolved' })
                continue
              }
              if (realParent !== realDir && !realParent.startsWith(realDir + sep)) {
                dropped.push({ path: asset.relPath, reason: 'parent directory resolves outside the asset directory' })
                continue
              }

              // 3. What is already at the name: writing through an existing
              // symlink would overwrite whatever it points at. The link is left
              // exactly as it is — replacing it would itself be a write the
              // package never asked for, and a re-import must stay a no-op.
              try {
                if (lstatSync(full).isSymbolicLink()) {
                  dropped.push({ path: asset.relPath, reason: 'target is a symlink' })
                  continue
                }
              } catch {
                /* nothing there yet — the ordinary case */
              }

              // A Buffer is written as bytes; only text goes through utf-8.
              writeFileSync(full, asset.content, { mode: asset.mode ?? 0o644 })
              // `writeFileSync`'s mode only applies when it creates the file, so
              // a re-import over an existing directory would otherwise keep
              // whatever permissions were there and leave a script unrunnable.
              if (asset.mode !== undefined) {
                try {
                  chmodSync(full, asset.mode)
                } catch {
                  /* a filesystem without POSIX modes still gets the bytes */
                }
              }
            }

            // Reported the way the apply-side guard reports its own drops: a
            // count and the offending names, so the package being short some
            // files is visible rather than silent.
            if (dropped.length > 0) {
              logger?.warn?.(
                { dir: dirName, skipped: dropped.length, paths: dropped.slice(0, 10) },
                'data-port: dropped bundled files whose path escapes the asset directory',
              )
            }
            return dir
          },
        }
      : undefined,
    agents: registry
      ? {
          get: (id) => {
            const agent = registry.get(id)
            return agent
              ? {
                  id: agent.id,
                  systemPrompt: agent.systemPrompt ?? '',
                  source: agent.source,
                  // The import job of an already-stored persona, so a re-run can
                  // name it instead of reporting an anonymous `unchanged`.
                  tags: agent.tags ?? [],
                }
              : null
          },
          // Tools are passed through exactly as the persona declared them: an
          // empty list already means "the registry's default toolset", so
          // nothing is injected on an imported agent's behalf.
          create: (input) => registry.create(input),
        }
      : undefined,
    createProposal,
    /**
     * An identical card already waiting for the same workspace file. Re-scanning
     * a tree whose rules have not been approved yet must not stack a second
     * copy of the same decision on the owner's queue.
     *
     * The comparison is made here rather than in SQL: SQLite has no sha256, and
     * a file's worth of pending rows is a handful at most. It goes through
     * `legacyBody` on both sides, so a card written before R11.5 — when the
     * proposed body was trimmed on the way in — is still recognised as the same
     * decision instead of being stacked a second time (P-13).
     */
    findPendingProposal: ({ agentId, workspaceFile, proposedBody }) => {
      try {
        const rows = host.db.all(
          sql`SELECT id, job_id, proposed_body FROM data_port_proposals
              WHERE status = 'pending' AND agent_id = ${agentId} AND workspace_file = ${workspaceFile}`,
        ) as Array<{ id: string; job_id: string | null; proposed_body: string | null }>
        const wanted = legacyBody(proposedBody, true)
        for (const row of rows) {
          if (legacyBody(row.proposed_body ?? '', true) === wanted) {
            return { id: row.id, jobId: row.job_id ?? null, proposedBody: row.proposed_body ?? '' }
          }
        }
        return null
      } catch {
        return null
      }
    },
    /**
     * A scope id only counts when this instance has that project or type. An id
     * from someone else's install would file the note somewhere nothing reads.
     */
    scopeExists: {
      project: (id) => rowExists(host.db, sql`SELECT 1 FROM projects WHERE id = ${id} LIMIT 1`),
      projectType: (id) =>
        rowExists(host.db, sql`SELECT 1 FROM project_types WHERE id = ${id} LIMIT 1`),
    },
    /**
     * Whether an earlier import recorded this artifact — the ledger half of
     * apply's provenance test, for an item whose own tags the owner has since
     * edited away. A table this install has not created yet answers "no", which
     * leaves the tags to decide alone and never promotes someone else's note to
     * the importer's.
     */
    wasImported: (kind, ref) => {
      try {
        return hasLedgerRef(host.db, kind, ref)
      } catch {
        return false
      }
    },
    // Read at call time: the tools module may register its builtins after this
    // one starts, and an absent registry means "cannot check", not "no tools".
    ...(host.tools?.registry
      ? { toolRegistry: { has: (name: string) => host.tools!.registry!.has(name) } }
      : {}),
    readWorkspaceFile: (agentId, file) => input.readWorkspaceFile(agentId, file),
    resolveDefaultAgentId: () => input.resolveDefaultAgentId(),
    logger,
  }
}

/** A skill's declared capabilities, straight from the column the lookups match on. */
function readSkillCapabilities(db: EyasDb, id: string): string[] {
  try {
    const row = (
      db.all(sql`SELECT capabilities FROM skills WHERE id = ${id} LIMIT 1`) as Array<{
        capabilities: string | null
      }>
    )[0]
    return parseJsonArray(row?.capabilities)
  } catch {
    return []
  }
}

/** One episodic row in the shape the idempotency check reads it; `null` when it is gone. */
function readEpisodic(db: EyasDb, id: string): StoredEpisodic | null {
  const row = (
    db.all(
      sql`SELECT id, source_id, tags FROM episodic_memories WHERE id = ${id} LIMIT 1`,
    ) as Array<{ id: string; source_id: string | null; tags: string | null }>
  )[0]
  return row ? { id: row.id, sourceId: row.source_id ?? null, tags: parseJsonArray(row.tags) } : null
}

/** True when the query returns a row; a table this install has not created is "no". */
function rowExists(db: EyasDb, query: unknown): boolean {
  try {
    return (db.all(query) as unknown[]).length > 0
  } catch {
    return false
  }
}
