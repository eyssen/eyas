// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createKnowledgeTables } from '@modules/knowledge/schema'
import { createKnowledgeService } from '@modules/knowledge/knowledge-service'
import { createKnowledgeTools } from '@modules/tools/builtin/knowledge-tools'

/**
 * Contract test: the knowledge tools against the REAL knowledge service.
 * Two dead seams are guarded here — `searchPages` did not exist at all, and
 * `create_page` passed `content`, a field `createPageInput` ignores, so every
 * agent-authored page was silently saved with an empty body.
 */

let db: ReturnType<typeof createMemoryDb>
let knowledge: ReturnType<typeof createKnowledgeService>
let harness: ToolContractHarness
let spaceId: string

beforeEach(() => {
  db = createMemoryDb()
  createKnowledgeTables(db)
  knowledge = createKnowledgeService(db)
  harness = createToolContractHarness(createKnowledgeTools(() => knowledge))

  spaceId = knowledge.createSpace({ name: 'Infrastructure', slug: 'infrastructure' }).id
})

describe('knowledge tools ↔ knowledge service contract', () => {
  it('create_page stores the content the agent passed as the page body', async () => {
    const content = 'The OKE node pool must be cordoned before a rolling upgrade.'

    const r = await harness.run('create_page', {
      spaceId,
      title: 'Node Pool Upgrades',
      content,
    })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.created).toBe(true)

    const stored = knowledge.getPage(output.page.id)
    expect(stored).not.toBeNull()
    expect(stored!.body).toBe(content)
    expect(stored!.contentText).toBe(content)
    expect(stored!.slug).toBe('node-pool-upgrades')
  })

  it('search_knowledge finds a page that create_page wrote', async () => {
    await harness.run('create_page', {
      spaceId,
      title: 'Ingress Setup',
      content: 'Cloudflare tunnel terminates at the ingress controller.',
    })

    const byTitle = await harness.run('search_knowledge', { query: 'Ingress' })
    expect(byTitle.success).toBe(true)
    expect((byTitle.output as any).results).toHaveLength(1)
    expect((byTitle.output as any).results[0].title).toBe('Ingress Setup')

    const byBody = await harness.run('search_knowledge', { query: 'Cloudflare' })
    expect((byBody.output as any).results).toHaveLength(1)
    expect((byBody.output as any).results[0].snippet).toContain('Cloudflare')
  })

  it('search_knowledge scopes results to a space when spaceSlug is given', async () => {
    const other = knowledge.createSpace({ name: 'Projects', slug: 'projects' })
    await harness.run('create_page', { spaceId, title: 'Runbook alpha', content: 'alpha runbook' })
    await harness.run('create_page', { spaceId: other.id, title: 'Runbook beta', content: 'beta runbook' })

    const scoped = await harness.run('search_knowledge', { query: 'Runbook', spaceSlug: 'projects' })

    expect((scoped.output as any).results).toHaveLength(1)
    expect((scoped.output as any).results[0].title).toBe('Runbook beta')
  })

  it('search_knowledge excludes soft-deleted pages', async () => {
    const created = await harness.run('create_page', { spaceId, title: 'Deprecated Guide', content: 'old' })
    knowledge.deletePage((created.output as any).page.id)

    const r = await harness.run('search_knowledge', { query: 'Deprecated' })

    expect((r.output as any).results).toHaveLength(0)
  })

  it('get_page returns a not-found error instead of a null page', async () => {
    const r = await harness.run('get_page', { pageId: 'does-not-exist' })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/not found/i)
  })

  it('fails soft (structured error, not throw) when the module is not started yet', async () => {
    const h = createToolContractHarness(createKnowledgeTools(() => undefined))

    for (const [name, input] of [
      ['search_knowledge', { query: 'x' }],
      ['get_page', { pageId: 'x' }],
      ['create_page', { spaceId: 'x', title: 'x', content: 'x' }],
    ] as const) {
      const r = await h.run(name, input as Record<string, unknown>)
      expect(r.success).toBe(true)
      expect((r.output as any).error).toMatch(/not ready/i)
    }
  })
})
