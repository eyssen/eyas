import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { createEmailTools, ensureEmailDraftTables } from '@modules/tools/builtin/email-tools'

describe('email L2 draft-approve-send', () => {
  let db: ReturnType<typeof createDatabase>
  let tools: ReturnType<typeof createEmailTools>

  beforeEach(() => {
    db = createDatabase(':memory:')
    ensureEmailDraftTables(db)
    tools = createEmailTools({
      getDb: () => db,
      getCommunication: () => null,
    })
  })

  it('creates a pending draft', async () => {
    const create = tools.find((t) => t.name === 'email_create_draft')!
    const result = await create.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello' },
      { conversationId: 'c1', userId: 'u1', logger: console as any },
    )
    expect(result.draftId).toBeTruthy()
    expect(result.status).toBe('pending')
  })

  it('refuses send until approved', async () => {
    const create = tools.find((t) => t.name === 'email_create_draft')!
    const send = tools.find((t) => t.name === 'email_send_draft')!
    const { draftId } = (await create.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello' },
      { conversationId: 'c1', userId: 'u1', logger: console as any },
    )) as { draftId: string }

    const refused = await send.execute({ draftId })
    expect(refused.error).toMatch(/approved/i)
  })

  it('sends after approve (dry-run without channel)', async () => {
    const create = tools.find((t) => t.name === 'email_create_draft')!
    const approve = tools.find((t) => t.name === 'email_approve_draft')!
    const send = tools.find((t) => t.name === 'email_send_draft')!

    const { draftId } = (await create.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Hello' },
      { conversationId: 'c1', userId: 'u1', logger: console as any },
    )) as { draftId: string }

    await approve.execute({ draftId })
    const sent = await send.execute({ draftId })
    expect(sent.ok).toBe(true)
    expect(sent.dryRun).toBe(true)
  })
})
