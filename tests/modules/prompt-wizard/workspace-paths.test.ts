import { describe, expect, it } from 'vitest'
import { resolveWorkspaceRoot, resolveWorkspaceFile, dailyMemoryPath } from '../../../src/modules/prompt-wizard/workspace-paths.js'

describe('workspace-paths', () => {
  it('resolves workspace root for an agent id', () => {
    expect(resolveWorkspaceRoot('jarvis-uuid', '/data')).toBe('/data/agents/jarvis-uuid')
  })
  it('resolves IDENTITY.md path', () => {
    expect(resolveWorkspaceFile('jarvis-uuid', 'IDENTITY.md', '/data')).toBe('/data/agents/jarvis-uuid/IDENTITY.md')
  })
  it('builds daily memory path for an ISO date', () => {
    expect(dailyMemoryPath('jarvis-uuid', '2026-04-26', '/data')).toBe('/data/agents/jarvis-uuid/memory/2026-04-26.md')
  })
  it('rejects path traversal in agent id', () => {
    expect(() => resolveWorkspaceRoot('../etc/passwd', '/data')).toThrow(/invalid agent id/i)
    expect(() => resolveWorkspaceRoot('jarvis/../foo', '/data')).toThrow(/invalid agent id/i)
  })
  it('rejects daily memory path with bad date', () => {
    expect(() => dailyMemoryPath('jarvis-uuid', '2026-13-99', '/data')).toThrow(/invalid date/i)
    expect(() => dailyMemoryPath('jarvis-uuid', 'not-a-date', '/data')).toThrow(/invalid date/i)
  })
})
