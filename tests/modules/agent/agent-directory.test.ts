// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createAgentDirectory } from '@modules/agent/agent-directory'

describe('AgentDirectory', () => {
  const mockRegistry = {
    list: vi.fn().mockReturnValue([
      { id: 'a1', name: 'Assistant', role: 'Helper', capabilities: ['code', 'research'], enabled: true, tier: 'primary' },
      { id: 'a2', name: 'Engineer', role: 'Builder', capabilities: ['code', 'test'], enabled: true, tier: 'primary' },
      { id: 'a3', name: 'Disabled', role: 'X', capabilities: [], enabled: false, tier: 'specialist' },
    ]),
  }

  it('lists only enabled agents', () => {
    const dir = createAgentDirectory(mockRegistry as any)
    const available = dir.listAvailable()
    expect(available.length).toBe(2)
    expect(available.map(a => a.id)).toEqual(['a1', 'a2'])
  })

  it('returns capability summaries', () => {
    const dir = createAgentDirectory(mockRegistry as any)
    const available = dir.listAvailable()
    expect(available[0]).toEqual({
      id: 'a1', name: 'Assistant', role: 'Helper',
      capabilities: ['code', 'research'], tier: 'primary',
    })
  })

  it('finds agents by capability', () => {
    const dir = createAgentDirectory(mockRegistry as any)
    expect(dir.findByCapability('research').map(a => a.id)).toEqual(['a1'])
    expect(dir.findByCapability('code').map(a => a.id)).toEqual(['a1', 'a2'])
    expect(dir.findByCapability('music')).toEqual([])
  })

  it('formats for prompt injection', () => {
    const dir = createAgentDirectory(mockRegistry as any)
    const text = dir.toPromptText()
    expect(text).toContain('Assistant (a1)')
    expect(text).toContain('Engineer (a2)')
    expect(text).not.toContain('Disabled')
  })
})
