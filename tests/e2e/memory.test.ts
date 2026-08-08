/**
 * E2E: Memory module tests
 * Run: bun vitest run tests/e2e/memory.test.ts
 * Requires: EYAS server running on localhost:3000
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, post, expectJson, type TestSession } from './helpers.js'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// When the test runs from a git worktree but the EYAS server runs from the
// main checkout (common dev setup), `process.cwd()` and the server's cwd
// differ, and the server's vault-watcher never sees files we create here.
// EYAS_TEST_VAULT_DIR lets the operator point at the server's actual vault
// directory; without it we fall back to process.cwd() and SKIP the
// watcher-dependent test to avoid a false failure.
const SERVER_VAULT_DIR = process.env.EYAS_TEST_VAULT_DIR
const VAULT_DIR = SERVER_VAULT_DIR ?? join(process.cwd(), 'data', 'vault', 'semantic')
const hasConfiguredVault = !!SERVER_VAULT_DIR

describe('E2E: Memory Module', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should return memory stats with tier structure', async () => {
    const res = await get(session, '/api/v1/memory/stats')
    const stats = await expectJson<{
      tiers: { working: any; episodic: any; vault: any; archived: any }
      topTags: any[]
    }>(res)
    expect(stats.tiers).toBeTruthy()
    expect(typeof stats.tiers.working.count).toBe('number')
    expect(typeof stats.tiers.episodic.total).toBe('number')
  })

  it('should list vault files', async () => {
    const res = await get(session, '/api/v1/memory/vault')
    const files = await expectJson<string[]>(res)
    expect(Array.isArray(files)).toBe(true)
  })

  // Skipped unless EYAS_TEST_VAULT_DIR is set — see file header. Running
  // the test from a worktree against a server started elsewhere silently
  // writes to a vault the watcher never sees.
  it.skipIf(!hasConfiguredVault)('should detect new vault file after creation', async () => {
    const testFile = join(VAULT_DIR, 'e2e-test-auto.md')
    const content = `---
title: E2E Auto Test
tags: [e2e, automated]
links: []
---

# Automated E2E test file
Created at ${new Date().toISOString()}
`
    if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true })
    writeFileSync(testFile, content, 'utf-8')

    // Wait for vault watcher
    await new Promise((r) => setTimeout(r, 3000))

    const res = await get(session, '/api/v1/memory/vault')
    const files = await expectJson<string[]>(res)
    expect(files).toContain('semantic/e2e-test-auto.md')

    // Read vault file content
    const contentRes = await get(
      session,
      '/api/v1/memory/vault/semantic/e2e-test-auto.md',
    )
    expect(contentRes.status).toBe(200)
    const body = (await contentRes.json()) as { frontmatter: any }
    expect(body.frontmatter.title).toBe('E2E Auto Test')

    // Cleanup
    if (existsSync(testFile)) unlinkSync(testFile)
  })

  it('should trigger consolidation without error', async () => {
    const res = await post(session, '/api/v1/memory/consolidate')
    // Consolidation may return 200 or other success code
    expect([200, 204]).toContain(res.status)
  })
})
