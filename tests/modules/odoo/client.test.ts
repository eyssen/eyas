import { describe, it, expect } from 'vitest'
import { createOdooClient } from '@modules/odoo/client'
import { createOdooTools } from '@modules/odoo/tools'

describe('Odoo client', () => {
  it('reports not configured when secrets missing', async () => {
    const client = createOdooClient(null)
    expect(client.configured).toBe(false)
    await expect(client.searchRead('project.task', [])).rejects.toThrow(/not configured/i)
  })

  it('tools return friendly error when not configured', async () => {
    const tools = createOdooTools(() => ({ client: createOdooClient(null) }))
    const search = tools.find((t) => t.name === 'odoo_search_tasks')!
    const result = await search.execute({})
    expect(result.error).toMatch(/not configured/i)
  })

  it('registers four tools with green/yellow/red tiers', () => {
    const tools = createOdooTools(() => null)
    expect(tools.map((t) => t.name)).toEqual([
      'odoo_search_tasks',
      'odoo_get_task',
      'odoo_message_post',
      'odoo_write_task',
    ])
    expect(tools.find((t) => t.name === 'odoo_search_tasks')!.riskTier).toBe('green')
    expect(tools.find((t) => t.name === 'odoo_write_task')!.riskTier).toBe('red')
  })
})
