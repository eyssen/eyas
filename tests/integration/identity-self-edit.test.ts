// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 51b — Identity self-edit tool integration test.
// Verifies: notification fires with diff, section update, revert restores old body.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { setupTestEyas } from '../helpers/test-eyas.js'
import { createWorkspaceUpdateIdentityTool } from '@modules/agent/tools/workspace-update-identity-tool.js'
import { createIdentityUpdateRateLimit } from '@modules/agent/tools/identity-update-rate-limit.js'
import type { NotificationRouter } from '@modules/notifications/router.js'

describe('workspace_update_identity tool', () => {
  let harness: ReturnType<typeof setupTestEyas>

  afterEach(async () => {
    await harness?.shutdown()
  })

  function makeMockNotifications() {
    const calls: unknown[] = []
    const router: NotificationRouter = {
      notify: async (payload: unknown) => { calls.push(payload) },
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as unknown as NotificationRouter
    return { router, calls }
  }

  it('updates IDENTITY.md section and fires a notification with diff', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const { router, calls } = makeMockNotifications()

    const tool = createWorkspaceUpdateIdentityTool({
      loader: harness.workspaceLoader,
      writer: harness.workspaceWriter,
      notifications: router,
      audit: async () => {},
      identitySelfUpdateEnabled: () => true,
      ownerUserId: () => 'owner-1',
      agentName: async () => 'Jarvis',
      rateLimit: createIdentityUpdateRateLimit(),
    })

    const result = await tool.invoke(agentId, {
      section: 'My mission',
      newContent: 'Updated mission: keep things simple.',
      reasoning: 'The original mission description was too long and needed trimming.',
    })

    expect(result).toEqual({ ok: true })

    // Notification must have fired
    expect(calls.length).toBe(1)
    const notification = calls[0] as Record<string, unknown>
    expect(notification.event).toBe('agent.identity_changed')
    expect((notification.data as Record<string, unknown>).diff).toContain('My mission')

    // The file should now contain the updated content
    harness.workspaceLoader.invalidate(agentId)
    const ws = await harness.workspaceLoader.load(agentId)
    expect(ws.identity.body).toContain('Updated mission: keep things simple.')
  })

  it('reverts the identity file to the old body on request', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    // Capture old body
    const originalWs = await harness.workspaceLoader.load(agentId)
    const oldBody = originalWs.identity.body

    const { router } = makeMockNotifications()

    const tool = createWorkspaceUpdateIdentityTool({
      loader: harness.workspaceLoader,
      writer: harness.workspaceWriter,
      notifications: router,
      audit: async () => {},
      identitySelfUpdateEnabled: () => true,
      ownerUserId: () => 'owner-1',
      agentName: async () => 'Jarvis',
      rateLimit: createIdentityUpdateRateLimit(),
    })

    await tool.invoke(agentId, {
      section: 'My mission',
      newContent: 'I should be reverted.',
      reasoning: 'Testing revert functionality with a proper explanation.',
    })

    // Revert by writing the old body back directly
    await harness.workspaceWriter.write({
      agentId,
      file: 'IDENTITY.md',
      body: oldBody,
      skipFrontmatter: false,
    })

    harness.workspaceLoader.invalidate(agentId)
    const revertedWs = await harness.workspaceLoader.load(agentId)
    expect(revertedWs.identity.body).not.toContain('I should be reverted.')
    expect(revertedWs.identity.body).toContain('My mission')
  })

  it('rate limit blocks updates beyond 3 per day', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const { router } = makeMockNotifications()
    const rateLimit = createIdentityUpdateRateLimit()

    const tool = createWorkspaceUpdateIdentityTool({
      loader: harness.workspaceLoader,
      writer: harness.workspaceWriter,
      notifications: router,
      audit: async () => {},
      identitySelfUpdateEnabled: () => true,
      ownerUserId: () => 'owner-1',
      agentName: async () => 'Jarvis',
      rateLimit,
    })

    for (let i = 0; i < 3; i++) {
      const r = await tool.invoke(agentId, {
        section: 'My mission',
        newContent: `Mission update ${i}`,
        reasoning: 'Testing rate limit with adequate reasoning text here.',
      })
      expect(r.ok).toBe(true)
      harness.workspaceLoader.invalidate(agentId)
    }

    // 4th update must be rejected
    const r4 = await tool.invoke(agentId, {
      section: 'My mission',
      newContent: 'Should be blocked.',
      reasoning: 'Testing rate limit block — this should not go through.',
    })
    expect(r4.ok).toBe(false)
    if (!r4.ok) {
      expect(r4.reason).toContain('rate limited')
    }
  })
})
