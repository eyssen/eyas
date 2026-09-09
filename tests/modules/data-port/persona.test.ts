// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { applyPersonaItem } from '@modules/data-port/pipeline/apply'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'
import type { CreateAgentInput } from '@modules/agent/types'

const DEV = [
  '---',
  'name: developer',
  'description: "Senior developer - writes code"',
  'tools:',
  '  - Read',
  '  - Write',
  '  - Bash',
  '  - Magic',
  '---',
  'You write clean code.',
  '',
].join('\n')

/** A registry double: `known` seeds the ids that already exist. */
function agentDeps(
  known: Record<string, { systemPrompt: string; source?: string }> = {},
): {
  deps: ApplyDeps
  created: CreateAgentInput[]
  warnings: unknown[]
} {
  const created: CreateAgentInput[] = []
  const warnings: unknown[] = []
  const deps: ApplyDeps = {
    createProposal: () => 'p',
    resolveDefaultAgentId: () => 'a',
    logger: {
      warn: (o) => {
        warnings.push(o)
      },
    },
    agents: {
      get: (id) => {
        const row = known[id]
        return row ? { id, systemPrompt: row.systemPrompt, source: row.source ?? 'user' } : null
      },
      create: (input) => {
        created.push(input)
        return { id: input.id }
      },
    },
  }
  return { deps, created, warnings }
}

const JOB = { jobId: 'j1', sourceProfile: 'claude-code' as const, relativePath: '.claude/agents/developer.md' }

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
/** The digest apply records for a persona: its system prompt, verbatim. */
const PROMPT_SHA = sha256('You write clean code.')

