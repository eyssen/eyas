/**
 * E2E: Memory system — working blocks, episodic facts, vault watcher, stats consistency
 * Validates the 5-tier memory system works end-to-end.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, post, patch, del, expectJson, type TestSession } from './helpers.js'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// Same reasoning as memory.test.ts: when the test and the EYAS server run
// from different cwds (worktree vs main checkout), the vault-watcher misses
// files we create locally. EYAS_TEST_VAULT_DIR lets the operator point at
// the server's actual vault; absent, the vault-watcher test is skipped.
const SERVER_VAULT_DIR = process.env.EYAS_TEST_VAULT_DIR
const VAULT_DIR = SERVER_VAULT_DIR ?? join(process.cwd(), 'data', 'vault', 'semantic')
const hasConfiguredVault = !!SERVER_VAULT_DIR

describe('E2E: Working Memory', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should create and retrieve a working memory block', async () => {
    const key = `e2e-test-${Date.now()}`
    const patchRes = await patch(session, `/api/v1/memory/working/${key}`, {
      content: 'E2E test working memory content',
      maxTokens: 200,
    })
    const block = await expectJson<{ key: string; content: string; maxTokens: number; expiresAt: string }>(patchRes)
    expect(block.key).toBe(key)
    expect(block.content).toBe('E2E test working memory content')
    expect(block.maxTokens).toBe(200)
    expect(block.expiresAt).toBeTruthy() // Should have 24h TTL

    // Verify in list
    const listRes = await get(session, '/api/v1/memory/working')
    const blocks = await expectJson<any[]>(listRes)
    const found = blocks.find((b: any) => b.key === key)
    expect(found).toBeTruthy()
    expect(found.content).toBe('E2E test working memory content')

    // Cleanup
    await del(session, `/api/v1/memory/working/${key}`)
  })

  it('should reflect working memory in stats', async () => {
    const key = `e2e-stats-${Date.now()}`
    await patch(session, `/api/v1/memory/working/${key}`, { content: 'stats test' })

    const statsRes = await get(session, '/api/v1/memory/stats')
    const stats = await expectJson<{ tiers: { working: { count: number; blocks: any[] } } }>(statsRes)
    expect(stats.tiers.working.count).toBeGreaterThanOrEqual(1)
    const inStats = stats.tiers.working.blocks.find((b: any) => b.key === key)
    expect(inStats).toBeTruthy()

    // Cleanup
    await del(session, `/api/v1/memory/working/${key}`)
  })
})

describe('E2E: Episodic Memory', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should create and retrieve an episodic memory fact', async () => {
    const createRes = await post(session, '/api/v1/memory/episodic', {
      content: 'E2E test fact: the user prefers dark mode',
      sourceType: 'e2e-test',
      tags: ['test', 'e2e', 'preference'],
    })
    const fact = await expectJson<{
      id: string
      content: string
      sourceType: string
      salience: number
      tags: string[]
    }>(createRes, 201)

    expect(fact.id).toBeTruthy()
    expect(fact.content).toContain('dark mode')
    expect(fact.sourceType).toBe('e2e-test')
    expect(fact.salience).toBeGreaterThan(0)
    expect(fact.tags).toContain('test')

    // Verify in list
    const listRes = await get(session, '/api/v1/memory/episodic?limit=50')
    const list = await expectJson<any[]>(listRes)
    const found = list.find((f: any) => f.id === fact.id)
    expect(found).toBeTruthy()
  })

  it('should reflect episodic in stats with tag counts', async () => {
    const statsRes = await get(session, '/api/v1/memory/stats')
    const stats = await expectJson<{
      tiers: { episodic: { total: number } }
      topTags: { tag: string; count: number }[]
    }>(statsRes)

    expect(stats.tiers.episodic.total).toBeGreaterThanOrEqual(1)
    // The 'test' tag should appear since we just created a fact with it
    if (stats.topTags.length > 0) {
      expect(stats.topTags[0].tag).toBeTruthy()
      expect(stats.topTags[0].count).toBeGreaterThan(0)
    }
  })
})

describe('E2E: Vault Memory', () => {
  let session: TestSession
  const testFile = join(VAULT_DIR, 'e2e-functional-test.md')

  beforeAll(async () => {
    session = await login()
    if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true })
  })

  it.skipIf(!hasConfiguredVault)('should index vault file and make it searchable via memory API', async () => {
    const content = `---
title: Functional Test Vault Entry
tags: [functional, e2e, vault-test]
links: []
---

# Functional Test
This vault entry tests that the watcher indexes content correctly.
Key fact: EYAS uses a 5-tier memory system.
`
    writeFileSync(testFile, content, 'utf-8')
    await new Promise((r) => setTimeout(r, 3000))

    // Verify vault lists the file
    const vaultRes = await get(session, '/api/v1/memory/vault')
    const files = await expectJson<string[]>(vaultRes)
    expect(files).toContain('semantic/e2e-functional-test.md')

    // Verify content is readable
    const contentRes = await get(session, '/api/v1/memory/vault/semantic/e2e-functional-test.md')
    const body = await expectJson<{ frontmatter: any; content: string }>(contentRes)
    expect(body.frontmatter.title).toBe('Functional Test Vault Entry')
    expect(body.frontmatter.tags).toContain('functional')
    expect(body.content).toContain('5-tier memory system')

    // Verify stats updated
    const statsRes = await get(session, '/api/v1/memory/stats')
    const stats = await expectJson<{ tiers: { vault: { fileCount: number } } }>(statsRes)
    expect(stats.tiers.vault.fileCount).toBeGreaterThanOrEqual(1)

    // Cleanup
    if (existsSync(testFile)) unlinkSync(testFile)
  })
})
