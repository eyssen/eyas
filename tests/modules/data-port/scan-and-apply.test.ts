// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { createDataPortRoutes } from '@modules/data-port/routes'
import { scanDirectory } from '@modules/data-port/scanners/scan-path'
import { OWN_SKILLS_CATEGORY } from '@modules/data-port/constants'
import { listApplied } from '@modules/data-port/ledger'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { buildApplyDeps, type ApplyDepsHost } from '@modules/data-port/apply-deps'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { buildMemoryIndex } from '@modules/memory/memory-index'
import { createWikilinkService } from '@shared/wikilinks'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'
import type { CreateAgentInput } from '@modules/agent/types'
import type { PublicCandidate, SourceProfile } from '@modules/data-port/types'

function createSkillsTable(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT,
    trigger_patterns TEXT, capabilities TEXT, version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL, skill_type TEXT NOT NULL DEFAULT 'knowledge',
    tool_config TEXT, integration_config TEXT, sources TEXT,
    source TEXT NOT NULL DEFAULT 'user', enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
}

const LONG_RULE = 'Never rewrite history without asking. '.repeat(400)
const LONG_SKILL = 'Run the build, then ship the bundle. '.repeat(400)
const LONG_WORKSPACE = 'Answer in the language the owner wrote in. '.repeat(500)

/** A synthetic tree carrying one file of every kind the importer knows. */
/** The transcript the fixture writes; the end-to-end case addresses it by name. */
const TRANSCRIPT_ID = '00000000-0000-4000-8000-00000000ab01'