describe('applyPersonaItem', () => {
  it('creates a user-sourced specialist tagged with the job and every original tool name', async () => {
    const { deps, created } = agentDeps()
    const r = await applyPersonaItem(deps, { ...JOB, raw: DEV })

    expect(r).toEqual({ status: 'applied', kind: 'agent', ref: 'developer', sha256: PROMPT_SHA })
    expect(created[0]).toMatchObject({
      id: 'developer',
      name: 'developer',
      description: 'Senior developer - writes code',
      source: 'user',
      tier: 'specialist',
      agentType: 'developer',
      enabled: true,
      systemPrompt: 'You write clean code.',
      tools: ['read_file', 'write_file', 'run_command'],
    })
    // Provenance is complete: the dropped name AND the mapped ones, so the
    // original declaration survives the import even after the map changes.
    expect(created[0].tags).toEqual(
      expect.arrayContaining([
        'imported',
        'source:claude-code',
        'import-job:j1',
        'claude-tool:Read',
        'claude-tool:Write',
        'claude-tool:Bash',
        'claude-tool:Magic',
      ]),
    )
  })

  it('warns once about the tool names it could not map', async () => {
    const { deps, warnings } = agentDeps()
    await applyPersonaItem(deps, { ...JOB, raw: DEV })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ jobId: 'j1', unknownTools: ['Magic'] })
  })

  it('stays silent when every tool name maps', async () => {
    const { deps, warnings } = agentDeps()
    await applyPersonaItem(deps, {
      ...JOB,
      raw: '---\nname: reviewer\ndescription: reviews code\ntools:\n  - Read\n  - Grep\n---\nReview.',
    })
    expect(warnings).toEqual([])
  })

  it('passes an empty tool list through — the registry default toolset, not a tool-less agent', async () => {
    const { deps, created } = agentDeps()
    await applyPersonaItem(deps, {
      ...JOB,
      raw: '---\nname: helper\ndescription: general helper\n---\nHelp.',
    })
    expect(created[0].tools).toEqual([])
  })

  it('reports the digest of the prompt as STORED, not of the one in hand', async () => {
    // The compare is tolerant (both sides trimmed), so the stored bytes need not
    // be the ones this run holds — and the ledger must record what is there.
    const stored = agentDeps({ developer: { systemPrompt: 'You write clean code.\n\n' } })
    expect(await applyPersonaItem(stored.deps, { ...JOB, raw: DEV })).toMatchObject({
      status: 'unchanged',
      ref: 'developer',
      sha256: sha256('You write clean code.\n\n'),
    })
  })

  it('reports unchanged for the same prompt and suffixes a different one', async () => {
    const same = agentDeps({ developer: { systemPrompt: 'You write clean code.' } })
    expect(await applyPersonaItem(same.deps, { ...JOB, raw: DEV })).toEqual({
      status: 'unchanged',
      ref: 'developer',
      importJobId: null,
      sha256: PROMPT_SHA,
    })
    expect(same.created).toHaveLength(0)

    const other = agentDeps({ developer: { systemPrompt: 'other' } })
    expect(await applyPersonaItem(other.deps, { ...JOB, raw: DEV })).toEqual({
      status: 'applied',
      kind: 'agent',
      ref: 'developer-2',
      sha256: PROMPT_SHA,
    })
    expect(other.created[0].tags).toContain('conflict-with:developer')
  })

  it('walks past taken suffixes instead of colliding on -2', async () => {
    const { deps, created } = agentDeps({
      developer: { systemPrompt: 'other' },
      'developer-2': { systemPrompt: 'also other' },
    })
    const r = await applyPersonaItem(deps, { ...JOB, raw: DEV })
    expect(r).toEqual({ status: 'applied', kind: 'agent', ref: 'developer-3', sha256: PROMPT_SHA })
    expect(created[0].id).toBe('developer-3')
    expect(created[0].tags).toContain('conflict-with:developer')
  })

  it('tags a flagged persona contains-secrets and still stores it in full', async () => {
    const { deps, created } = agentDeps()
    const r = await applyPersonaItem(deps, { ...JOB, raw: DEV, containsSecrets: true })
    expect(r).toMatchObject({ status: 'applied', sha256: PROMPT_SHA })
    expect(created[0].tags).toContain('contains-secrets')
    // R11.4 — flagged, never redacted: the prompt travels verbatim.
    expect(created[0].systemPrompt).toBe('You write clean code.')
  })

  it('flags a credential the scan never saw, past the head of the file', async () => {
    // A-8 — the scan may have judged the file from its first bytes; apply reads
    // every one of them.
    const { deps, created } = agentDeps()
    const raw = [
      '---',
      'name: deployer',
      'description: ships things',
      '---',
      'Deploy carefully.',
      '',
      'Reference: AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      '',
    ].join('\n')
    await applyPersonaItem(deps, { ...JOB, relativePath: '.claude/agents/deployer.md', raw })
    expect(created[0].tags).toContain('contains-secrets')
  })

  it('names the adapter that read the persona beside the job profile', async () => {
    const { deps, created } = agentDeps()
    await applyPersonaItem(deps, { ...JOB, adapterId: 'grok-cli', raw: DEV })
    expect(created[0].tags).toEqual(
      expect.arrayContaining(['source:grok-cli', 'source-profile:claude-code', 'import-job:j1']),
    )
  })

  it('tags a re-import of a changed source file', async () => {
    const { deps, created } = agentDeps()
    await applyPersonaItem(deps, { ...JOB, raw: DEV, sourceChanged: true })
    expect(created[0].tags).toContain('source-changed')
  })

  describe('tool names that are not EYAS tools', () => {
    const OTHER_ASSISTANT = [
      '---',
      'name: repo-helper',
      'description: answers questions about the repo',
      'tools: [codebase, search, fetch]',
      '---',
      'Answer from the repository.',
      '',
    ].join('\n')

    it('never passes another assistanțs tool names through as EYAS tool ids', async () => {
      const { deps, created, warnings } = agentDeps()
      await applyPersonaItem(deps, { ...JOB, raw: OTHER_ASSISTANT })
      // The old rule — "any lowercase word is a tool id" — put these straight on
      // the row, and the runner then ran the agent with an explicit toolset that
      // filtered down to nothing at all.
      expect(created[0].tools).toEqual([])
      expect(warnings[0]).toMatchObject({ unknownTools: ['codebase', 'search', 'fetch'] })
      // Nothing is lost: every declared name is still on the row.
      expect(created[0].tags).toEqual(
        expect.arrayContaining(['claude-tool:codebase', 'claude-tool:search', 'claude-tool:fetch']),
      )
    })

    it('keeps a name the live registry recognises', async () => {
      const { deps, created, warnings } = agentDeps()
      const withRegistry: ApplyDeps = {
        ...deps,
        toolRegistry: { has: (name) => name === 'read_file' || name === 'browser_navigate' },
      }
      await applyPersonaItem(withRegistry, {
        ...JOB,
        raw: '---\nname: browser-bot\ndescription: drives a browser\ntools: [Read, browser_navigate, codebase]\n---\nDrive.',
      })
      expect(created[0].tools).toEqual(['read_file', 'browser_navigate'])
      expect(warnings[0]).toMatchObject({ unknownTools: ['codebase'] })
    })

    it('drops a mapped id the live registry does not have', async () => {
      const { deps, created } = agentDeps()
      const withRegistry: ApplyDeps = { ...deps, toolRegistry: { has: () => false } }
      await applyPersonaItem(withRegistry, { ...JOB, raw: DEV })
      // An empty list means the registry's own default toolset, which is the
      // honest answer when nothing the file asked for is available here.
      expect(created[0].tools).toEqual([])
    })
  })

  it('keeps every frontmatter key EYAS has no column for', async () => {
    const { deps, created } = agentDeps()
    await applyPersonaItem(deps, {
      ...JOB,
      raw: [
        '---',
        'name: designer',
        'description: designs things',
        'model: some-model-id',
        'color: purple',
        'permissionMode: acceptEdits',
        '---',
        'Design.',
        '',
      ].join('\n'),
    })
    const config = JSON.parse(created[0].config!) as {
      import: { sourcePath: string; sourceFrontmatter: Record<string, unknown> }
    }
    expect(config.import.sourcePath).toBe('.claude/agents/developer.md')
    expect(config.import.sourceFrontmatter).toMatchObject({
      name: 'designer',
      model: 'some-model-id',
      color: 'purple',
      permissionMode: 'acceptEdits',
    })
  })

  it('takes the id from an .agent.md stem when the frontmatter names none', async () => {
    const { deps, created } = agentDeps()
    const r = await applyPersonaItem(deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      relativePath: '.claude/agents/planner.agent.md',
      raw: '---\ndescription: product owner - plans the work\n---\nPlan first.',
    })
    expect(r).toEqual({ status: 'applied', kind: 'agent', ref: 'planner', sha256: sha256('Plan first.') })
    expect(created[0]).toMatchObject({ id: 'planner', name: 'planner', agentType: 'planner' })
  })

  it('skips a markdown file without frontmatter — it is not a persona', async () => {
    const { deps } = agentDeps()
    expect(await applyPersonaItem(deps, { ...JOB, raw: 'just text' })).toEqual({
      status: 'skipped',
      reason: 'no frontmatter — not a persona',
      reasonCode: 'not-a-persona',
    })
  })

  // Persona frontmatter must be a YAML MAPPING. A leading `---` block holding a
  // sequence — or any other non-mapping — was never frontmatter (rule I4), so
  // `splitFrontmatter` hands the whole file back as body with
  // `hadFrontmatter: false` and nothing is silently read out of it. The file
  // stays a visible skipped row rather than becoming an agent with a blank
  // prompt or an id taken from a list item.
  it('skips a leading --- block that is a sequence, not a mapping', async () => {
    const { deps, created } = agentDeps()
    expect(
      await applyPersonaItem(deps, { ...JOB, raw: '---\n- one\n- two\n---\nYou review code.' }),
    ).toEqual({
      status: 'skipped',
      reason: 'no frontmatter — not a persona',
      reasonCode: 'not-a-persona',
    })
    expect(created).toHaveLength(0)
  })

  it('skips a leading --- block that is a bare scalar', async () => {
    const { deps, created } = agentDeps()
    expect(await applyPersonaItem(deps, { ...JOB, raw: '---\njust a string\n---\nYou review code.' })).toEqual({
      status: 'skipped',
      reason: 'no frontmatter — not a persona',
      reasonCode: 'not-a-persona',
    })
    expect(created).toHaveLength(0)
  })

  it('skips when the agent registry is unavailable', async () => {
    const r = await applyPersonaItem(
      { createProposal: () => 'p', resolveDefaultAgentId: () => 'a' },
      { ...JOB, raw: DEV },
    )
    expect(r).toEqual({ status: 'skipped', reason: 'agent registry unavailable', reasonCode: 'service-unavailable' })
  })

  it('reports a registry failure as an error instead of throwing', async () => {
    const r = await applyPersonaItem(
      {
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
        agents: {
          get: () => null,
          create: () => {
            throw new Error('registry is read-only')
          },
        },
      },
      { ...JOB, raw: DEV },
    )
    expect(r).toEqual({ status: 'error', error: 'registry is read-only', reasonCode: 'error' })
  })
})

