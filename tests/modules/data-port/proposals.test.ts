// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { applyWorkspaceProposal, contentSha } from '@modules/data-port/pipeline/apply'
import { legacyBody } from '@modules/data-port/source-frontmatter'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

let db: any
let dataDir: string
let files: Record<string, string>
let service: ReturnType<typeof createDataPortService>

/**
 * The workspace stands in as a plain map. Agent files are keyed `<agentId>/<file>`;
 * the project-type prompt has no agent, so it is looked up by bare file id too.
 */
function readFile(agentId: string, file: string): string | null {
  return files[`${agentId}/${file}`] ?? files[file] ?? null
}

function makeService(): ReturnType<typeof createDataPortService> {
  const created = createDataPortService({
    db,
    modelCtx: { logger } as any,
    applyDepsFactory: () => applyDeps(created),
    dataDir,
    logger,
  })
  return created
}

/** The apply-side deps: proposals go into the service's own table. */
function applyDeps(svc: ReturnType<typeof createDataPortService>): ApplyDeps {
  return {
    createProposal: (input) => svc.createProposal(input),
    resolveDefaultAgentId: () => 'a1',
    readWorkspaceFile: readFile,
  }
}

const writer = {
  write: async (req: { agentId: string; file: string; body: string }) => {
    files[`${req.agentId}/${req.file}`] = req.body
  },
}
const reader = { read: readFile }

