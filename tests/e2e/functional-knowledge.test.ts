/**
 * E2E: Knowledge wiki — CRUD, versioning, categories
 * Validates that page edits create versions and content persists correctly.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, post, patch, del, expectJson, type TestSession } from './helpers.js'

describe('E2E: Knowledge Versioning', () => {
  let session: TestSession
  let spaceId: string

  beforeAll(async () => {
    session = await login()
    const spacesRes = await get(session, '/api/v1/knowledge/spaces')
    const spaces = await expectJson<any[]>(spacesRes)
    spaceId = spaces[0].id
  })

  it('should create page with version 1', async () => {
    const createRes = await post(session, '/api/v1/knowledge/pages', {
      title: 'Version Test Page',
      body: '<p>Initial content v1</p>',
      spaceId,
    })
    const page = await expectJson<{ id: string; version: number; title: string }>(createRes, 201)
    expect(page.version).toBe(1)
    expect(page.title).toBe('Version Test Page')

    // Cleanup
    await del(session, `/api/v1/knowledge/pages/${page.id}`)
  })

  it('should increment version on update', async () => {
    // Create
    const createRes = await post(session, '/api/v1/knowledge/pages', {
      title: 'Multi-Version Page',
      body: '<p>Version 1</p>',
      spaceId,
    })
    const page = await expectJson<{ id: string; version: number }>(createRes, 201)
    expect(page.version).toBe(1)

    // Update 1
    await patch(session, `/api/v1/knowledge/pages/${page.id}`, {
      body: '<p>Version 2 content</p>',
    })
    const v2 = await get(session, `/api/v1/knowledge/pages/${page.id}`)
    const pageV2 = await expectJson<{ version: number }>(v2)
    expect(pageV2.version).toBe(2)

    // Update 2
    await patch(session, `/api/v1/knowledge/pages/${page.id}`, {
      body: '<p>Version 3 content</p>',
    })
    const v3 = await get(session, `/api/v1/knowledge/pages/${page.id}`)
    const pageV3 = await expectJson<{ version: number; body: string }>(v3)
    expect(pageV3.version).toBe(3)
    expect(pageV3.body).toContain('Version 3')

    // Check version history
    const versionsRes = await get(session, `/api/v1/knowledge/pages/${page.id}/versions`)
    const versions = await expectJson<any[]>(versionsRes)
    expect(versions.length).toBeGreaterThanOrEqual(3)
    // Newest first
    expect(versions[0].version).toBeGreaterThanOrEqual(versions[versions.length - 1].version)

    // Cleanup
    await del(session, `/api/v1/knowledge/pages/${page.id}`)
  })

  it('should preserve HTML content faithfully', async () => {
    const html = '<h1>Title</h1><p>Paragraph with <strong>bold</strong> and <em>italic</em></p><ul><li>Item 1</li><li>Item 2</li></ul>'
    const createRes = await post(session, '/api/v1/knowledge/pages', {
      title: 'HTML Content Test',
      body: html,
      spaceId,
    })
    const page = await expectJson<{ id: string; body: string }>(createRes, 201)
    expect(page.body).toContain('<strong>bold</strong>')
    expect(page.body).toContain('<em>italic</em>')

    // Retrieve and verify
    const getRes = await get(session, `/api/v1/knowledge/pages/${page.id}`)
    const fetched = await expectJson<{ body: string; contentText: string }>(getRes)
    expect(fetched.body).toContain('<strong>bold</strong>')
    // contentText is server-side text extraction from HTML body
    if (fetched.contentText && fetched.contentText.length > 0) {
      expect(fetched.contentText).toContain('bold')
      expect(fetched.contentText).not.toContain('<strong>')
    }

    // Cleanup
    await del(session, `/api/v1/knowledge/pages/${page.id}`)
  })
})
