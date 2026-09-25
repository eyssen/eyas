// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import type { ToolRegistry } from '@modules/tools/tool-registry'
import { buildProductionToolRegistry } from '../helpers/production-tool-registry'
import { generateId } from '@shared/crypto'
import { ALL_TEMPLATES } from '@modules/agent/agent-templates'
import { createTestDb } from '../helpers/test-db'

/**
 * Contract test: every tool name listed in an agent template's `tools:`
 * array must be a name the production tool registry actually registers.
 *
 * Templates used to list placeholder names ('bash', 'file-read', 'search',
 * 'memory', 'documents', 'web-fetch', ...) that never matched any registered
 * tool — every template-created agent silently ran with zero usable tools.
 * This test pins the real, provider-facing tool names so that trap can't
 * come back.
 */

let registry: ToolRegistry

beforeAll(async () => {
  registry = await buildProductionToolRegistry()
})

describe('agent template tool names ↔ tool registry contract', () => {
  it('every template lists only tool names the production registry actually registers', () => {
    for (const template of ALL_TEMPLATES) {
      for (const toolName of template.tools) {
        expect(registry.has(toolName), `template "${template.id}" lists unregistered tool "${toolName}"`).toBe(true)
      }
    }
  })

  it('every template has at least one tool', () => {
    for (const template of ALL_TEMPLATES) {
      expect(template.tools.length, `template "${template.id}" has no tools`).toBeGreaterThan(0)
    }
  })

  it('persists a template\'s tools at creation — the primary-agents INSERT shape round-trips through JSON', () => {
    // Lighter option than driving the full auth setup step: replicate the
    // exact primary-agents INSERT (src/modules/auth/index.ts) against a real
    // schema and assert the round-tripped column is a subset of the registry.
    const { open } = createTestDb('template-names-persistence')
    const db = open()
    const template = ALL_TEMPLATES[0]
    const id = generateId()
    const now = new Date().toISOString()

    db.run(sql`INSERT INTO agent_definitions
      (id, name, description, tier, agent_type, model, max_turns, enabled, source, addressable, workspace_path, tools, created_at, updated_at)
      VALUES (
        ${id}, ${template.name}, ${template.description},
        ${template.tier}, ${template.agentType},
        ${template.model}, ${template.maxTurns},
        ${1}, ${'seed'}, ${1},
        ${'data/agents/' + id}, ${JSON.stringify(template.tools)}, ${now}, ${now}
      )`)

    const row = db.all(sql`SELECT tools FROM agent_definitions WHERE id = ${id}`)[0] as { tools: string }
    expect(row.tools).toBeTruthy()
    const persistedNames: string[] = JSON.parse(row.tools)
    expect(persistedNames.length).toBeGreaterThan(0)
    for (const name of persistedNames) {
      expect(registry.has(name), `persisted tool "${name}" is not registered`).toBe(true)
    }
  })
})