beforeEach(() => {
  db = createMemoryDb()
  createDataPortTables(db)
  dataDir = mkdtempSync(join(tmpdir(), 'eyas-proposals-'))
  files = { 'a1/AGENTS.md': 'seed rules', 'project-type:general': 'type prompt' }
  service = makeService()
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('applyWorkspaceProposal', () => {
  it('keeps both appends because approval re-reads the file instead of the snapshot', async () => {
    // Both proposals are created BEFORE either is approved, so both rows carry
    // the same stale `existing_body` — the case a snapshot-based append erases.
    const first = await applyWorkspaceProposal(applyDeps(service), {
      jobId: 'job-1',
      target: 'workspace.agents',
      title: 'Alpha rules',
      body: 'A',
      sourcePath: '.alpha/AGENTS.md',
      frontmatterYaml: null,
    })
    const second = await applyWorkspaceProposal(applyDeps(service), {
      jobId: 'job-1',
      target: 'workspace.agents',
      title: 'Bravo rules',
      body: 'B',
      sourcePath: '.bravo/RULES.md',
      frontmatterYaml: 'scope: repo',
    })

    expect(first).toMatchObject({ status: 'proposal', workspaceFile: 'AGENTS.md' })
    expect(second).toMatchObject({ status: 'proposal', workspaceFile: 'AGENTS.md' })
    const id1 = (first as { proposalId: string }).proposalId
    const id2 = (second as { proposalId: string }).proposalId

    await service.approveProposal(id1, writer, reader)
    await service.approveProposal(id2, writer, reader)

    const out = files['a1/AGENTS.md']!
    expect(out.startsWith('seed rules')).toBe(true)
    // A13.2: each section is bracketed by its own proposal-id markers.
    expect(out).toContain(
      `<!-- eyas-import:${id1} -->\n## Imported: Alpha rules (.alpha/AGENTS.md)\n\nA\n<!-- /eyas-import:${id1} -->`,
    )
    expect(out).toContain(
      `<!-- eyas-import:${id2} -->\n## Imported: Bravo rules (.bravo/RULES.md)\n\n` +
        '```yaml\nscope: repo\n```\n\nB\n' +
        `<!-- /eyas-import:${id2} -->`,
    )
  })

  it('titles a changed source with the source-changed marker', async () => {
    const result = await applyWorkspaceProposal(applyDeps(service), {
      jobId: 'job-1',
      target: 'workspace.agents',
      title: 'Alpha rules',
      body: 'A',
      sourcePath: '.alpha/AGENTS.md',
      frontmatterYaml: null,
      sourceChanged: true,
    })

    const id = (result as { proposalId: string }).proposalId
    expect(service.getProposal(id)!.title).toBe('Alpha rules (.alpha/AGENTS.md) [source-changed]')
  })

  it('routes prompt.project-type proposals to the general type prompt', async () => {
    const result = await applyWorkspaceProposal(applyDeps(service), {
      jobId: 'job-1',
      target: 'prompt.project-type',
      title: 'Alpha rules',
      body: 'R',
      sourcePath: 'RULES.md',
      frontmatterYaml: null,
    })

    expect(result).toMatchObject({ status: 'proposal', workspaceFile: 'project-type:general' })
    const row = db.all(
      sql`SELECT agent_id, existing_body, title FROM data_port_proposals`,
    )[0] as { agent_id: string; existing_body: string; title: string }
    // No agent owns the project-type prompt.
    expect(row.agent_id).toBe('-')
    expect(row.existing_body).toBe('type prompt')
    expect(row.title).toBe('Alpha rules (RULES.md)')
  })

  it('appends the approved section to the project-type prompt with markers', async () => {
    const result = await applyWorkspaceProposal(applyDeps(service), {
      jobId: 'job-1',
      target: 'prompt.project-type',
      title: 'Alpha rules',
      body: 'R',
      sourcePath: 'RULES.md',
      frontmatterYaml: null,
    })
    const id = (result as { proposalId: string }).proposalId

    await service.approveProposal(id, writer, reader)

    const out = files['-/project-type:general']!
    expect(out.startsWith('type prompt')).toBe(true)
    expect(out).toContain(
      `<!-- eyas-import:${id} -->\n## Imported: Alpha rules (RULES.md)\n\nR\n<!-- /eyas-import:${id} -->`,
    )
  })

  it('skips a target that is not a workspace file', async () => {
    const result = await applyWorkspaceProposal(applyDeps(service), {
      jobId: 'job-1',
      target: 'episodic',
      title: 'Alpha rules',
      body: 'A',
      sourcePath: 'notes.md',
      frontmatterYaml: null,
    })

    expect(result).toMatchObject({ status: 'skipped' })
  })

  it('skips when no agent is available for an agent-owned workspace file', async () => {
    const deps: ApplyDeps = {
      createProposal: (input) => service.createProposal(input),
      resolveDefaultAgentId: () => null,
      readWorkspaceFile: readFile,
    }

    const result = await applyWorkspaceProposal(deps, {
      jobId: 'job-1',
      target: 'workspace.agents',
      title: 'Alpha rules',
      body: 'A',
      sourcePath: '.alpha/AGENTS.md',
      frontmatterYaml: null,
    })

    expect(result).toMatchObject({ status: 'skipped' })
    // The project-type prompt needs no agent, so it still becomes a proposal.
    const prompt = await applyWorkspaceProposal(deps, {
      jobId: 'job-1',
      target: 'prompt.project-type',
      title: 'Alpha rules',
      body: 'R',
      sourcePath: 'RULES.md',
      frontmatterYaml: null,
    })
    expect(prompt).toMatchObject({ status: 'proposal', workspaceFile: 'project-type:general' })
  })
})

/**
 * I8 / A4.2 — a Cursor `globs` or a Copilot `applyTo` says what the rule is
 * FOR. Without it in the header, a rule scoped to Python files reads as a
 * global instruction to whoever approves the card.
 */
describe('applyWorkspaceProposal — the scope a rule declares', () => {
  const apply = async (over: Record<string, unknown> = {}) => {
    const r = await applyWorkspaceProposal(applyDeps(service), {
      jobId: 'j1',
      target: 'workspace.agents',
      title: 'Alpha rules',
      body: 'Type every public function.',
      sourcePath: '.cursor/rules/alpha.mdc',
      frontmatterYaml: null,
      ...over,
    } as never)
    expect(r.status).toBe('proposal')
    return service.getProposal((r as { proposalId: string }).proposalId)!
  }

  it('names the scope in the header, after the source path', () => {
    return apply({ scope: '**/*.py' }).then((p) => {
      expect(p.title).toBe('Alpha rules (.cursor/rules/alpha.mdc; applies to: **/*.py)')
    })
  })

  it('says nothing about scope when the rule declared none', () => {
    return apply().then((p) => {
      expect(p.title).toBe('Alpha rules (.cursor/rules/alpha.mdc)')
    })
  })

  it('ignores a scope that is only whitespace', () => {
    return apply({ scope: '   ' }).then((p) => {
      expect(p.title).toBe('Alpha rules (.cursor/rules/alpha.mdc)')
    })
  })

  it('keeps the changed-source marker last, after the scope', () => {
    return apply({ scope: '**/*.py', sourceChanged: true }).then((p) => {
      expect(p.title).toBe(
        'Alpha rules (.cursor/rules/alpha.mdc; applies to: **/*.py) [source-changed]',
      )
    })
  })
})

/**
 * A1 — the same rule file scanned twice before anyone answered the first card is
 * one decision to make, not two identical ones stacked on the owner's queue.
 */
describe('applyWorkspaceProposal — a card already waiting', () => {
  const deps = () => {
    const base = applyDeps(service)
    return {
      ...base,
      // The tolerant comparison the production deps make (P-13): a card written
      // before R11.5 carries a trimmed body and is still the same decision.
      findPendingProposal: ({ agentId, workspaceFile, proposedBody }: {
        agentId: string
        workspaceFile: string
        proposedBody: string
      }) => {
        const rows = db.all(
          sql`SELECT id, job_id, proposed_body FROM data_port_proposals
              WHERE status = 'pending' AND agent_id = ${agentId} AND workspace_file = ${workspaceFile}`,
        ) as Array<{ id: string; job_id: string | null; proposed_body: string }>
        const wanted = legacyBody(proposedBody, true)
        const hit = rows.find((r) => legacyBody(r.proposed_body ?? '', true) === wanted)
        return hit ? { id: hit.id, jobId: hit.job_id ?? null, proposedBody: hit.proposed_body ?? '' } : null
      },
    }
  }

  const apply = (body: string, over: Record<string, unknown> = {}) =>
    applyWorkspaceProposal(deps(), {
      jobId: 'j1',
      target: 'workspace.agents',
      title: 'Alpha rules',
      body,
      sourcePath: '.claude/CLAUDE.md',
      frontmatterYaml: null,
      ...over,
    } as never)

  it('reports the waiting card as unchanged instead of creating a second one', async () => {
    const first = await apply('Write tests first.')
    expect(first.status).toBe('proposal')
    const id = (first as { proposalId: string }).proposalId

    const second = await apply('Write tests first.')
    expect(second).toEqual({
      status: 'unchanged',
      ref: id,
      reasonCode: 'unchanged',
      importJobId: 'j1',
      sha256: contentSha('Write tests first.'),
    })
    expect(service.listProposals({})).toHaveLength(1)
  })

  it('recognises a card an earlier import wrote trimmed, instead of stacking a second one', async () => {
    // P-13 — before R11.5 the proposed body arrived trimmed. The same rule file
    // must not produce a second identical decision now that it does not.
    const id = (await apply('Write tests first.\n')) as { proposalId: string }
    db.run(sql`UPDATE data_port_proposals SET proposed_body = 'Write tests first.' WHERE id = ${id.proposalId}`)

    const again = await apply('\nWrite tests first.\n\n')
    // The digest is the one the hit was matched on — the card as STORED, not the
    // body this run would have proposed.
    expect(again).toMatchObject({
      status: 'unchanged',
      ref: id.proposalId,
      sha256: contentSha('Write tests first.'),
    })
    expect(service.listProposals({})).toHaveLength(1)
  })

  it('returns the digest of the body it proposed', async () => {
    const r = await apply('Write tests first.')
    expect(r).toMatchObject({ status: 'proposal', sha256: contentSha('Write tests first.') })
  })

  it('says in the title that a flagged rule carries a credential, and keeps the body', async () => {
    const r = (await apply('Deploy with care.', { containsSecrets: true })) as { proposalId: string }
    const card = service.getProposal(r.proposalId)!
    expect(card.title.endsWith(' [contains-secrets]')).toBe(true)
    expect(card.proposedBody).toBe('Deploy with care.')
  })

  it('keeps the frontmatter block byte for byte instead of trimming it', async () => {
    const r = (await apply('Body.', { frontmatterYaml: '\nscope: repo\n' })) as { proposalId: string }
    expect(service.getProposal(r.proposalId)!.proposedBody).toBe('```yaml\n\nscope: repo\n\n```\n\nBody.')
  })

  it('creates a new card when the rule file has actually changed', async () => {
    await apply('Write tests first.')
    const changed = await apply('Write tests first, then ship.')
    expect(changed.status).toBe('proposal')
    expect(service.listProposals({})).toHaveLength(2)
  })

  it('creates a new card once the first has been answered', async () => {
    const first = await apply('Write tests first.')
    const id = (first as { proposalId: string }).proposalId
    service.rejectProposal(id)

    const again = await apply('Write tests first.')
    expect(again.status).toBe('proposal')
    // The rejected one is not resurrected, and the new decision is a real card.
    expect(service.listProposals({ status: 'pending' })).toHaveLength(1)
  })

  it('compares the body the owner would see, frontmatter fence included', async () => {
    const first = await apply('Body.', { frontmatterYaml: 'scope: repo' })
    expect(first.status).toBe('proposal')
    // Same body, different declared frontmatter: a different card to approve.
    const other = await apply('Body.', { frontmatterYaml: 'scope: global' })
    expect(other.status).toBe('proposal')
    // …and the identical one is recognised.
    const same = await apply('Body.', { frontmatterYaml: 'scope: repo' })
    expect(same.status).toBe('unchanged')
  })
})
