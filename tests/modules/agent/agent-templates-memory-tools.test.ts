// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// R2B-DELIV-07: five shipped templates listed no memory_search/memory_expand,
// so on an API provider those agents could not drill into EYAS memory at all.
// Memory is now the platform's: the tool scope adds it to every allowlist. This
// sweeps the real templates against the real tool registry, so a template edit
// or a tool rename cannot quietly take memory away from an agent again.

import { describe, it, expect } from 'vitest'
import { ALL_TEMPLATES } from '@modules/agent/agent-templates'
import { PLATFORM_MANDATORY_TOOLS, resolveToolScope, scopeAllows, scopedToolDefinitions } from '@modules/agent/tool-scope'
import { buildProductionToolRegistry } from '../../helpers/production-tool-registry'

describe('shipped agent templates — memory tools are always in scope', () => {
  it('every template\'s effective scope allows memory_search and memory_expand', () => {
    expect(ALL_TEMPLATES.length).toBeGreaterThan(0)
    for (const template of ALL_TEMPLATES) {
      for (const orchestration of ['auto', 'solo', 'deep']) {
        const scope = resolveToolScope({ agentTools: template.tools, orchestration })
        for (const name of ['memory_search', 'memory_expand']) {
          expect(scopeAllows(scope, name), `${template.id} (${orchestration}) → ${name}`).toBe(true)
        }
      }
    }
  })

  it('every template is actually offered the mandatory tools by the production registry', async () => {
    const registry = await buildProductionToolRegistry()
    for (const template of ALL_TEMPLATES) {
      const offered = scopedToolDefinitions(registry, resolveToolScope({ agentTools: template.tools })).map((d) => d.name)
      for (const name of PLATFORM_MANDATORY_TOOLS) {
        expect(offered, `${template.id} is offered ${name}`).toContain(name)
      }
    }
  })

  it('a template without memory tools in its own list still gets them (negative: the list alone would not)', () => {
    const bare = ALL_TEMPLATES.filter((t) => t.tools.length > 0 && !t.tools.includes('memory_search'))
    // The regression this guards exists only while such a template ships.
    expect(bare.length).toBeGreaterThan(0)
    for (const template of bare) {
      expect(template.tools).not.toContain('memory_search')
      expect(resolveToolScope({ agentTools: template.tools }).include).toContain('memory_search')
    }
  })
})
