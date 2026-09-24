// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createEmailTools, ensureEmailDraftTables } from '@modules/tools/builtin/email-tools'
import { renderHtmlEmail } from '@shared/html-document'

let db: any
let sent: any[]

function tools(over: Record<string, any> = {}) {
  sent = []
  return createEmailTools({
    getDb: () => db,
    getCommunication: () => ({ router: { send: async (_id: string, content: any) => { sent.push(content) } } }),
    ...over,
  })
}

const byName = (list: any[], name: string) => list.find((t) => t.name === name)!

async function approvedDraft(list: any[]) {
  const created = await byName(list, 'email_create_draft').execute(
    { to: 'x@y.test', subject: 'Invoice ready', body: '# Invoice\n\nThe **batch** is ready.', channelId: 'mail-1' }, {} as any,
  ) as any
  await byName(list, 'email_approve_draft').execute({ draftId: created.draftId }, {} as any)
  return created.draftId as string
}

beforeEach(() => {
  db = createMemoryDb()
  ensureEmailDraftTables(db)
})

describe('email drafts', () => {
  it('adds a body_html column without breaking the existing table', () => {
    ensureEmailDraftTables(db) // idempotent
    const cols = (db.all(sql`PRAGMA table_info(email_drafts)`) as any[]).map((c) => c.name)
    expect(cols).toContain('body_html')
    expect(cols).toContain('body')
  })

  it('sends plain text when no renderer is wired — unchanged behaviour', async () => {
    const list = tools()
    const draftId = await approvedDraft(list)
    const res = await byName(list, 'email_send_draft').execute({ draftId }, {} as any) as any
    expect(res.ok).toBe(true)
    expect(res.branded).toBe(false)
    expect(sent[0].text).toContain('The **batch** is ready.')
    expect(sent[0].html).toBeUndefined()
  })

  it('composes the HTML body AT SEND TIME, not at draft time', async () => {
    // The draft is the one place an artifact exists server-side before it
    // leaves, so what goes out has to be built when it goes out — not frozen
    // into the row when the draft was written.
    let footer = 'draft-time footer'
    const renderBranded = vi.fn(({ body, title }) => renderHtmlEmail({ body, title, footer }))
    const list = tools({ renderBranded })
    const draftId = await approvedDraft(list)

    footer = 'send-time footer'
    const res = await byName(list, 'email_send_draft').execute({ draftId }, {} as any) as any

    expect(res.branded).toBe(true)
    expect(renderBranded).toHaveBeenCalledOnce()
    expect(sent[0].html).toContain('send-time footer')
    expect(sent[0].html).not.toContain('draft-time footer')
  })

  it('stores the sent HTML on the draft for audit', async () => {
    const list = tools({ renderBranded: ({ body, title }: any) => renderHtmlEmail({ body, title }) })
    const draftId = await approvedDraft(list)
    await byName(list, 'email_send_draft').execute({ draftId }, {} as any)
    const row = (db.all(sql`SELECT body_html, body FROM email_drafts WHERE id = ${draftId}`) as any[])[0]
    expect(row.body_html).toContain('<!doctype html>')
    expect(row.body).toContain('The **batch** is ready.')
  })

  it('replaces the text part with the rendered plain-text alternative', async () => {
    const list = tools({ renderBranded: ({ body, title }: any) => renderHtmlEmail({ body, title }) })
    const draftId = await approvedDraft(list)
    await byName(list, 'email_send_draft').execute({ draftId }, {} as any)
    expect(sent[0].text).toContain('The batch is ready.')
    expect(sent[0].text).not.toContain('**')
  })

  it('a branding failure never blocks an approved send', async () => {
    const list = tools({ renderBranded: () => { throw new Error('brand store down') } })
    const draftId = await approvedDraft(list)
    const res = await byName(list, 'email_send_draft').execute({ draftId }, {} as any) as any
    expect(res.ok).toBe(true)
    expect(res.branded).toBe(false)
    expect(sent[0].text).toContain('The **batch** is ready.')
  })

  it('still refuses a draft that is not approved', async () => {
    const list = tools({ renderBranded: ({ body }: any) => renderHtmlEmail({ body }) })
    const created = await byName(list, 'email_create_draft').execute(
      { to: 'x@y.test', subject: 'S', body: 'B' }, {} as any,
    ) as any
    const res = await byName(list, 'email_send_draft').execute({ draftId: created.draftId }, {} as any) as any
    expect(res.error).toContain("must be 'approved'")
    expect(sent).toEqual([])
  })
})
