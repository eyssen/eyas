// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceAppendTool,
  workspaceAppendInputSchema,
} from '../../../../src/modules/agent/tools/workspace-append-tool.js'
import {
  createWorkspaceEditTool,
  workspaceEditInputSchema,
} from '../../../../src/modules/agent/tools/workspace-edit-tool.js'
import type { AgentWorkspace, WorkspaceFile } from '../../../../src/modules/prompt-wizard/workspace-types.js'

function file(name: string, body: string): WorkspaceFile {
  return {
    name,
    path: `/fake/${name}`,
    exists: true,
    frontmatter: null,
    body,
    byteSize: body.length,
    truncated: false,
  }
}

function workspace(
  overrides: Partial<{
    agents: string
    tools: string
    memory: string
    daily: { name: string; body: string }[]
  }> = {},
): AgentWorkspace {
  return {
    agentId: 'jarvis',
    rootPath: '/fake',
    identity: file('IDENTITY.md', '# I'),
    soulMd: file('SOUL.md', '# S'),
    soulStyleJson: file('SOUL.style.json', '{}'),
    agentsMd: file('AGENTS.md', overrides.agents ?? ''),
    toolsMd: file('TOOLS.md', overrides.tools ?? ''),
    memoryMd: file('MEMORY.md', overrides.memory ?? ''),
    dailyMemory: (overrides.daily ?? []).map((d) => file(d.name, d.body)),
  }
}

describe('workspace tools', () => {
  describe('workspace_append', () => {
    it('appends to AGENTS.md at file end', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace({ agents: '# Existing notes' })),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceAppendTool({ loader: loader as never, writer: writer as never, audit })

      const result = await tool.invoke('jarvis', { file: 'AGENTS.md', content: 'New entry' })

      expect(result).toEqual({ ok: true, bytesAdded: 9 })
      expect(writer.write).toHaveBeenCalledWith({
        agentId: 'jarvis',
        file: 'AGENTS.md',
        body: '# Existing notes\n\nNew entry',
      })
      expect(loader.invalidate).toHaveBeenCalledWith('jarvis')
    })

    it('schema accepts AGENTS.md and TOOLS.md', () => {
      expect(workspaceAppendInputSchema.safeParse({ file: 'AGENTS.md', content: 'x' }).success).toBe(true)
      expect(workspaceAppendInputSchema.safeParse({ file: 'TOOLS.md', content: 'x' }).success).toBe(true)
    })

    it('schema rejects MEMORY.md and daily memory files — models never write memory', () => {
      for (const file of ['MEMORY.md', 'memory/2026-09-22.md']) {
        expect(workspaceAppendInputSchema.safeParse({ file, content: 'x' }).success, file).toBe(false)
      }
    })

    it('refuses a memory file even when called around the executor', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () =>
          workspace({ memory: 'owner notes', daily: [{ name: 'memory/2026-09-22.md', body: 'old' }] }),
        ),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceAppendTool({ loader: loader as never, writer: writer as never, audit })

      for (const file of ['MEMORY.md', 'memory/2026-09-22.md']) {
        await expect(tool.invoke('jarvis', { file, content: 'today' } as never)).rejects.toThrow()
      }
      expect(writer.write).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('uses ## section heading when section provided', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace({ tools: '# tools' })),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceAppendTool({ loader: loader as never, writer: writer as never, audit })

      await tool.invoke('jarvis', { file: 'TOOLS.md', content: 'body', section: 'New' })

      expect(writer.write).toHaveBeenCalledWith({
        agentId: 'jarvis',
        file: 'TOOLS.md',
        body: '# tools\n\n## New\nbody',
      })
    })

    it('calls audit with bytesAdded matching content length', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace()),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceAppendTool({ loader: loader as never, writer: writer as never, audit })

      await tool.invoke('jarvis', { file: 'TOOLS.md', content: 'hello' })

      expect(audit).toHaveBeenCalledWith({
        agentId: 'jarvis',
        action: 'workspace_append',
        file: 'TOOLS.md',
        bytesAdded: 5,
      })
    })
  })

  describe('workspace_edit', () => {
    it('replaces a unique oldString', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace({ agents: 'foo bar baz' })),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceEditTool({ loader: loader as never, writer: writer as never, audit })

      const result = await tool.invoke('jarvis', {
        file: 'AGENTS.md',
        oldString: 'bar',
        newString: 'BAR',
      })

      expect(result).toEqual({ ok: true })
      expect(writer.write).toHaveBeenCalledWith({
        agentId: 'jarvis',
        file: 'AGENTS.md',
        body: 'foo BAR baz',
      })
      expect(audit).toHaveBeenCalledWith({
        agentId: 'jarvis',
        action: 'workspace_edit',
        file: 'AGENTS.md',
      })
    })

    it('returns failure when oldString is missing', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace({ agents: 'foo bar' })),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceEditTool({ loader: loader as never, writer: writer as never, audit })

      const result = await tool.invoke('jarvis', {
        file: 'AGENTS.md',
        oldString: 'NOT_THERE',
        newString: 'X',
      })

      expect(result).toEqual({ ok: false, reason: 'oldString not found' })
      expect(writer.write).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('returns failure when oldString appears more than once', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace({ agents: 'foo foo foo' })),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceEditTool({ loader: loader as never, writer: writer as never, audit })

      const result = await tool.invoke('jarvis', {
        file: 'AGENTS.md',
        oldString: 'foo',
        newString: 'X',
      })

      expect(result).toEqual({ ok: false, reason: 'oldString appears 3 times — must be unique' })
      expect(writer.write).not.toHaveBeenCalled()
    })

    it('edits TOOLS.md', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace({ tools: 'use rg' })),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceEditTool({ loader: loader as never, writer: writer as never, audit })

      const result = await tool.invoke('jarvis', { file: 'TOOLS.md', oldString: 'rg', newString: 'ripgrep' })

      expect(result).toEqual({ ok: true })
      expect(writer.write).toHaveBeenCalledWith({ agentId: 'jarvis', file: 'TOOLS.md', body: 'use ripgrep' })
    })

    it('schema rejects MEMORY.md — models never write memory', () => {
      expect(workspaceEditInputSchema.safeParse({ file: 'AGENTS.md', oldString: 'a', newString: 'b' }).success).toBe(true)
      expect(workspaceEditInputSchema.safeParse({ file: 'MEMORY.md', oldString: 'a', newString: 'b' }).success).toBe(false)
    })

    it('refuses MEMORY.md even when called around the executor', async () => {
      const writer = { write: vi.fn(async () => undefined), delete: vi.fn() }
      const loader = {
        load: vi.fn(async () => workspace({ memory: 'owner notes', tools: 'owner notes' })),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      }
      const audit = vi.fn(async () => undefined)
      const tool = createWorkspaceEditTool({ loader: loader as never, writer: writer as never, audit })

      await expect(
        tool.invoke('jarvis', { file: 'MEMORY.md', oldString: 'owner', newString: 'model' } as never),
      ).rejects.toThrow()
      expect(writer.write).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })
  })
})
