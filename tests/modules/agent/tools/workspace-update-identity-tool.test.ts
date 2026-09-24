// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceUpdateIdentityTool } from '../../../../src/modules/agent/tools/workspace-update-identity-tool.js'
import { createIdentityUpdateRateLimit } from '../../../../src/modules/agent/tools/identity-update-rate-limit.js'
import type { AgentWorkspace, WorkspaceFile } from '../../../../src/modules/prompt-wizard/workspace-types.js'

function file(name: string, body: string): WorkspaceFile {
  return { name, path: `/fake/${name}`, exists: true, frontmatter: null, body, byteSize: body.length, truncated: false }
}

function workspace(identityBody: string): AgentWorkspace {
  return {
    agentId: 'jarvis', rootPath: '/fake',
    identity: file('IDENTITY.md', identityBody),
    soulMd: file('SOUL.md', ''),
    soulStyleJson: file('SOUL.style.json', '{}'),
    agentsMd: file('AGENTS.md', ''),
    toolsMd: file('TOOLS.md', ''),
    memoryMd: file('MEMORY.md', ''),
    dailyMemory: [],
  }
}

function makeDeps(opts: { enabled?: boolean; identityBody?: string; rateLimit?: ReturnType<typeof createIdentityUpdateRateLimit> } = {}) {
  const loader = {
    load: vi.fn(async () => workspace(opts.identityBody ?? '## My mission\nold mission\n\n## When to escalate\nescalate stuff')),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
  }
  const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
  const notifications = { notify: vi.fn(async () => 'notif-id') }
  const audit = vi.fn(async () => undefined)
  const agentName = vi.fn(async () => 'Jarvis')
  const rateLimit = opts.rateLimit ?? createIdentityUpdateRateLimit()
  return {
    loader: loader as never,
    writer: writer as never,
    notifications: notifications as never,
    audit,
    identitySelfUpdateEnabled: () => opts.enabled ?? true,
    ownerUserId: () => 'owner-1',
    agentName,
    rateLimit,
    // Expose raw mocks for assertions
    _loader: loader,
    _writer: writer,
    _notifications: notifications,
  }
}