describe('applyPersonaItem — collision chain', () => {
  it('finds its own prompt on a sibling instead of forking a new one every run', async () => {
    // The base id is held by an unrelated agent, so an earlier run parked this
    // persona on `developer-2`. Re-importing must recognise it there.
    const { deps, created } = agentDeps({
      developer: { systemPrompt: 'an unrelated agent' },
      'developer-2': { systemPrompt: 'You write clean code.' },
    })
    expect(await applyPersonaItem(deps, { ...JOB, raw: DEV })).toEqual({
      status: 'unchanged',
      ref: 'developer-2',
      importJobId: null,
      sha256: PROMPT_SHA,
    })
    expect(created).toHaveLength(0)
  })

  it('does not grow the chain on repeated imports', async () => {
    const rows: Record<string, { systemPrompt: string; tags: string[] }> = {
      developer: { systemPrompt: 'an unrelated agent', tags: [] },
    }
    const created: string[] = []
    const deps: ApplyDeps = {
      createProposal: () => 'p',
      resolveDefaultAgentId: () => 'a',
      agents: {
        get: (id) =>
          rows[id] ? { id, systemPrompt: rows[id].systemPrompt, source: 'user', tags: rows[id].tags } : null,
        create: (input) => {
          rows[input.id] = { systemPrompt: input.systemPrompt, tags: input.tags ?? [] }
          created.push(input.id)
          return { id: input.id }
        },
      },
    }
    const first = await applyPersonaItem(deps, { ...JOB, raw: DEV })
    const second = await applyPersonaItem(deps, { ...JOB, raw: DEV })
    const third = await applyPersonaItem(deps, { ...JOB, raw: DEV })
    expect(first).toEqual({ status: 'applied', kind: 'agent', ref: 'developer-2', sha256: PROMPT_SHA })
    // The re-run names the job that created it, read off the agent's own tags.
    const seen = { status: 'unchanged', ref: 'developer-2', importJobId: 'j1', sha256: PROMPT_SHA }
    expect(second).toEqual(seen)
    expect(third).toEqual(seen)
    expect(created).toEqual(['developer-2'])
  })

  it('gives up rather than spinning when the whole capped chain is taken', async () => {
    const deps: ApplyDeps = {
      createProposal: () => 'p',
      resolveDefaultAgentId: () => 'a',
      agents: {
        // Answers every id, and never with a matching prompt.
        get: (id) => ({ id, systemPrompt: 'never matches', source: 'user' }),
        create: () => {
          throw new Error('must not create')
        },
      },
    }
    expect(await applyPersonaItem(deps, { ...JOB, raw: DEV })).toEqual({
      status: 'error',
      error: 'id collision walk exhausted',
      reasonCode: 'error',
    })
  })
})

