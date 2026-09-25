/**
 * E2E: Knowledge wiki tests
 * Run: bun vitest run tests/e2e/knowledge.test.ts
 * Requires: EYAS server running on localhost:3000
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, post, patch, del, expectJson, type TestSession } from './helpers.js'

describe('E2E: Knowledge Wiki', () => {
  let session: TestSession
  let spaceId: string

  beforeAll(async () => {
    session = await login()
    // Get default space
    const spacesRes = await get(session, '/api/v1/knowledge/spaces')
    const spaces = await expectJson<any[]>(spacesRes)
    spaceId = spaces[0].id
  })

  it('should list knowledge spaces', async () => {
    const res = await get(session, '/api/v1/knowledge/spaces')
    const spaces = await expectJson<any[]>(res)
    expect(spaces.length).toBeGreaterThanOrEqual(1)
    expect(spaces[0].name).toBeTruthy()
  })

  it('should list knowledge pages in space', async () => {
    const res = await get(session, `/api/v1/knowledge/pages?spaceId=${spaceId}`)
    const pages = await expectJson<any[]>(res)
    expect(Array.isArray(pages)).toBe(true)
  })

  it('should create, update, and delete a page', async () => {
    // Create
    const createRes = await post(session, '/api/v1/knowledge/pages', {
      title: 'E2E Test Page',
      body: '<p>Test content created by E2E test suite</p>',
      spaceId,
    })
    const page = await expectJson<{ id: string; title: string }>(createRes, 201)
    expect(page.title).toBe('E2E Test Page')

    // Update
    const updateRes = await patch(session, `/api/v1/knowledge/pages/${page.id}`, {
      title: 'E2E Test Page Updated',
      body: '<p>Updated content</p>',
    })
    expect(updateRes.status).toBe(200)

    // Verify
    const getRes = await get(session, `/api/v1/knowledge/pages/${page.id}`)
    const updated = await expectJson<{ title: string }>(getRes)
    expect(updated.title).toBe('E2E Test Page Updated')

    // Delete
    const delRes = await del(session, `/api/v1/knowledge/pages/${page.id}`)
    expect([200, 204]).toContain(delRes.status)
  })
})