function writeFixture(src: string): void {
  const put = (rel: string, body: string): void => {
    const full = join(src, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  put(
    'ai-memory/MEMORY.md',
    '# Index\n## Owner\n- [Owner profile hook](alpha_profile.md)\n## Rules\n- [No rewriting history](feedback_alpha_rule.md)\n',
  )
  put('ai-memory/alpha_profile.md', '---\nname: alpha_profile\ntype: user\n---\nSenior developer at Alpha Co.\n')
  put(
    'ai-memory/feedback_alpha_rule.md',
    `---\nname: feedback_alpha_rule\ndescription: Do not commit automatically\ntype: feedback\n---\n${LONG_RULE}`,
  )
  put('ai-memory/bravo_notes.md', '---\ntype: project\n---\n- alpha\n- bravo\n- charlie\n')
  put('.claude/CLAUDE.md', `# Global rules\n${LONG_WORKSPACE}`)
  // Stays a visible row saying why it was passed over — never imported.
  put('.claude/.env', 'TOKEN=not-a-real-secret-value-0000\n')
  put('.claude/agents/dev.md', '---\nname: dev\ndescription: developer\ntools:\n  - Read\n---\nYou write code.')
  put('.claude/skills/deploy/SKILL.md', `---\nname: deploy\ndescription: Use when "deploy docs"\n---\n# Deploy\n${LONG_SKILL}`)
  put('.claude/skills/deploy/scripts/deploy.sh', '#!/bin/sh\necho ship\n')
  put(
    '.grok/memory/p1/sessions/2026-09-05-alpha-run-01a0abcd.md',
    '## Session Summary\n\n- **Date:** 2026-09-05 07:25 UTC\n\n## Topics\n1. the alpha run\n',
  )

  /*
   * R11 additions (Task 17). Every detection key here is a FOLDER NAME the
   * providers themselves define (`claude-sessions/`, `.claude/projects/`) or a
   * `type:` in the file's own frontmatter — never a tenant's vault folder name,
   * which is why the vault path below is the neutral `Documents/Vault/meta`.
   */
  const putBin = (rel: string, body: Buffer): void => {
    const full = join(src, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }

  // The app's own config folder marks the subtree as a vault, which is what
  // gives those notes `source:obsidian` provenance. It sits two levels below
  // the scan root, so the ROOT profile is still decided by `.claude/`.
  put('Documents/Vault/.obsidian/app.json', '{}\n')

  // Session summaries: one per assistant, dated from their own frontmatter.
  put(
    'Documents/Vault/meta/claude-sessions/2026-08/2026-08-01_1200_alpha-session.md',
    "---\ntype: claude-session\ndate: 2026-08-01\ntime: '12:00'\n---\n# Alpha session\n\nWhat was decided.\n",
  )
  put(
    'Documents/Vault/meta/claude-sessions/2026-08/2026-08-02_0900_bravo_g01a070d1.md',
    "---\ntype: grok-session\ndate: 2026-08-02\ntime: '09:00'\n---\n# Bravo session\n\nWhat was decided.\n",
  )

  // A transcript container, its sub-agent transcript and one tool-result artefact.
  const TRANSCRIPT = TRANSCRIPT_ID
  put(
    `.claude/projects/-alpha/${TRANSCRIPT}.jsonl`,
    [
      JSON.stringify({ type: 'user', timestamp: '2026-08-03T10:00:00Z', message: { role: 'user', content: 'alpha question' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-08-03T10:01:00Z', message: { role: 'assistant', content: 'bravo answer' } }),
    ].join('\n') + '\n',
  )
  put(
    `.claude/projects/-alpha/${TRANSCRIPT}/subagents/agent-1.jsonl`,
    JSON.stringify({ type: 'assistant', timestamp: '2026-08-03T10:02:00Z', message: { role: 'assistant', content: 'charlie sub-answer' } }) + '\n',
  )
  put(`.claude/projects/-alpha/${TRANSCRIPT}/tool-results/t1.txt`, 'tool output\n')

  // A legacy sibling of a live note — same name, different body — and a legacy
  // note under the other backup folder shape.
  put(
    '.claude/projects/-alpha/memory.local-backup-2026-01-01/feedback_alpha_rule.md',
    '---\nname: feedback_alpha_rule\ntype: feedback\n---\nAn older wording of the same rule.\n',
  )
  put('.claude/projects/-alpha/memory.old/user_profile.md', '---\ntype: user\n---\nAn older profile.\n')

  // An editor backup, and a note whose body carries a credential.
  put('ai-memory/notes.md.bak', '# a backup\n')
  put('ai-memory/project_alpha_env.md', '---\ntype: project\n---\nDB_PASSWORD=alphaalphaalpha0001\n')

  // A skill asset that only LOOKS like a credential, and one that is one.
  put('.claude/skills/deploy/scripts/fetch.py', 'password = keychain_lookup("alpha-db")\n')
  put('.claude/skills/deploy/.env', 'OPENAI_API_KEY=sk-alpha_bravo-charlie0123456789\n')

  // Workspace rules, code, and the directory classes around them.
  put('GitHub/alpha/.cursor/rules/alpha.mdc', '---\nglobs: src/**/*.ts\n---\nAlways alpha.\n')
  put('GitHub/alpha/AGENTS.md', '# Alpha workspace\n\nAlways bravo.\n')
  put('GitHub/alpha/node_modules/pkg/index.js', 'module.exports = 1\n')
  put('GitHub/alpha/node_modules/pkg/README.md', '# pkg\n')
  put('GitHub/alpha/.cache/x.txt', 'cached\n')
  put('GitHub/alpha/src/index.ts', 'export const alpha = 1\n')

  // Third-party documentation, a config file, a flat root note.
  put('.grok/docs/user-guide/13-memory.md', '# Memory\n\nHow the memory works.\n')
  put('.grok/relocations/r1.json', '{"from":"a","to":"b"}\n')
  put('Desktop/TODO.md', '# Todo\n\n- alpha\n')

  // R11.5's own case: a body whose blank lines are the whole point.
  put('ai-memory/spaced.md', '---\ntype: reference\n---\n\n\nBody.\n\n\n')

  // A binary: listed from `stat`, never read, never imported.
  putBin('notes/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
}

const wait = async (done: () => boolean, ms = 5000): Promise<void> => {
  const started = Date.now()
  while (!done() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 10))
}

describe('data-port end to end', () => {
  let root: string
  let src: string
  let dataDir: string
  let db: any
  let service: ReturnType<typeof createDataPortService>
  /** Mutable so one test can drive apply's `no-agent` skip. */
  let resolveAgentId: () => string | null
  let loader: ReturnType<typeof createSkillLoader>
  let vault: ReturnType<typeof createVaultService>
  /** Hoisted so a test can build a second service over the same layers. */
  let applyDepsFactory: () => ApplyDeps
  /**
   * Episodic rows as the importer actually wrote them. Read back out of the
   * table rather than out of a stub, because the production `findImported`
   * queries that table: a hand-rolled stand-in would answer for wiring the
   * server does not have.
   */
  const episodicRows = (): Array<{ id: string; content: string; tags: string[]; validFrom: string }> =>
    (
      db.all(sql`SELECT id, content, tags, valid_from FROM episodic_memories ORDER BY created_at ASC, id ASC`) as Array<{
        id: string
        content: string
        tags: string | null
        valid_from: string
      }>
    ).map((r) => ({
      id: r.id,
      content: r.content,
      tags: JSON.parse(r.tags ?? '[]') as string[],
      validFrom: r.valid_from,
    }))
  const agents: CreateAgentInput[] = []
  /** Warnings the importer emitted, so a test can assert what it said out loud. */
  const warnings: Array<{ payload: unknown; message?: string }> = []
  const logger = {
    debug() {},
    info() {},
    warn(payload: unknown, message?: string) {
      warnings.push({ payload, message })
    },
    error() {},
  }

  beforeEach(() => {
    root = join(tmpdir(), `eyas-dp-${process.pid}-${Math.random().toString(36).slice(2)}`)
    src = join(root, 'src')
    dataDir = join(root, 'data')
    mkdirSync(src, { recursive: true })
    writeFixture(src)

    db = createMemoryDb()
    createDataPortTables(db)
    // The real memory tables, because the production apply deps query them:
    // `findImported` looks for an earlier episodic row by its `sha:` tag, and a
    // stand-in that answered from an array would report an idempotency the
    // server does not actually have.
    createMemoryTables(db)
    createSkillsTable(db)
    loader = createSkillLoader(db, logger)
    vault = createVaultService(join(dataDir, 'vault'))
    const episodic = createEpisodicMemoryService(db)
    agents.length = 0
    warnings.length = 0
    resolveAgentId = () => 'primary-1'

    /**
     * The running server as this test stands it up: real vault, real skill
     * loader, real episodic service, an array for the agent registry. The deps
     * themselves are built by the PRODUCTION builder, so a wiring the module
     * adds — an idempotency lookup, a scope resolver, the tool registry — is
     * either present here too or the test fails. Hand-rolling this object is how
     * `findPendingProposal` came to be implemented, untested, and contradicted
     * by a green idempotency test.
     */
    const applyHost: ApplyDepsHost = {
      db,
      logger,
      memory: {
        episodic: { create: (input) => episodic.create(input as never) },
        vault: {
          write: (path, frontmatter, content) => vault.write(path, frontmatter as never, content),
          exists: (path) => vault.exists(path),
          read: (path) => vault.read(path),
        },
      },
      skills: {
        loader: {
          create: (input) => loader.create(input as never),
          getByName: (name) => loader.getByName(name),
        },
      },
      agents: {
        registry: {
          get: (id) => {
            const found = agents.find((a) => a.id === id)
            return found ? { id: found.id, systemPrompt: found.systemPrompt, source: 'user' } : undefined
          },
          create: (input) => {
            agents.push(input as CreateAgentInput)
            return { id: (input as CreateAgentInput).id }
          },
        },
      },
    }

    applyDepsFactory = (): ApplyDeps =>
      buildApplyDeps({
        host: applyHost,
        dataDir,
        createProposal: (input) => service.createProposal(input),
        readWorkspaceFile: () => 'seed',
        resolveDefaultAgentId: () => resolveAgentId(),
      })

    service = createDataPortService({
      db,
      // No model wired: the whole import must be deterministic without one.
      modelCtx: {},
      applyDepsFactory,
      dataDir,
      logger,
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /**
   * Starts a scan and waits for the walk to finish. `scanPath` answers as soon
   * as the header row exists (P-9), so every test that wants rows has to wait
   * for the drive rather than read a list off the return value.
   */
  const scanned = async (
    profile: SourceProfile,
    dir: string,
    svc: ReturnType<typeof createDataPortService> = service,
  ): Promise<string> => {
    const summary = svc.scanPath(profile, dir)
    expect(summary.status).toBe('running')
    await wait(() => svc.getScan(summary.scanId)?.status === 'done')
    expect(svc.getScan(summary.scanId)?.status).toBe('done')
    return summary.scanId
  }

  /**
   * Every row of a scan, paged out of the candidate table. The API never hands
   * back a whole list — a home directory is hundreds of thousands of rows — so
   * a test that wants them all pages for them exactly as the wizard does.
   */
  const allCandidates = (
    scanId: string,
    svc: ReturnType<typeof createDataPortService> = service,
  ): PublicCandidate[] => {
    const out: PublicCandidate[] = []
    for (let off = 0; ; off += 500) {
      const page = svc.listCandidates(scanId, {}, { offset: off, limit: 500, order: 'seq' })
      out.push(...page.items)
      if (out.length >= page.total) return out
    }
  }

  /**
   * Runs the real vault indexer over what the import wrote, so the D-7 recall
   * gate can be asked the question it is actually asked in production: the index
   * is built from `vault_index`, and a note the indexer has not seen is not in
   * it for a reason that has nothing to do with the flag.
   */
  const indexVault = (): void => {
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    createVaultIndexer(db, vault, wikilinks).indexAll()
  }

  const runDefaultSelection = async (): Promise<{ scanId: string; jobId: string }> => {
    const scanId = await scanned('auto', src)
    const selection = allCandidates(scanId)
      .filter((c) => c.selectedByDefault)
      .map((c) => ({ candidateId: c.id }))
    const job = service.createJob({ scanId, sourceProfile: 'auto', selection })
    await wait(() => {
      const j = service.getJob(job.id)
      return j?.status === 'completed' || j?.status === 'failed'
    })
    return { scanId, jobId: job.id }
  }

  it('never hands the caller a body or an absolute path', async () => {
    const scanId = await scanned('auto', src)
    // The summary is a status, counts and stats — never the rows themselves.
    expect(service.getScan(scanId)).not.toHaveProperty('candidates')
    const rows = allCandidates(scanId)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((c) => !('sourcePath' in c))).toBe(true)
    expect(rows.every((c) => !('content' in c))).toBe(true)

    // The stored row keeps the path — the job needs it to read the file again.
    const paths = (
      db.all(sql`SELECT source_path FROM data_port_candidates WHERE scan_id = ${scanId}`) as Array<{
        source_path: string | null
      }>
    ).map((r) => r.source_path)
    expect(paths.filter((p) => typeof p === 'string' && p.startsWith(src)).length).toBeGreaterThan(0)

    // Nothing is kept in two places: the rows live in the table, and the old
    // blob column is empty for every scan this build writes.
    const scanRow = (
      db.all(sql`SELECT candidates_json, format, candidate_count FROM data_port_scans WHERE id = ${scanId}`) as Array<{
        candidates_json: string
        format: number
        candidate_count: number
      }>
    )[0]!
    expect(scanRow.candidates_json).toBe('[]')
    expect(scanRow.format).toBe(2)
    expect(scanRow.candidate_count).toBe(service.countCandidates(scanId, {}))
  })

  /*
   * R11, end to end, on the whole fixture at once.
   *
   * The other cases in this file each prove one clause. This one is the wave's
   * own claim: with no model wired at all, an `auto` scan of a mixed tree maps
   * EVERYTHING, ticks what reads as memory or instructions, leaves the rest
   * visible but unticked, stores every selected body byte-for-byte, tags a
   * credential rather than refusing it, records provenance on every row, and
   * says `unchanged` the second time.
   */
  it('R11 end to end: everything mapped, selected by meaning, secrets tagged, bodies verbatim, provenance everywhere, idempotent', async () => {
    const scanId = await scanned('auto', src)
    const rows = allCandidates(scanId)
    const by = (rel: string): PublicCandidate => {
      const found = rows.find((c) => c.relativePath === rel)
      expect(found, `no row for ${rel}`).toBeTruthy()
      return found!
    }

    // ── mapped: nothing silently absent (R11.1/R11.2) ──────────────────
    // Every directory the walk declined is ONE row carrying its class and its
    // count, and none of its files is a row of its own.
    expect(rows.filter((c) => c.reasonCode.startsWith('directory-skipped:')).map((c) => c.directory!.class).sort())
      .toEqual(['cache', 'node_modules'])
    expect(by('GitHub/alpha/node_modules').directory).toMatchObject({ files: 2 })
    expect(rows.some((c) => c.relativePath.startsWith('GitHub/alpha/node_modules/'))).toBe(false)
    // Every row that is not noise has somewhere to go.
    expect(rows.filter((c) => c.kind !== 'noise' && c.target === 'none')).toEqual([])
    expect(rows.every((c) => c.reasonCode !== 'too-large' && c.reasonCode !== 'secrets')).toBe(true)

    // ── selected by MEANING, not by file type (A-57) ───────────────────
    expect(by('Documents/Vault/meta/claude-sessions/2026-08/2026-08-01_1200_alpha-session.md'))
      .toMatchObject({ kind: 'session', selectedByDefault: true })
    expect(by(`.claude/projects/-alpha/${TRANSCRIPT_ID}.jsonl`))
      .toMatchObject({ kind: 'session', selectedByDefault: true, adapterId: 'claude-code' })
    expect(by(`.claude/projects/-alpha/${TRANSCRIPT_ID}/tool-results/t1.txt`).selectedByDefault).toBe(false)
    expect(by('.claude/projects/-alpha/memory.local-backup-2026-01-01/feedback_alpha_rule.md'))
      .toMatchObject({ kind: 'memory', selectedByDefault: true })
    expect(by('GitHub/alpha/.cursor/rules/alpha.mdc')).toMatchObject({ kind: 'rule', selectedByDefault: true })
    expect(by('GitHub/alpha/AGENTS.md')).toMatchObject({ kind: 'rule', selectedByDefault: true })
    expect(by('Desktop/TODO.md')).toMatchObject({ kind: 'memory', selectedByDefault: true })
    // Importable, but not what the owner asked for — one gesture away, never hidden.
    expect(by('GitHub/alpha/src/index.ts')).toMatchObject({ kind: 'code', selectedByDefault: false })
    expect(by('.grok/relocations/r1.json').selectedByDefault).toBe(false)
    expect(by('notes/logo.png')).toMatchObject({ kind: 'noise', reasonCode: 'binary' })

    // ── a credential is FLAGGED, never refused (R11.4 / D-7) ───────────
    expect(by('.claude/.env')).toMatchObject({ selectedByDefault: false, tags: ['contains-secrets'] })
    expect(by('ai-memory/project_alpha_env.md'))
      .toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['contains-secrets'] })
    const skillRow = rows.find((c) => c.kind === 'skill')!
    expect(skillRow.assets!.find((a) => a.relPath === '.env')!.containsSecrets).toBe(true)
    // A LOOKUP is not a secret: the script asks a keychain for the value.
    expect(skillRow.assets!.find((a) => a.relPath === 'scripts/fetch.py')!.containsSecrets).toBeFalsy()

    // ── import the default selection ───────────────────────────────────
    const selection = rows.filter((c) => c.selectedByDefault).map((c) => ({ candidateId: c.id }))
    const job = service.createJob({ scanId, sourceProfile: 'auto', selection })
    await wait(() => service.getJob(job.id)?.status === 'completed', 30_000)
    const done = service.getJob(job.id)!
    expect(done.status).toBe('completed')
    expect(done.stats.errors).toBe(0)

    // ── verbatim (R11.5): the blank lines are the body ─────────────────
    // Compared against the SOURCE FILE's own bytes rather than a literal typed
    // here: a hand-copied expectation is one miscount away from asserting that
    // the importer reproduces a body nobody actually wrote.
    const spaced = readFileSync(join(dataDir, 'vault', 'semantic', 'spaced.md'), 'utf-8')
    const source = readFileSync(join(src, 'ai-memory', 'spaced.md'), 'utf-8')
    const sourceBody = source.slice(source.indexOf('\n---\n') + 5)
    expect(sourceBody).toBe('\n\nBody.\n\n\n')
    // The writer's own single trailing newline is the one permitted difference.
    expect(spaced.endsWith(sourceBody) || spaced.endsWith(`${sourceBody}\n`)).toBe(true)

    // ── the legacy sibling is kept, never overwritten (R11.3) ──────────
    const legacy = join(dataDir, 'vault', 'procedural', 'feedback_alpha_rule-2.md')
    expect(existsSync(legacy)).toBe(true)
    expect(readFileSync(legacy, 'utf-8')).toMatch(/conflict-with:/)
    // …and the live note still holds its own words.
    expect(vault.read('procedural/feedback_alpha_rule.md')!.content).toContain(LONG_RULE.trim())

    // ── the credential is STORED, tagged, and hidden from recall (D-7) ──
    const secretNote = readFileSync(join(dataDir, 'vault', 'semantic', 'project_alpha_env.md'), 'utf-8')
    expect(secretNote).toContain('DB_PASSWORD=alphaalphaalpha0001')
    expect(secretNote).toMatch(/contains-secrets/)
    indexVault()
    expect(buildMemoryIndex(db, {})!.paths).not.toContain('semantic/project_alpha_env.md')
    expect(buildMemoryIndex(db, { includeSecrets: true })!.paths).toContain('semantic/project_alpha_env.md')
    // The unflagged notes are in the index either way, so this is a filter and
    // not an empty answer.
    expect(buildMemoryIndex(db, {})!.paths).toContain('semantic/alpha_profile.md')

    // ── the skill package: bundled, inlined, on disk, and tagged ───────
    const imported = loader.getByName('deploy')!
    expect(imported.content).toContain('### .env')
    expect(imported.content).toContain('sk-alpha_bravo')
    expect(imported.content).toContain('keychain_lookup')
    expect(imported.capabilities).toContain('contains-secrets')
    expect(imported.capabilities.some((c: string) => c.startsWith('skipped-unsafe-asset'))).toBe(false)
    const assetsRef = listApplied(db, job.id).find((r) => r.kind === 'skill-assets')!.ref
    expect(existsSync(join(assetsRef, '.env'))).toBe(true)
    expect(readFileSync(join(assetsRef, '.env'), 'utf-8')).toBe('OPENAI_API_KEY=sk-alpha_bravo-charlie0123456789\n')

    // ── sessions → episodic, one per session, dated, never embedded ────
    const eps = episodicRows()
    expect(eps.filter((e) => e.tags.includes('session-summary')).length).toBeGreaterThanOrEqual(2)
    expect(eps.filter((e) => e.tags.includes('transcript')).length).toBeGreaterThanOrEqual(2)
    // Dated from the note's own frontmatter. The DATE is asserted, not the hour:
    // `time: '12:00'` is a local wall-clock time, so pinning the UTC hour would
    // make this case pass or fail on the machine's time zone.
    const alphaSession = eps.find((e) => e.content.includes('# Alpha session'))!
    expect(alphaSession.validFrom.startsWith('2026-08-01')).toBe(true)
    // R11.6 — provenance says which reader produced each row, and the notes
    // under the vault were read as a vault.
    expect(eps.every((e) => e.tags.some((t) => t.startsWith('source:')))).toBe(true)
    expect(alphaSession.tags).toContain('source:obsidian')
    // The sub-agent transcript names the transcript it belongs to.
    const sub = eps.find((e) => e.tags.includes('subagent'))!
    expect(sub.tags).toEqual(expect.arrayContaining(['source:claude-code', `parent-session:${TRANSCRIPT_ID}`]))
    // Nothing imported is handed to an embedding provider on the way in (A-30).
    const embedded = db.all(sql`SELECT embedding_hash FROM episodic_memories`) as Array<{ embedding_hash: string | null }>
    expect(embedded.every((r) => r.embedding_hash === null)).toBe(true)

    // ── the ledger: a digest, an adapter and a path for every kind ─────
    const ledger = listApplied(db, job.id)
    expect(ledger.every((r) => r.sha256?.length === 64 && r.adapter && r.paths.length >= 1)).toBe(true)
    expect(ledger.find((r) => r.sourcePath?.endsWith('_g01a070d1.md'))!.adapter).toBe('obsidian')
    expect(new Set(ledger.map((r) => r.kind)))
      .toEqual(new Set(['vault', 'episodic', 'skill', 'skill-assets', 'agent', 'proposal']))

    // ── idempotent (R11.8) ─────────────────────────────────────────────
    // A still-pending proposal reports as `unchanged` on a re-run (Task 12's
    // convention), so unchanged = applied + proposals.
    const settled = done.stats.applied + done.stats.proposals
    const again = service.createJob({ scanId, sourceProfile: 'auto', selection })
    await wait(() => service.getJob(again.id)?.status === 'completed', 30_000)
    expect(service.getJob(again.id)!.stats).toMatchObject({ applied: 0, unchanged: settled, proposals: 0 })
    expect(service.getJob(again.id)!.stats.skippedReasons.unchanged).toBe(settled)
    expect(listApplied(db, again.id)).toEqual([])
    expect(readdirSync(join(dataDir, 'vault', 'semantic')).filter((f) => /-[23]\.md$/.test(f))).toEqual([])
  })

  it('imports every selected kind verbatim into its own layer and records the ledger', async () => {
    const { jobId } = await runDefaultSelection()
    const done = service.getJob(jobId)!
    expect(done.status).toBe('completed')
    expect(done.stats.errors).toBe(0)
    // Task 17 widened the fixture, so these are the numbers the R11 tree
    // produces: 9 memory notes (the three originals plus the credential-bearing
    // note, the blank-line note, the two legacy siblings, the flat Desktop note
    // and the editor backup). The third-party Grok user-guide is listed but
    // unticked (owner, 2026-09-08). 5 sessions (two summaries, the transcript,
    // its sub-agent transcript and the `.grok` summary) and 3 rules (the two
    // CLAUDE.md files and AGENTS.md; the `.mdc` is the proposal).
    expect(done.stats.byKind).toMatchObject({
      memory: 9,
      index: 1,
      skill: 1,
      persona: 1,
      rule: 3,
      session: 5,
    })
    expect(done.stats).toMatchObject({ unchanged: 0, skipped: 0 })
    expect(done.stats.applied + done.stats.proposals).toBe(20)
    // Everything landed cleanly, so there is nothing to account for by reason.
    expect(done.stats.skippedReasons).toEqual({})
    // No model was wired, so nothing may claim to have been enriched.
    expect(done.stats.aiEnriched + done.stats.aiFallback).toBe(0)

    // Memory: the declared kind decides the folder, the index hook the summary.
    const rule = vault.read('procedural/feedback_alpha_rule.md')!
    expect(rule.frontmatter.kind).toBe('feedback')
    expect(rule.frontmatter.summary).toBe('Do not commit automatically')
    expect(rule.content.trim()).toBe(LONG_RULE.trim())
    const profile = vault.read('semantic/alpha_profile.md')!
    expect(profile.frontmatter.kind).toBe('user')
    expect(profile.frontmatter.summary).toBe('Owner profile hook')
    expect(vault.read('semantic/bravo_notes.md')?.frontmatter.kind).toBe('project')
    // The one-line index is imported as one note, named after the profile the
    // scan settled on — which is `claude-code`, not `generic-md`: an `auto`
    // scan that cannot recognise the tree files everything under the word
    // "generic" and the provenance is lost (A-43).
    const index = vault.read('semantic/memory-index-claude-code.md')!
    expect(String(index.frontmatter.summary)).toMatch(/^Imported one-line memory index \(2 entries\)$/)

    // Skill: body verbatim, bundled file inlined AND on disk.
    const skill = loader.getByName('deploy')!
    expect(skill.content).toContain(LONG_SKILL.trim())
    expect(skill.content).toContain('### scripts/deploy.sh')
    expect(skill.triggerPatterns).toContain('deploy docs')
    expect(skill.category?.startsWith(`${OWN_SKILLS_CATEGORY}/`)).toBe(true)

    // Persona: one agent, tools mapped to EYAS ids.
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ id: 'dev', tools: ['read_file'], tier: 'specialist', source: 'user' })

    // Session summary: episodic, body verbatim, dated from the summary header.
    const sessions = episodicRows()
    expect(sessions).toHaveLength(5)
    const grokSummary = sessions.find((r) => r.content.includes('## Session Summary'))!
    expect(grokSummary.validFrom).toBe('2026-09-05T07:25:00.000Z')

    // Workspace rules are proposed, never merged. The `.mdc` scope file joins
    // the two CLAUDE.md files and AGENTS.md at the proposal door.
    const proposals = service.listProposals({ jobId })
    expect(proposals.length).toBeGreaterThanOrEqual(1)
    const agentsProposal = proposals.find((p) => p.workspaceFile === 'AGENTS.md')!
    expect(agentsProposal.agentId).toBe('primary-1')
    expect(agentsProposal.existingBody).toBe('seed')
    expect(proposals.some((p) => p.proposedBody.includes(LONG_WORKSPACE.trim()))).toBe(true)

    const ledger = listApplied(db, jobId)
    // Every kind the importer can write is present; the counts move with the
    // fixture, so the SET is what this case pins.
    expect(new Set(ledger.map((r) => r.kind))).toEqual(
      new Set(['agent', 'episodic', 'proposal', 'skill', 'skill-assets', 'vault']),
    )
    // The assets row names the directory on disk, not the skill id.
    const assetsRow = ledger.find((r) => r.kind === 'skill-assets')!
    expect(existsSync(join(assetsRow.ref, 'scripts', 'deploy.sh'))).toBe(true)
    expect(readFileSync(join(assetsRow.ref, 'scripts', 'deploy.sh'), 'utf-8')).toBe('#!/bin/sh\necho ship\n')
    expect(ledger.every((r) => typeof r.sourcePath === 'string' && r.sourcePath.startsWith(src))).toBe(true)

    // R11.6 — provenance on EVERY row, whatever the kind: the digest of what was
    // written, the adapter that read it, and every path the content was found at.
    // A row missing any of the three is a row a later import cannot recognise and
    // an undo cannot check.
    expect(ledger.every((r) => r.sha256?.length === 64)).toBe(true)
    expect(ledger.every((r) => Boolean(r.adapter))).toBe(true)
    expect(ledger.every((r) => r.paths.length > 0)).toBe(true)
    // The adapter is the one that actually READ the item, not the job's profile:
    // the Grok summary keeps `grok-cli` inside a job the scan detected as
    // `claude-code`.
    const grokRow = ledger.find((r) => r.sourcePath?.includes(`${sep}.grok${sep}`))!
    expect(grokRow.kind).toBe('episodic')
    expect(grokRow.adapter).toBe('grok-cli')
    expect(ledger.find((r) => r.sourcePath?.endsWith('SKILL.md'))!.adapter).toBe('claude-code')
    // The assets row's digest is the PACKAGE digest — the name of the directory
    // is derived from it, so the two cannot drift.
    expect(assetsRow.sha256).toHaveLength(64)
    expect(assetsRow.ref.endsWith(assetsRow.sha256!.slice(0, 8))).toBe(true)
    // A row records the paths its content was found at; a file found once records
    // its own.
    const indexRow = ledger.find((r) => r.sourcePath?.endsWith('MEMORY.md'))!
    expect(indexRow.paths).toEqual(['ai-memory/MEMORY.md'])
  })

  /**
   * P-3 — a credential-shaped file is a visible row the owner may tick, not a
   * refusal. Unticked by default, imported verbatim when asked for, and tagged so
   * recall hides it (D-7). The old importer refused it outright and left nothing
   * behind but a noise row.
   */
  it('offers a credential file unticked, and imports it verbatim and tagged when it is ticked', async () => {
    const scanId = await scanned('auto', src)
    const env = allCandidates(scanId).find((c) => c.relativePath.endsWith('.claude/.env'))!
    expect(env).toMatchObject({ kind: 'knowledge', selectedByDefault: false })
    expect(env.target).not.toBe('none')
    expect(env.tags).toContain('contains-secrets')

    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: env.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0, skipped: 0 })

    const note = vault.read('semantic/env.md')!
    // Verbatim: the value is stored exactly as written. D-7 hides it at recall;
    // it does not redact it here.
    expect(note.content).toContain('TOKEN=not-a-real-secret-value-0000')
    expect(note.frontmatter.tags).toContain('contains-secrets')
    expect(listApplied(db, job.id)[0]!.sha256).toHaveLength(64)
  })

  it('is idempotent for every kind: a second run reports unchanged and writes nothing new', async () => {
    const scanId = await scanned('auto', src)
    const selection = allCandidates(scanId)
      .filter((c) => c.selectedByDefault)
      .map((c) => ({ candidateId: c.id }))

    const first = service.createJob({ scanId, sourceProfile: 'auto', selection })
    await wait(() => service.getJob(first.id)?.status === 'completed')
    const firstStats = service.getJob(first.id)!.stats
    expect(firstStats.applied).toBeGreaterThan(0)
    expect(firstStats.errors).toBe(0)
    const firstProposals = service.listProposals({}).length
    // The vault exactly as the first run left it. The fixture deliberately holds
    // a LEGACY sibling of one note — same file name, different body — so a `-2`
    // is correct here and its absence would be the bug (R11.3). What idempotency
    // forbids is a THIRD copy, which is why the two lists are compared rather
    // than the suffix pattern being banned outright.
    const afterFirst = vault.listFiles().sort()
    expect(afterFirst).toContain('procedural/feedback_alpha_rule-2.md')

    const second = service.createJob({ scanId, sourceProfile: 'auto', selection })
    await wait(() => service.getJob(second.id)?.status === 'completed')
    const stats = service.getJob(second.id)!.stats
    // Everything the first run applied is recognised — the still-pending rule
    // cards included: re-scanning a tree nobody has answered yet is one decision
    // to make, not a second copy of it on the queue.
    const settled = firstStats.applied + firstStats.proposals
    expect(stats).toMatchObject({ applied: 0, unchanged: settled, errors: 0, skipped: 0, proposals: 0 })
    // An unchanged item wrote nothing, and is accounted for by code like a skip.
    expect(stats.skippedReasons).toEqual({ unchanged: settled })
    expect(service.listProposals({})).toHaveLength(firstProposals)

    // Nothing was duplicated in any layer: byte-for-byte the same file list.
    const vaultFiles = vault.listFiles().sort()
    expect(vaultFiles).toEqual(afterFirst)
    expect(vaultFiles.filter((f) => /-[3-9]\.md$/.test(f))).toEqual([])
    expect(vaultFiles).toEqual(expect.arrayContaining([
      'procedural/feedback_alpha_rule.md',
      'semantic/alpha_profile.md',
      'semantic/bravo_notes.md',
      'semantic/memory-index-claude-code.md',
    ]))
    // Written once each: the count is the first run's memory + index kinds.
    expect(vaultFiles).toHaveLength((firstStats.byKind.memory ?? 0) + (firstStats.byKind.index ?? 0))
    expect(loader.list()).toHaveLength(1)
    expect(agents).toHaveLength(1)
    expect(episodicRows()).toHaveLength(firstStats.byKind.session ?? 0)
    // The second run wrote nothing at all, so it has no ledger of its own.
    expect(listApplied(db, second.id)).toEqual([])
  })

  it('skips an unselectable row visibly instead of silently', async () => {
    // R11 leaves almost nothing unimportable — a `.env` is now an unticked
    // `knowledge` row, not noise — so the test makes its own: a binary file is
    // listed from stat and never read, and stays `target: 'none'`.
    writeFileSync(join(src, 'ai-memory', 'thumb.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const scanId = await scanned('auto', src)
    const noise = allCandidates(scanId).find((c) => c.target === 'none')
    expect(noise).toMatchObject({ kind: 'noise', reasonCode: 'binary' })
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: noise!.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    const stats = service.getJob(job.id)!.stats
    expect(stats).toMatchObject({ processed: 1, applied: 0, skipped: 1 })
    expect(stats.skippedReasons).toEqual({ 'not-importable': 1 })
    expect(listApplied(db, job.id)).toEqual([])
  })

  it('still imports an older scan after several newer ones, and refuses one whose rows are gone', async () => {
    const scanId = await scanned('auto', src)
    const one = allCandidates(scanId).find((c) => c.kind === 'memory')!
    // Several newer scans. There is no in-memory cache to fall out of any
    // more: the rows are in the table, and an older scan reads exactly as it
    // did when it was made.
    for (let i = 0; i < 6; i++) await scanned('auto', src)
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: one.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

    // What retention actually does: the header survives, the rows do not.
    service.cancelScan(scanId)
    expect(service.countCandidates(scanId, {})).toBe(0)
    expect(() =>
      service.createJob({
        scanId,
        sourceProfile: 'auto',
        selection: [{ candidateId: one.id }],
      }),
    ).toThrow(/not found or expired/i)

    // …and a scan id that never existed at all.
    expect(() =>
      service.createJob({
        scanId: 'no-such-scan',
        sourceProfile: 'auto',
        selection: [{ candidateId: one.id }],
      }),
    ).toThrow(/not found or expired/i)
  })

  it('counts a selected id this scan does not hold instead of completing green and empty', async () => {
    const scanId = await scanned('auto', src)
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: 'no-such-id' }, { candidateId: 'another-ghost' }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    const stats = service.getJob(job.id)!.stats
    // A stale selection page (a second tab, a re-scan, a retried post) must not
    // be reported as a successful import of nothing.
    expect(stats).toMatchObject({ processed: 2, applied: 0, errors: 2 })
    expect(stats.skippedReasons).toEqual({ error: 2 })
    expect(listApplied(db, job.id)).toEqual([])
  })

  it('counts an apply skip under the code apply reported, not one guessed from its prose', async () => {
    // No agent to own a workspace change: apply returns `no-agent`.
    resolveAgentId = () => null
    const scanId = await scanned('auto', src)
    const rule = allCandidates(scanId).find((c) => c.kind === 'rule')!
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: rule.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    const stats = service.getJob(job.id)!.stats
    expect(stats).toMatchObject({ processed: 1, skipped: 1, proposals: 0, errors: 0 })
    expect(stats.skippedReasons).toEqual({ 'no-agent': 1 })
    expect(service.listProposals({ jobId: job.id })).toEqual([])
  })

  it('re-files a note whose source changed after the scan, tagged and beside the original', async () => {
    const scanId = await scanned('auto', src)
    const note = allCandidates(scanId).find((c) => c.relativePath.endsWith('alpha_profile.md'))!
    const first = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: note.id }],
    })
    await wait(() => service.getJob(first.id)?.status === 'completed')
    expect(vault.read('semantic/alpha_profile.md')!.content).toContain('Senior developer')

    // The file changes between the scan and the second import: the body read at
    // apply time is the new one, and the note says so.
    writeFileSync(
      join(src, 'ai-memory', 'alpha_profile.md'),
      '---\nname: alpha_profile\ntype: user\n---\nEdited after the scan.\n',
    )
    const second = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: note.id }],
    })
    await wait(() => service.getJob(second.id)?.status === 'completed')
    expect(service.getJob(second.id)!.stats).toMatchObject({ applied: 1, unchanged: 0, errors: 0 })

    const sibling = vault.read('semantic/alpha_profile-2.md')!
    expect(sibling.content).toContain('Edited after the scan.')
    // M11 — provenance records the digest of what was READ. The scan-time hash
    // would name a file that no longer exists in that form.
    const edited = readFileSync(join(src, 'ai-memory', 'alpha_profile.md'))
    expect((sibling.frontmatter.source as Record<string, unknown>).sha256).toBe(
      createHash('sha256').update(edited).digest('hex'),
    )
    expect((sibling.frontmatter.source as Record<string, unknown>).sha256).not.toBe(note.sha256)
    expect(sibling.frontmatter.tags).toContain('source-changed')
    expect(sibling.frontmatter.tags).toContain('conflict-with:semantic/alpha_profile.md')
    // The first note is left exactly as it was; the owner decides which survives.
    expect(vault.read('semantic/alpha_profile.md')!.content).toContain('Senior developer')
  })

  it('carries a rule file\'s frontmatter into the proposal above the body', async () => {
    const other = join(root, 'other')
    mkdirSync(join(other, '.claude'), { recursive: true })
    writeFileSync(
      join(other, '.claude', 'CLAUDE.md'),
      '---\n# only for the typed sources\nscope: repo\napplyTo: "**/*.ts"\n---\n# House rules\n\nWrite tests first.\n',
    )
    const scanId = await scanned('auto', other)
    const rule = allCandidates(scanId).find((c) => c.kind === 'rule')!
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: rule.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ proposals: 1, errors: 0 })

    const proposal = service.listProposals({ jobId: job.id })[0]!
    // Nothing the source declared is dropped: the block rides above the body.
    expect(proposal.proposedBody.startsWith('```yaml\n')).toBe(true)
    expect(proposal.proposedBody).toContain('scope: repo')
    // M8 — the source's own text, not a re-serialisation of the parsed object:
    // that would drop the comment and re-quote the glob.
    expect(proposal.proposedBody).toContain('# only for the typed sources')
    expect(proposal.proposedBody).toContain('applyTo: "**/*.ts"')
    expect(proposal.proposedBody).toContain('Write tests first.')
    expect(proposal.title).toContain('.claude/CLAUDE.md')
  })

  it('imports a persona as an agent row and records it in the ledger', async () => {
    const scanId = await scanned('auto', src)
    const persona = allCandidates(scanId).find((c) => c.kind === 'persona')!
    expect(persona.target).toBe('agent')
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: persona.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({
      id: 'dev',
      name: 'dev',
      tier: 'specialist',
      source: 'user',
      enabled: true,
      systemPrompt: 'You write code.',
      tools: ['read_file'],
    })
    // Every declared tool name is kept, whatever the map knows today.
    expect(agents[0]!.tags).toContain('claude-tool:Read')
    expect(listApplied(db, job.id).map((r) => [r.kind, r.ref])).toEqual([['agent', 'dev']])
  })

  /**
   * The model pass is the only step of an import that can leave the machine, so
   * every wall in front of it is worth a job-level test: the owner's explicit
   * tick, a wired provider, a kind the source already declared, a transcript,
   * and a selection too large to be worth the calls. A gate that quietly opened
   * would ship the owner's notes to a provider and still pass a green suite.
   */
  describe('enrichment gate', () => {
    /** One undeclared note, one that declares its kind, and one session summary. */
    const enrichTree = (): string => {
      const dir = join(root, 'enrich')
      const put = (rel: string, body: string): void => {
        const full = join(dir, rel)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, body)
      }
      put('ai-memory/plain_note.md', `Undeclared note. ${'text '.repeat(60)}`)
      put('ai-memory/declared_note.md', '---\nname: declared_note\ntype: feedback\n---\nAsk before deleting.\n')
      put(
        '.grok/memory/p1/sessions/2026-09-05-bravo-run-02b0bcde.md',
        '## Session Summary\n\n- **Date:** 2026-09-05 09:00 UTC\n\n## Topics\n1. the bravo run\n',
      )
      return dir
    }

    const serviceWithModel = (model: unknown): ReturnType<typeof createDataPortService> =>
      createDataPortService({
        db,
        modelCtx: { model: model as never },
        applyDepsFactory,
        dataDir,
        logger,
      })

    /** Scans the tree with `svc`, imports every importable row, returns the stats. */
    const importAll = async (
      svc: ReturnType<typeof createDataPortService>,
      dir: string,
      enrich?: boolean,
    ) => {
      const scanId = await scanned('auto', dir, svc)
      const selection = allCandidates(scanId, svc)
        .filter((c) => c.target !== 'none')
        .map((c) => ({ candidateId: c.id }))
      expect(selection.length).toBeGreaterThan(0)
      const job = svc.createJob({
        scanId,
        sourceProfile: 'auto',
        selection,
        ...(enrich === undefined ? {} : { enrich }),
      })
      await wait(() => {
        const j = svc.getJob(job.id)
        return j?.status === 'completed' || j?.status === 'failed'
      })
      return svc.getJob(job.id)!
    }

    const reply = (json: Record<string, unknown>) => JSON.stringify(json)

    it('calls no model at all when the job did not ask for enrichment', async () => {
      let calls = 0
      const svc = serviceWithModel({
        complete: async () => {
          calls++
          return { content: reply({ kind: 'reference', summary_one_line: 'model summary' }) }
        },
      })
      const done = await importAll(svc, enrichTree())
      expect(done.status).toBe('completed')
      expect(calls).toBe(0)
      expect(done.stats.aiEnriched + done.stats.aiFallback).toBe(0)
    })

    it('asks only about the note that declared no kind — never a declared one, never a transcript', async () => {
      const seen: string[] = []
      const svc = serviceWithModel({
        complete: async (req: { messages?: Array<{ content?: string }> }) => {
          seen.push(String(req?.messages?.map((m) => m.content).join('\n') ?? ''))
          return { content: reply({ kind: 'project', summary_one_line: 'model summary' }) }
        },
      })
      const done = await importAll(svc, enrichTree(), true)
      expect(done.status).toBe('completed')
      expect(done.stats.aiEnriched).toBe(1)
      expect(done.stats.aiFallback).toBe(0)
      expect(seen).toHaveLength(1)
      // The prompt carried the undeclared note, and neither of the other two.
      expect(seen[0]).toContain('plain_note.md')
      expect(seen.join('\n')).not.toContain('Ask before deleting')
      expect(seen.join('\n')).not.toContain('the bravo run')

      // Metadata only: the model named the kind of the undeclared note, and the
      // declared one kept the kind its own frontmatter stated.
      expect(vault.read('semantic/plain_note.md')!.frontmatter.summary).toBe('model summary')
      expect(vault.read('semantic/plain_note.md')!.content).toContain('Undeclared note.')
      expect(vault.read('procedural/declared_note.md')!.frontmatter.kind).toBe('feedback')
    })

    it('still imports the item when the model call throws, and counts it as a fallback', async () => {
      const svc = serviceWithModel({
        complete: async () => {
          throw new Error('provider is down')
        },
      })
      const done = await importAll(svc, enrichTree(), true)
      expect(done.status).toBe('completed')
      expect(done.stats.errors).toBe(0)
      expect(done.stats.aiEnriched).toBe(0)
      expect(done.stats.aiFallback).toBe(1)
      // The deterministic import is the product; enrichment is a garnish.
      expect(vault.read('semantic/plain_note.md')!.content).toContain('Undeclared note.')
    })

    it('leaves a gateway with no provider behind it alone instead of failing every item', async () => {
      let calls = 0
      const svc = serviceWithModel({
        complete: async () => {
          calls++
          return { content: reply({ kind: 'reference' }) }
        },
        listProviders: () => [],
      })
      const done = await importAll(svc, enrichTree(), true)
      expect(calls).toBe(0)
      expect(done.stats.aiEnriched + done.stats.aiFallback).toBe(0)
    })

    it('asks about every undeclared note, however many there are (A-17)', async () => {
      const dir = join(root, 'enrich-many')
      for (let i = 0; i < 49; i++) {
        const full = join(dir, 'ai-memory', `plain_${String(i).padStart(2, '0')}.md`)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, `Undeclared note number ${i}. ${'filler '.repeat(40)}`)
      }
      let calls = 0
      const svc = serviceWithModel({
        complete: async () => {
          calls++
          return { content: reply({ kind: 'reference' }) }
        },
      })
      const done = await importAll(svc, dir, true)
      expect(done.stats.processed).toBe(49)
      // R11.1 — the 48-item cap is gone. Enrichment is opt-in per job and
      // metadata-only, so its cost is TIME, not a number anyone has to guess
      // in advance; a selection of 49 is not quietly demoted to no calls.
      expect(calls).toBe(49)
      expect(done.stats.aiEnriched).toBe(49)
      expect(done.stats.aiFallback).toBe(0)
    })
  })

  /**
   * A container is one file that holds many items. The runner reads and expands
   * it ONCE however many of its units were selected, then hands each unit to
   * the same filing code a standalone file goes through — a path with no
   * job-level coverage until now, though it is how every chat export lands.
   */
  describe('containers', () => {
    const CONVERSATIONS = JSON.stringify([
      {
        uuid: 'chat-one',
        name: 'Alpha plan',
        created_at: '2026-01-02T10:00:00Z',
        chat_messages: [
          { sender: 'human', text: 'how do we ship alpha', created_at: '2026-01-02T10:00:00Z' },
          { sender: 'assistant', text: 'build it, then tag it', created_at: '2026-01-02T10:00:01Z' },
        ],
      },
      {
        uuid: 'chat-two',
        name: 'Bravo plan',
        created_at: '2026-02-03T11:00:00Z',
        chat_messages: [
          { sender: 'human', text: 'and bravo', created_at: '2026-02-03T11:00:00Z' },
          { sender: 'assistant', text: 'same again', created_at: '2026-02-03T11:00:01Z' },
        ],
      },
    ])
    const MEMORIES = JSON.stringify({
      memories: [
        { id: 'mem-one', memory: 'Prefers the terse answer', created_at: '2026-01-02T10:00:00Z' },
        { id: 'mem-two', memory: 'Never deploys on a Friday', created_at: '2026-01-03T10:00:00Z' },
      ],
    })

    const containerTree = (conversations = CONVERSATIONS): string => {
      const dir = join(root, `containers-${Math.random().toString(36).slice(2)}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'conversations.json'), conversations)
      writeFileSync(join(dir, 'memories.json'), MEMORIES)
      return dir
    }

    const runSelection = async (
      scanId: string,
      selection: Array<{ candidateId: string }>,
    ) => {
      const job = service.createJob({ scanId, sourceProfile: 'auto', selection })
      await wait(() => {
        const j = service.getJob(job.id)
        return j?.status === 'completed' || j?.status === 'failed'
      })
      return { job: service.getJob(job.id)!, jobId: job.id }
    }

    it('files every unit of a container from one read, and repeats none of them', async () => {
      const dir = containerTree()
      const scanId = await scanned('auto', dir)
      const units = allCandidates(scanId).filter((c) => c.unit)
      // Two chats and two memories. Under R11 a transcript is durable content
      // like any other and is TICKED by default (A-11): the owner unticks what
      // they do not want rather than hunting for what the scan hid.
      expect(units.map((c) => c.unit).sort()).toEqual(['chat-one', 'chat-two', 'mem-one', 'mem-two'])
      expect(units.filter((c) => c.kind === 'session').every((c) => c.selectedByDefault)).toBe(true)

      const selection = units.map((c) => ({ candidateId: c.id }))
      const { job, jobId } = await runSelection(scanId, selection)
      expect(job.status).toBe('completed')
      expect(job.stats).toMatchObject({ processed: 4, applied: 4, errors: 0, skipped: 0 })

      // Transcripts land in episodic, verbatim, dated from the conversation.
      const chats = episodicRows()
      expect(chats).toHaveLength(2)
      expect(chats.map((e) => e.validFrom).sort()).toEqual([
        '2026-01-02T10:00:00.000Z',
        '2026-02-03T11:00:00.000Z',
      ])
      expect(chats.some((e) => e.content.includes('build it, then tag it'))).toBe(true)
      expect(chats.some((e) => e.content.includes('same again'))).toBe(true)

      // Mem0 rows land in the vault, one note each, body byte-for-byte.
      const notes = vault.listFiles().filter((f) => f.startsWith('semantic/'))
      expect(notes).toHaveLength(2)
      // R11.5 — verbatim, plus the vault writer's single trailing newline,
      // which is one of the two documented exceptions.
      expect(notes.map((f) => vault.read(f)!.content).sort()).toEqual([
        'Never deploys on a Friday\n',
        'Prefers the terse answer\n',
      ])
      expect(listApplied(db, jobId)).toHaveLength(4)

      // A second run of the same selection recognises all four.
      const second = await runSelection(scanId, selection)
      expect(second.job.stats).toMatchObject({ applied: 0, unchanged: 4, errors: 0 })
      expect(episodicRows()).toHaveLength(2)
      expect(vault.listFiles().filter((f) => /-\d+\.md$/.test(f))).toEqual([])
    })

    it('counts a unit that vanished between the scan and the import instead of failing the job', async () => {
      const dir = containerTree()
      const scanId = await scanned('auto', dir)
      const gone = allCandidates(scanId).find((c) => c.unit === 'chat-two')!

      // The container is rewritten without that conversation — the file is still
      // readable, the unit simply is not in it any more.
      writeFileSync(
        join(dir, 'conversations.json'),
        JSON.stringify(JSON.parse(CONVERSATIONS).slice(0, 1)),
      )

      const { job, jobId } = await runSelection(scanId, [{ candidateId: gone.id }])
      expect(job.status).toBe('completed')
      expect(job.stats).toMatchObject({ processed: 1, applied: 0, errors: 0, skipped: 1 })
      expect(job.stats.skippedReasons).toEqual({ 'missing-unit': 1 })
      expect(episodicRows()).toHaveLength(0)
      expect(listApplied(db, jobId)).toEqual([])
    })
  })

  /**
   * An upload is the one source that arrives from outside the machine, so it is
   * read under a stricter rule than a local path: links are never followed. An
   * archive that carried a link to `~/.ssh` would otherwise be read straight
   * out of the host and into the vault.
   */
  describe('uploads', () => {
    it('names a link inside an upload instead of following it out of the tree', async () => {
      const dir = join(root, 'upload-tree')
      mkdirSync(join(dir, 'ai-memory'), { recursive: true })
      writeFileSync(join(dir, 'ai-memory', 'kept.md'), '---\ntype: reference\n---\nA real note.\n')
      // Somewhere the archive has no business reaching.
      const outside = join(root, 'outside')
      mkdirSync(outside, { recursive: true })
      writeFileSync(join(outside, 'secret_notes.md'), 'Host-side content.\n')
      symlinkSync(join(outside, 'secret_notes.md'), join(dir, 'ai-memory', 'link.md'))

      // Exactly what `scanUpload` passes for an extracted archive.
      const strict = await scanDirectory({ rootPath: dir, sourceProfile: 'auto', followSymlinks: false })
      const link = strict.candidates.find((c) => c.relativePath.endsWith('link.md'))!
      expect(link).toMatchObject({ kind: 'noise', reasonCode: 'symlink-upload', target: 'none' })
      expect(link.selectedByDefault).toBe(false)
      // The host file's content never reaches a row, and the real note still does.
      expect(JSON.stringify(strict.candidates)).not.toContain('Host-side content')
      expect(strict.candidates.some((c) => c.relativePath.endsWith('kept.md') && c.kind === 'memory')).toBe(true)

      // A local path is the owner pointing at their own tree, so links are read.
      const followed = await scanDirectory({ rootPath: dir, sourceProfile: 'auto' })
      expect(followed.candidates.some((c) => c.reasonCode === 'symlink-upload')).toBe(false)
    })

    it('scans a single uploaded markdown file and refuses what it cannot read', async () => {
      const scan = await service.scanUpload('generic-md', {
        name: 'alpha notes.md',
        buffer: Buffer.from('---\ntype: reference\n---\nUploaded body.\n'),
      })
      // An upload is walked to the end before the caller is answered (P-9).
      expect(scan.status).toBe('done')
      const rows = allCandidates(scan.scanId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'memory' })
      // The temp directory it was staged in is never handed back to the caller.
      expect(JSON.stringify(rows)).not.toContain(tmpdir())

      await expect(
        service.scanUpload('generic-md', { name: 'photo.png', buffer: Buffer.from('x') }),
      ).rejects.toThrow(/Unsupported upload type/i)
    })
  })

  it('carries what a rule applies to into the header the owner approves', async () => {
    const dir = join(root, 'cursor')
    mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true })
    // `globs: **/*.py` is not valid YAML; the scope has to survive that too.
    writeFileSync(
      join(dir, '.cursor', 'rules', 'alpha.mdc'),
      '---\nglobs: **/*.py\n---\n# Alpha rules\n\nType every public function.\n',
    )
    const scanId = await scanned('auto', dir)
    const rule = allCandidates(scanId).find((c) => c.kind === 'rule')!
    expect(rule.scope).toBe('**/*.py')

    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: rule.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    const proposal = service.listProposals({ jobId: job.id })[0]!
    // A4.2 — the header names the source AND what the rule is scoped to, so a
    // language-specific rule is not approved as if it were global.
    expect(proposal.title).toContain('.cursor/rules/alpha.mdc; applies to: **/*.py')
  })

  /**
   * A-14 — the reader used to DROP a bundled file that looked like a
   * credential, with a bare `continue`: no row, no reason code, nothing a grep
   * could find. The owner pointed at a package and quietly got less of it than
   * they asked for. Under R11.4/P-3 the file is imported verbatim and the
   * package carries the tag; hiding it is the recall layer's job (D-7).
   */
  it('bundles a file that turned into a credential after the scan, tagged rather than dropped', async () => {
    const scanId = await scanned('auto', src)
    const skill = allCandidates(scanId).find((c) => c.kind === 'skill')!
    expect(skill.assets?.map((a) => a.relPath)).toContain('scripts/deploy.sh')
    // Innocent at scan time, so the scan set no flag of its own.
    expect(skill.assets?.find((a) => a.relPath === 'scripts/deploy.sh')?.containsSecrets).toBeFalsy()

    // The package is rewritten between the scan and the import, so only the
    // reader's own recompute over the whole file can see this (A-8).
    writeFileSync(
      join(src, '.claude', 'skills', 'deploy', 'scripts', 'deploy.sh'),
      'OPENAI_API_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    )
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: skill.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

    const imported = loader.getByName('deploy')!
    // Verbatim, inlined and named — and the package says what it holds.
    expect(imported.content).toContain('### scripts/deploy.sh')
    expect(imported.content).toContain('sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(imported.capabilities).toContain('contains-secrets')
    // Nothing was left out, so nothing is counted as left out.
    expect(imported.content).not.toContain('### Not bundled')
    expect(imported.capabilities.some((c: string) => c.startsWith('skipped-unsafe-asset:'))).toBe(false)
    // And the file itself is on disk, byte for byte.
    const assetsRow = listApplied(db, job.id).find((r) => r.kind === 'skill-assets')!
    expect(readFileSync(join(assetsRow.ref, 'scripts', 'deploy.sh'), 'utf-8')).toBe(
      'OPENAI_API_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    )
  })

  it('decodes a BINARY bundled file before judging it, so a key inside it is still tagged', async () => {
    // Binary at scan time — a NUL byte in the head is what flags it — and
    // innocent, so the scan records no secret of its own.
    const iconPath = join(src, '.claude', 'skills', 'deploy', 'scripts', 'icon.bin')
    writeFileSync(iconPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))
    const scanId = await scanned('auto', src)
    const skill = allCandidates(scanId).find((c) => c.kind === 'skill')!
    expect(skill.assets?.find((a) => a.relPath === 'scripts/icon.bin')?.binary).toBe(true)

    // Rewritten between the scan and the import: still binary (the NUL stays),
    // but now carrying a private key. Nothing about the NAME `icon.bin` says
    // "secret", so the filename half of the predicate cannot save this one —
    // only the content half can, and it only sees anything if the bytes are
    // decoded. Handing the predicate `''` for a binary asset, as the reader
    // once did, let a file in exactly this shape through both walls.
    writeFileSync(
      iconPath,
      Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0B\n-----END PRIVATE KEY-----\n'),
      ]),
    )
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: skill.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

    // The package carries the tag, which is what the recall gate acts on. The
    // body a model reads never inlines a binary file — it is named, sized and
    // stored — so the key does not travel into a prompt, and the runnable
    // original is on disk where the skill says it is.
    const imported = loader.getByName('deploy')!
    expect(imported.capabilities).toContain('contains-secrets')
    expect(imported.content).not.toContain('BEGIN PRIVATE KEY')
    expect(imported.content).toContain('### scripts/icon.bin (binary')
    expect(imported.content).toContain('### scripts/deploy.sh')
    const assetsRow = listApplied(db, job.id).find((r) => r.kind === 'skill-assets')
    expect(assetsRow).toBeTruthy()
    expect(readFileSync(join(assetsRow!.ref, 'scripts', 'icon.bin')).includes('BEGIN PRIVATE KEY')).toBe(true)
    expect(existsSync(join(assetsRow!.ref, 'scripts', 'deploy.sh'))).toBe(true)
  })

  it('releases a rollback the server was killed in the middle of, so it can be retried', async () => {
    const { jobId } = await runDefaultSelection()
    // What a killed process leaves behind: the claim is written, the status is
    // still `completed`, and the pass that would have put the phase back died
    // with it. Nothing else in the system ever clears that.
    db.run(sql`UPDATE data_port_jobs SET phase = 'rolling_back' WHERE id = ${jobId}`)

    const rollbackDeps = {
      db,
      dataDir,
      vault: { delete: (path: string) => vault.delete(path) },
      episodic: { delete: () => {} },
      removeAssetDir: () => true,
      readWorkspaceFile: () => null,
      writeWorkspaceFile: async () => {},
    }
    // Before the sweep the undo is unreachable — and stays unreachable, however
    // many times it is tried.
    await expect(service.rollback(jobId, rollbackDeps)).rejects.toThrow(/already being rolled back/i)

    // The job itself is `completed`, so the resume pass has no import to pick
    // up: the only thing it frees is the abandoned rollback claim.
    expect(service.resumeInterruptedJobs()).toEqual({ resumed: 0, released: 1 })
    expect(warnings.some((w) => String(w.message).includes('rollback interrupted by restart'))).toBe(
      true,
    )

    // …and now it runs. Rollback walks the ledger, and the ledger only names
    // what is still there, so retrying a half-finished undo is safe.
    const result = await service.rollback(jobId, rollbackDeps)
    // Every episodic row the run wrote comes back out; the fixture's session
    // count is what that is, so the number is read from the job, not typed in.
    expect(result.removed.episodic).toBe(service.getJob(jobId)!.stats.byKind.session ?? 0)
    expect(result.removed.episodic).toBeGreaterThan(0)
    expect(service.getJob(jobId)!.status).toBe('rolled_back')
    // A second sweep has nothing left to release.
    expect(service.resumeInterruptedJobs()).toEqual({ resumed: 0, released: 0 })
  })

  /**
   * Item 5's other half. A leading block that IS frontmatter but will not parse
   * — a duplicate key, a nested `: ` in an unquoted description, a tab indent —
   * used to demote the note silently: declared kind gone, filed as `reference`,
   * the block dumped into the body. The reader now recovers what it can line by
   * line, and the importer says so once per file rather than leaving the owner
   * to find a mis-filed note months later.
   */
  it('recovers a note whose frontmatter will not parse, and says so once', async () => {
    const dir = join(root, 'broken-fm')
    mkdirSync(join(dir, 'ai-memory'), { recursive: true })
    // `type` twice: YAML refuses the whole map over it.
    writeFileSync(
      join(dir, 'ai-memory', 'feedback_alpha.md'),
      '---\nname: feedback_alpha\ndescription: Ask before deleting\ntype: feedback\ntype: feedback\n---\nNever delete without asking.\n',
    )
    const scanId = await scanned('auto', dir)
    const note = allCandidates(scanId).find((c) => c.kind === 'memory')!
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: note.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

    // The declared kind survived the failed parse, so the note is filed as the
    // feedback it says it is rather than demoted to a reference.
    const filed = vault.read('procedural/feedback_alpha.md')!
    expect(filed.frontmatter.kind).toBe('feedback')
    expect(filed.frontmatter.summary).toBe('Ask before deleting')
    expect(filed.content.trim()).toBe('Never delete without asking.')

    const said = warnings.filter((w) => String(w.message).includes('frontmatter did not parse'))
    expect(said).toHaveLength(1)
    expect(said[0]!.payload).toMatchObject({ path: 'ai-memory/feedback_alpha.md' })
  })

  /**
   * A scan rooted INSIDE an assistant tree hands the classifier a path the row
   * itself no longer has. The runner has to ask the adapter about the same path
   * the scan classified on, or apply time disagrees with scan time: the summary
   * loses the project and dates only its path carries, and a container expands
   * to nothing and is counted as a vanished unit.
   */
  describe('a scan rooted inside an assistant tree', () => {
    it('reads a Grok session on the path that still names its project', async () => {
      const grokRoot = join(root, 'rooted', '.grok', 'memory')
      mkdirSync(join(grokRoot, 'p1', 'sessions'), { recursive: true })
      writeFileSync(
        join(grokRoot, 'p1', 'sessions', '2026-09-05-alpha-run-01a0abcd.md'),
        '## Session Summary\n\n- **Date:** 2026-09-05 07:25 UTC\n\n## Topics\n1. the alpha run\n',
      )
      // Rooted at the memory directory itself: the row's own path is `p1/sessions/…`.
      const scanId = await scanned('auto', grokRoot)
      const summary = allCandidates(scanId).find((c) => c.relativePath.endsWith('01a0abcd.md'))!
      expect(summary.relativePath.startsWith('p1/')).toBe(true)
      expect(summary.classifiedPath).toBe('.grok/memory/p1/sessions/2026-09-05-alpha-run-01a0abcd.md')

      const job = service.createJob({
        scanId,
        sourceProfile: 'auto',
        selection: [{ candidateId: summary.id }],
      })
      await wait(() => service.getJob(job.id)?.status === 'completed')
      expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

      const rows = episodicRows()
      expect(rows).toHaveLength(1)
      // All three come from the adapter reading the marker-preserving path.
      expect(rows[0]!.tags).toContain('grok-project:p1')
      expect(rows[0]!.validFrom).toBe('2026-09-05T07:25:00.000Z')
      expect(rows[0]!.content).toContain('the alpha run')
    })

    it('expands a Cursor transcript rooted at its own directory instead of losing the unit', async () => {
      const transcripts = join(root, 'rooted-cursor', '.cursor', 'agent-transcripts')
      mkdirSync(transcripts, { recursive: true })
      writeFileSync(
        join(transcripts, 'session-one.jsonl'),
        '{"role":"user","content":"how do we ship alpha"}\n{"role":"assistant","content":"build it, then tag it"}\n',
      )
      const scanId = await scanned('cursor', transcripts)
      const unit = allCandidates(scanId).find((c) => c.unit)!
      expect(unit.kind).toBe('session')

      const job = service.createJob({
        scanId,
        sourceProfile: 'cursor',
        selection: [{ candidateId: unit.id }],
      })
      await wait(() => service.getJob(job.id)?.status === 'completed')
      const stats = service.getJob(job.id)!.stats
      // Re-expanding on the row's own path would find no unit of that name and
      // count the transcript as one that vanished between scan and apply.
      expect(stats.skippedReasons['missing-unit'] ?? 0).toBe(0)
      expect(stats).toMatchObject({ applied: 1, errors: 0 })
      expect(episodicRows()[0]!.content).toContain('build it, then tag it')
    })
  })

  /**
   * A-5 — `### Not bundled` is no longer a refusal list. Nothing is refused at
   * scan time under R11: a credential travels verbatim and tagged, and a file
   * of any size travels whole. The section can therefore only name a file the
   * skill BODY does not show in full — an inline copy clipped at
   * `MAX_INLINE_ASSET_CHARS` (P-15), a file the engine cannot hold as one
   * string (P-17), or one that could not be read at import time (A-34) — and
   * the on-disk copy is complete in every one of those cases.
   */
  it('bundles every file of a package, clipping only the INLINE copy of a huge one (P-15)', async () => {
    const dir = join(root, 'big-skill')
    const pkg = join(dir, '.claude', 'skills', 'shipper')
    mkdirSync(join(pkg, 'scripts'), { recursive: true })
    writeFileSync(
      join(pkg, 'SKILL.md'),
      '---\nname: shipper\ndescription: Ship the release\n---\n# Shipper\n\nRun `scripts/ship.sh`, then upload `data/corpus.txt`.\n',
    )
    writeFileSync(join(pkg, 'scripts', 'ship.sh'), '#!/bin/sh\necho ship\n')
    // A credential — bundled verbatim under R11.4, never dropped.
    writeFileSync(join(pkg, 'scripts', '.env'), 'OPENAI_API_KEY=sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb\n')
    // …and a text file well past the inline cap: the copy IN THE BODY is
    // clipped, the copy on disk is whole.
    mkdirSync(join(pkg, 'data'), { recursive: true })
    const corpus = 'x'.repeat(250_000)
    writeFileSync(join(pkg, 'data', 'corpus.txt'), corpus)

    const scanId = await scanned('auto', dir)
    const skill = allCandidates(scanId).find((c) => c.kind === 'skill')!
    // The scan left nothing out, so there is nothing for it to name.
    expect(skill.notBundled ?? []).toEqual([])
    expect(skill.assets?.map((a) => a.relPath).sort()).toEqual([
      'data/corpus.txt',
      'scripts/.env',
      'scripts/ship.sh',
    ])
    expect(skill.assets?.find((a) => a.relPath === 'scripts/.env')?.containsSecrets).toBe(true)
    expect(skill.tags).toContain('contains-secrets')

    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: skill.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

    const imported = loader.getByName('shipper')!
    expect(imported.content).toContain('### scripts/ship.sh')
    expect(imported.content).toContain('### scripts/.env')
    expect(imported.content).toContain('sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(imported.capabilities).toContain('contains-secrets')
    // P-15/P-20 — the inline copy stops with a marker that names the complete
    // file on disk, rather than pretending the body is the whole thing.
    expect(imported.content).toContain('inline copy clipped at 200000 characters')
    expect(imported.content).toContain('data/corpus.txt')
    // Nothing was left out of the import, so nothing is counted as left out.
    expect(imported.content).not.toContain('### Not bundled')
    expect(imported.capabilities.some((c: string) => c.startsWith('skipped-unsafe-asset:'))).toBe(false)

    // Every file is on disk, byte for byte — including the one the body clipped.
    const assetsRow = listApplied(db, job.id).find((r) => r.kind === 'skill-assets')!
    expect(readFileSync(join(assetsRow.ref, 'data', 'corpus.txt'), 'utf-8')).toBe(corpus)
    expect(readFileSync(join(assetsRow.ref, 'scripts', '.env'), 'utf-8')).toBe(
      'OPENAI_API_KEY=sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
    )
  })

  /**
   * A-34 — `readSkillAssets` used to swallow an ENOENT with a log line, so a
   * base-path mismatch lost every asset of every package in silence. A file
   * the reader cannot open is now NAMED in the skill and counted where the
   * operator sees it.
   */
  it('names a bundled file that vanished between the scan and the import', async () => {
    const scanId = await scanned('auto', src)
    const skill = allCandidates(scanId).find((c) => c.kind === 'skill')!
    expect(skill.assets?.map((a) => a.relPath)).toContain('scripts/deploy.sh')

    rmSync(join(src, '.claude', 'skills', 'deploy', 'scripts', 'deploy.sh'))
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: [{ candidateId: skill.id }],
    })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 1, errors: 0 })

    const imported = loader.getByName('deploy')!
    expect(imported.content).toContain('### Not bundled')
    expect(imported.content).toContain('`scripts/deploy.sh`')
    expect(imported.content).toContain('could not be read at import time')
    expect(imported.capabilities).toContain('skipped-unsafe-asset:1')
    expect(warnings.some((w) => String(w.message).includes('named in the skill instead of dropped'))).toBe(true)
  })

  /**
   * A-43 — `auto` is the wizard's default, and the profile the scan settles on
   * decides which adapter reads every file, what the imported index note is
   * called, and what the ledger records as provenance (R11.6). A detection that
   * quietly answers `generic-md` for a recognisable tree loses all three, and
   * the only place that shows is the name of a note nobody looks at twice —
   * which is exactly how it went unnoticed until this wave.
   */
  describe('auto profile detection through the scan path', () => {
    const tree = (name: string, files: Record<string, string>): string => {
      const dir = join(root, `detect-${name}`)
      for (const [rel, body] of Object.entries(files)) {
        const full = join(dir, rel)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, body)
      }
      return dir
    }

    it('names the fixture tree Claude Code, not generic markdown', async () => {
      const scanId = await scanned('auto', src)
      expect(service.getScan(scanId)!.detectedProfile).toBe('claude-code')
    })

    it.each([
      ['claude-code', { '.claude/CLAUDE.md': '# rules\n', '.claude/skills/x/SKILL.md': '---\nname: x\n---\n# x\n' }],
      ['grok-cli', { '.grok/GROK.md': '# g\n', '.grok/memory/p1/notes.md': '# n\n' }],
      ['cursor', { '.cursor/rules/a.mdc': '---\nglobs: "*"\n---\n# a\n' }],
      ['codex', { '.codex/AGENTS.md': '# a\n', '.codex/history.jsonl': '{}\n' }],
      ['gemini-cli', { '.gemini/GEMINI.md': '# g\n' }],
      ['windsurf', { '.windsurf/rules/a.md': '# a\n' }],
      ['copilot', { '.github/copilot-instructions.md': '# c\n' }],
      ['obsidian', { '.obsidian/app.json': '{"a":1}', 'notes/x.md': '# x\n' }],
      ['eyas-export', { 'manifest.json': '{"v":1}', 'vault/semantic/a.md': '# a\n' }],
      // Nothing recognisable: the honest answer, and the only tree that should
      // ever get it.
      ['generic-md', { 'notes/a.md': '# a\n' }],
    ] as Array<[string, Record<string, string>]>)(
      'detects %s from its own marker directory',
      async (expected, files) => {
        const scanId = await scanned('auto', tree(expected, files))
        expect(service.getScan(scanId)!.detectedProfile).toBe(expected)
      },
    )

    it('never overrides an explicit pick with detection', async () => {
      const scanId = await scanned('obsidian', tree('explicit', { '.claude/CLAUDE.md': '# rules\n' }))
      expect(service.getScan(scanId)!.detectedProfile).toBe('obsidian')
    })
  })

  it('finishes a scan whose retention sweep failed, and logs why rather than the statement', async () => {
    // The sweep runs at the end of every scan and asks `data_port_jobs` which
    // scans a job still needs. Without that table it throws a real driver
    // error — which must not take the scan down with it, and must be logged as
    // the reason rather than as the statement drizzle quotes.
    db.run(sql`DROP TABLE data_port_jobs`)
    const scanId = await scanned('auto', src)
    expect(service.getScan(scanId)!.status).toBe('done')
    expect(service.countCandidates(scanId, {})).toBeGreaterThan(0)

    const said = warnings.find((w) => String(w.message).includes('retention sweep failed'))
    expect(said).toBeTruthy()
    const reported = String((said!.payload as { err: string }).err)
    expect(reported).toContain('no such table: data_port_jobs')
    expect(reported).not.toContain('SELECT id FROM data_port_scans')
    // What the site logs is the error's MESSAGE, through the same helper every
    // other failure in the module goes through — not `String(err)`, which would
    // prefix the class name. A missing table is not one of the errors drizzle
    // wraps, so the wrapper-versus-cause half of this rule is pinned by the
    // header-INSERT case in `candidates-routes.test.ts` instead.
    expect(reported.startsWith('SQLiteError:')).toBe(false)
    expect(reported).toBe('no such table: data_port_jobs')
  })

  it('export endpoint returns coming_soon', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      await next()
    })
    createDataPortRoutes(app, { service })
    const res = await app.request('/api/v1/data-port/export', { method: 'POST' })
    expect(res.status).toBe(503)
    expect(((await res.json()) as any).error).toBe('coming_soon')
  })

  /*
   * A-41 — the export stub is door 11 by design. When it ships it will bundle
   * the vault, the skills, the workspaces and `episodic.jsonl` into one file:
   * every flagged note the memory module's eleven doors were closed to protect,
   * in a single download. So it needs the same CALLER test those doors got —
   * the owner-only right, not merely `create` on DataPort.
   *
   * Today it ships nothing, and this case records why that is currently safe
   * and what has to hold before a byte is added: `create`/`read` on DataPort
   * belong to the `user` role, and the `agent` role — the model-with-credentials
   * principal D-7 exists for — holds neither. If a future edit grants an agent
   * either right, or the stub starts returning content, this case fails first.
   */
  it('leaves door 11 shut: the export stub ships nothing and is unreachable by an agent', async () => {
    const { buildAbilityForRole } = await import('@modules/permissions/roles')
    const { createPermissionRegistry } = await import('@modules/permissions/registry')
    const mountAs = (role: 'owner' | 'user' | 'agent'): Hono => {
      const ability = buildAbilityForRole(role, createPermissionRegistry())
      const a = new Hono()
      a.use('*', async (c, next) => {
        ;(c as any).set('ability', ability)
        await next()
      })
      createDataPortRoutes(a, { service })
      return a
    }

    // The agent principal cannot even ask.
    expect((await mountAs('agent').request('/api/v1/data-port/export', { method: 'POST' })).status).toBe(403)
    expect((await mountAs('agent').request('/api/v1/data-port/export')).status).toBe(403)

    // A caller who may ask is told it does not exist yet — no bundle, no paths
    // from the instance, nothing read out of the vault.
    for (const role of ['owner', 'user'] as const) {
      const post = await mountAs(role).request('/api/v1/data-port/export', { method: 'POST' })
      expect(post.status).toBe(503)
      const body = (await post.json()) as any
      expect(body.error).toBe('coming_soon')
      expect(JSON.stringify(body)).not.toContain(dataDir)
      const get = await mountAs(role).request('/api/v1/data-port/export')
      expect(get.status).toBe(200)
      expect(((await get.json()) as any).available).toBe(false)
    }
  })

  /**
   * The enrichment switch is the owner's consent for anything to leave the
   * machine, so the value the client sends has to survive the route unchanged —
   * and an absent field has to read as "no", not as "unset, do as you like".
   */
  describe('import job route — the enrichment switch', () => {
    const routed = () => {
      const app = new Hono()
      app.use('*', async (c, next) => {
        ;(c as any).set('ability', { can: () => true })
        await next()
      })
      createDataPortRoutes(app, { service })
      return app
    }

    const enrichColumn = (jobId: string): number =>
      Number(
        (db.all(sql`SELECT enrich FROM data_port_jobs WHERE id = ${jobId}`) as Array<{ enrich: number }>)[0]!
          .enrich,
      )

    const post = async (body: Record<string, unknown>) => {
      const scanId = await scanned('auto', src)
      const one = allCandidates(scanId).find((c) => c.kind === 'memory')!
      const res = await routed().request('/api/v1/data-port/import/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scanId,
          sourceProfile: 'auto',
          selection: [{ candidateId: one.id }],
          ...body,
        }),
      })
      expect(res.status).toBe(201)
      const job = (await res.json()) as { job: { id: string } }
      await wait(() => {
        const j = service.getJob(job.job.id)
        return j?.status === 'completed' || j?.status === 'failed'
      })
      return job.job.id
    }

    it('carries an explicit yes through to the job', async () => {
      expect(enrichColumn(await post({ enrich: true }))).toBe(1)
    })

    it('reads a client that says nothing as no', async () => {
      expect(enrichColumn(await post({}))).toBe(0)
      expect(enrichColumn(await post({ enrich: false }))).toBe(0)
    })

    it('refuses a value that is not a boolean instead of guessing', async () => {
      const scanId = await scanned('auto', src)
      const res = await routed().request('/api/v1/data-port/import/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scanId,
          sourceProfile: 'auto',
          selection: [{ candidateId: allCandidates(scanId)[0]!.id }],
          enrich: 'yes',
        }),
      })
      expect(res.status).toBe(400)
    })
  })

  /**
   * A15.5 — an undo deletes notes, skills and agents, so it is gated on `delete`
   * rather than on the `create` that started the import. The route is the only
   * place that gate exists; the service itself trusts its caller.
   */
  describe('rollback route', () => {
    const app = (opts: {
      can?: (action: string, subject: string) => boolean
      wired?: boolean
    } = {}) => {
      const a = new Hono()
      a.use('*', async (c, next) => {
        ;(c as any).set('ability', { can: opts.can ?? (() => true) })
        await next()
      })
      createDataPortRoutes(a, {
        service,
        ...(opts.wired === false
          ? {}
          : {
              rollbackDeps: {
                db,
                dataDir,
                vault: { delete: (path: string) => vault.delete(path) },
                episodic: { delete: () => {} },
                removeAssetDir: () => true,
                readWorkspaceFile: () => null,
                writeWorkspaceFile: async () => {},
              },
            }),
      })
      return a
    }
    const post = (a: Hono, jobId: string) =>
      a.request(`/api/v1/data-port/import/jobs/${jobId}/rollback`, { method: 'POST' })

    it('refuses a caller who may import but may not delete', async () => {
      const { jobId } = await runDefaultSelection()
      const res = await post(app({ can: (action) => action !== 'delete' }), jobId)
      expect(res.status).toBe(403)
      // Nothing was undone: the notes are still where the import put them.
      expect(vault.exists('semantic/alpha_profile.md')).toBe(true)
    })

    it('answers 503 rather than half-undoing when the module could not wire an undo', async () => {
      const { jobId } = await runDefaultSelection()
      const res = await post(app({ wired: false }), jobId)
      expect(res.status).toBe(503)
      expect(((await res.json()) as any).error).toBe('Rollback unavailable')
      expect(listApplied(db, jobId).length).toBeGreaterThan(0)
    })

    it('answers 404 for a job that never existed', async () => {
      const res = await post(app(), 'no-such-job')
      expect(res.status).toBe(404)
    })

    it('answers 409 for a job that is still running, and again once it is undone', async () => {
      const { jobId } = await runDefaultSelection()
      db.run(sql`UPDATE data_port_jobs SET status = 'running' WHERE id = ${jobId}`)
      expect((await post(app(), jobId)).status).toBe(409)

      db.run(sql`UPDATE data_port_jobs SET status = 'completed' WHERE id = ${jobId}`)
      const ok = await post(app(), jobId)
      expect(ok.status).toBe(200)
      // The episodic row needs no index to be found, so it is gone; the vault
      // notes are reported as skipped because this harness runs no indexer, and
      // an undo will not delete a note it cannot prove the import wrote.
      const body = (await ok.json()) as any
      expect(body.result.removed.episodic).toBe(service.getJob(jobId)!.stats.byKind.session ?? 0)
      expect(body.result.removed.episodic).toBeGreaterThan(0)
      expect(body.result.skipped.length).toBeGreaterThan(0)
      expect(service.getJob(jobId)!.status).toBe('rolled_back')
      // A second undo of the same job is a conflict, not a second all-zero record.
      expect((await post(app(), jobId)).status).toBe(409)
    })
  })
})