describe('workspace_update_identity tool', () => {
  it('updates an existing section in IDENTITY.md', async () => {
    const deps = makeDeps({ identityBody: '## My mission\nold mission\n\n## When to escalate\nescalate stuff' })
    const tool = createWorkspaceUpdateIdentityTool(deps)

    const result = await tool.invoke('jarvis', {
      section: 'My mission',
      newContent: 'Help users with everything',
      reasoning: 'The old mission was too vague and needed to be updated for clarity',
    })

    expect(result).toEqual({ ok: true })
    expect(deps._writer.write).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'jarvis',
        file: 'IDENTITY.md',
        body: expect.stringContaining('Help users with everything'),
      }),
    )
    expect(deps._loader.invalidate).toHaveBeenCalledWith('jarvis')
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'jarvis',
        action: 'identity_update',
        section: 'My mission',
      }),
    )
    expect(deps._notifications.notify).toHaveBeenCalledOnce()
  })

  it('creates section if missing from IDENTITY.md', async () => {
    const deps = makeDeps({ identityBody: '## My mission\nsome content' })
    const tool = createWorkspaceUpdateIdentityTool(deps)

    const result = await tool.invoke('jarvis', {
      section: 'When to refuse',
      newContent: 'Never refuse a valid request from the owner',
      reasoning: 'This section was missing and needs to define refusal conditions clearly',
    })

    expect(result).toEqual({ ok: true })
    const writeCall = (deps._writer.write.mock.calls as any[])[0][0] as { agentId: string; file: string; body: string }
    expect(writeCall.body).toContain('## When to refuse')
    expect(writeCall.body).toContain('Never refuse a valid request from the owner')
    // Section appended at end
    expect(writeCall.body.indexOf('## When to refuse')).toBeGreaterThan(writeCall.body.indexOf('## My mission'))
  })

  it('sends notification with diff in data', async () => {
    const deps = makeDeps()
    const tool = createWorkspaceUpdateIdentityTool(deps)

    await tool.invoke('jarvis', {
      section: 'My mission',
      newContent: 'New mission statement for the agent',
      reasoning: 'Updating mission to be more specific and aligned with current goals',
    })

    expect(deps._notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'agent.identity_changed',
        userId: 'owner-1',
        title: expect.stringContaining('Jarvis'),
        data: expect.objectContaining({
          diff: expect.any(String),
          section: 'My mission',
          agentId: 'jarvis',
        }),
      }),
    )

    const notifyArg = (deps._notifications.notify.mock.calls as any[])[0][0] as { event: string; data: Record<string, unknown> }
    expect((notifyArg.data['diff'] as string).length).toBeGreaterThan(0)
    expect(notifyArg.data['actions']).toHaveLength(2)
  })

  it('returns ok:false when identitySelfUpdateEnabled is false', async () => {
    const deps = makeDeps({ enabled: false })
    const tool = createWorkspaceUpdateIdentityTool(deps)

    const result = await tool.invoke('jarvis', {
      section: 'My mission',
      newContent: 'New mission content here',
      reasoning: 'Trying to update the mission statement for testing purposes',
    })

    expect(result).toEqual({ ok: false, reason: expect.stringContaining('identity self-update disabled') })
    expect(deps._writer.write).not.toHaveBeenCalled()
    expect(deps.audit).not.toHaveBeenCalled()
    expect(deps._notifications.notify).not.toHaveBeenCalled()
  })

  it('rate limit blocks 4th call on same day', async () => {
    const rateLimit = createIdentityUpdateRateLimit()
    const deps = makeDeps({ rateLimit })
    const tool = createWorkspaceUpdateIdentityTool(deps)

    const input = {
      section: 'My mission' as const,
      newContent: 'Updated mission content here',
      reasoning: 'Updating mission for rate limit test to verify the mechanism works correctly',
    }

    const r1 = await tool.invoke('jarvis', input)
    const r2 = await tool.invoke('jarvis', input)
    const r3 = await tool.invoke('jarvis', input)
    const r4 = await tool.invoke('jarvis', input)

    expect(r1).toEqual({ ok: true })
    expect(r2).toEqual({ ok: true })
    expect(r3).toEqual({ ok: true })
    expect(r4).toEqual({ ok: false, reason: expect.stringMatching(/rate limited/) })
    expect(deps._writer.write).toHaveBeenCalledTimes(3)
    expect(deps._notifications.notify).toHaveBeenCalledTimes(3)
  })
})

describe('createIdentityUpdateRateLimit', () => {
  it('allows up to maxPerDay calls on same day', () => {
    let date = new Date('2026-04-26T10:00:00Z')
    const limit = createIdentityUpdateRateLimit(() => date, 3)

    expect(limit.check('agent-1')).toBe(true)
    limit.record('agent-1')
    expect(limit.check('agent-1')).toBe(true)
    limit.record('agent-1')
    expect(limit.check('agent-1')).toBe(true)
    limit.record('agent-1')
    // Now at max — 4th check should be false
    expect(limit.check('agent-1')).toBe(false)
  })

  it('blocks further calls once maxPerDay is reached', () => {
    let date = new Date('2026-04-26T08:00:00Z')
    const limit = createIdentityUpdateRateLimit(() => date, 2)

    limit.record('agent-x')
    limit.record('agent-x')
    expect(limit.check('agent-x')).toBe(false)
  })

  it('resets when the day rolls over', () => {
    let date = new Date('2026-04-26T23:00:00Z')
    const limit = createIdentityUpdateRateLimit(() => date, 3)

    limit.record('agent-y')
    limit.record('agent-y')
    limit.record('agent-y')
    expect(limit.check('agent-y')).toBe(false)

    // Advance to next day
    date = new Date('2026-04-27T01:00:00Z')
    expect(limit.check('agent-y')).toBe(true)
    limit.record('agent-y')
    expect(limit.check('agent-y')).toBe(true)
  })
})
