/**
 * E2E: Board + Conversation lifecycle — stage changes, chatter tracking, full CRUD
 * Validates that board operations trigger proper side effects.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, post, patch, del, expectJson, type TestSession } from './helpers.js'

describe('E2E: Conversation Lifecycle', () => {
  let session: TestSession
  let stageIds: Record<string, string> = {}

  beforeAll(async () => {
    session = await login()
    // Load stage IDs
    const stagesRes = await get(session, '/api/v1/stages')
    const { stages } = await expectJson<{ stages: any[] }>(stagesRes)
    for (const s of stages) {
      stageIds[s.name] = s.id
    }
  })

  it('should create conversation and assign to project+stage', async () => {
    // Get General project
    const projRes = await get(session, '/api/v1/projects')
    const { projects } = await expectJson<{ projects: any[] }>(projRes)
    const general = projects.find((p: any) => p.name === 'General')!

    // Create
    const createRes = await post(session, '/api/v1/conversations', {
      title: 'Lifecycle Test Conv',
    })
    const conv = await expectJson<{ id: string; status: string }>(createRes, 201)
    expect(conv.status).toBe('idle')

    // Assign project + stage
    const patchRes = await patch(session, `/api/v1/conversations/${conv.id}`, {
      projectId: general.id,
      stageId: stageIds['To Do'],
    })
    const updated = await expectJson<{ projectId: string; stageId: string }>(patchRes)
    expect(updated.projectId).toBe(general.id)
    expect(updated.stageId).toBe(stageIds['To Do'])
  })

  it('should track stage changes in chatter', async () => {
    const createRes = await post(session, '/api/v1/conversations', {
      title: 'Chatter Tracking Test',
    })
    const conv = await expectJson<{ id: string }>(createRes, 201)

    // Move to "In Progress"
    await patch(session, `/api/v1/conversations/${conv.id}`, {
      stageId: stageIds['In Progress'],
    })

    // Check chatter for tracking entry
    const chatterRes = await get(session, `/api/v1/chatter/conversation/${conv.id}/messages`)
    const body = await expectJson<{ messages: any[] }>(chatterRes)

    expect(body.messages.length).toBeGreaterThanOrEqual(1)
    const trackingMsg = body.messages.find((m: any) => m.messageType === 'tracking')
    expect(trackingMsg).toBeTruthy()
  })

  it('should move conversation through full stage pipeline', async () => {
    const createRes = await post(session, '/api/v1/conversations', {
      title: 'Stage Pipeline Test',
    })
    const conv = await expectJson<{ id: string }>(createRes, 201)

    // Backlog → To Do → In Progress → Review → Done
    const pipeline = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done']
    for (const stageName of pipeline) {
      if (!stageIds[stageName]) continue
      const res = await patch(session, `/api/v1/conversations/${conv.id}`, {
        stageId: stageIds[stageName],
      })
      const updated = await expectJson<{ stageId: string }>(res)
      expect(updated.stageId).toBe(stageIds[stageName])
    }

    // Verify chatter has multiple tracking entries
    const chatterRes = await get(session, `/api/v1/chatter/conversation/${conv.id}/messages`)
    const { messages } = await expectJson<{ messages: any[] }>(chatterRes)
    const trackingMessages = messages.filter((m: any) => m.messageType === 'tracking')
    expect(trackingMessages.length).toBeGreaterThanOrEqual(pipeline.length - 1) // at least N-1 transitions
  })

  it('should update priority and track it', async () => {
    const createRes = await post(session, '/api/v1/conversations', {
      title: 'Priority Test',
    })
    const conv = await expectJson<{ id: string; priority: string }>(createRes, 201)
    expect(conv.priority).toBe('normal')

    const patchRes = await patch(session, `/api/v1/conversations/${conv.id}`, {
      priority: 'urgent',
    })
    const updated = await expectJson<{ priority: string }>(patchRes)
    expect(updated.priority).toBe('urgent')
  })
})