describe('applyPersonaItem — id safety', () => {
  it('sanitises a human-readable name into a usable agent id and keeps the name', async () => {
    const { deps, created } = agentDeps()
    const r = await applyPersonaItem(deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      relativePath: '.claude/agents/reviewer.md',
      raw: '---\nname: Alpha Reviewer 2.0\ndescription: reviews code\n---\nReview.',
    })
    expect(r).toEqual({
      status: 'applied',
      kind: 'agent',
      ref: 'alpha-reviewer-2-0',
      sha256: sha256('Review.'),
    })
    expect(created[0]).toMatchObject({ id: 'alpha-reviewer-2-0', name: 'Alpha Reviewer 2.0' })
    // Whatever lands in the id has to survive the workspace path rule, and fit
    // in one filesystem path component.
    expect(created[0].id).toMatch(/^[a-z0-9_-]+$/i)
    expect(created[0].id.length).toBeLessThanOrEqual(60)
  })

  it('caps a runaway name at one path component and still leaves a valid id', async () => {
    const { deps, created } = agentDeps()
    // A whole paragraph pasted into `name:` — 360 characters of it.
    const name = 'Alpha Reviewer For Everything '.repeat(12).trim()
    expect(name.length).toBeGreaterThan(300)
    const r = await applyPersonaItem(deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      relativePath: '.claude/agents/long.md',
      raw: `---\nname: ${name}\ndescription: reviews code\n---\nReview.`,
    })
    const ref = (r as { ref: string }).ref
    expect(ref.length).toBeLessThanOrEqual(60)
    expect(ref).toMatch(/^[a-z0-9_-]+$/)
    // Never left dangling on a separator by the cut.
    expect(ref.endsWith('-')).toBe(false)
    // The display name keeps every character.
    expect(created[0].name).toBe(name)
  })

  it('sanitises an id that arrives only through the file stem', async () => {
    const { deps, created } = agentDeps()
    const r = await applyPersonaItem(deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      relativePath: '.claude/agents/My Reviewer.md',
      raw: '---\ndescription: reviews code\n---\nReview.',
    })
    expect(r).toEqual({ status: 'applied', kind: 'agent', ref: 'my-reviewer', sha256: sha256('Review.') })
    expect(created[0].name).toBe('My Reviewer')
  })

  it('falls back to a path-derived id when the name sanitises away to nothing', async () => {
    const { deps, created } = agentDeps()
    const r = await applyPersonaItem(deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      relativePath: '.claude/agents/persona.md',
      raw: '---\nname: "!!! ???"\ndescription: odd\n---\nBody.',
    })
    expect((r as { ref: string }).ref).toMatch(/^persona-[0-9a-f]{8}$/)
    expect(created[0].name).toBe('!!! ???')
  })

  it('keeps an already-valid id exactly as declared', async () => {
    const { deps } = agentDeps()
    const r = await applyPersonaItem(deps, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      relativePath: '.claude/agents/code_reviewer-2.md',
      raw: '---\ndescription: reviews code\n---\nReview.',
    })
    expect(r).toEqual({
      status: 'applied',
      kind: 'agent',
      ref: 'code_reviewer-2',
      sha256: sha256('Review.'),
    })
  })
})
