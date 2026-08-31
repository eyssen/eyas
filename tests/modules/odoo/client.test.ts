import { describe, it, expect } from 'vitest'
import { createOdooClient, type OdooClient } from '@modules/odoo/client'
import { createOdooTools } from '@modules/odoo/tools'

const logger = { warn() {}, info() {}, error() {}, debug() {} } as any

function fakeClient(overrides: Partial<OdooClient> = {}): OdooClient {
  return {
    configured: true,
    async getUid() { return 1 },
    async searchRead() { return [] },
    async read(_model, ids) { return [{ id: ids[0], name: 'Task' }] },
    async write() { return true },
    async messagePost() { return 1 },
    ...overrides,
  }
}

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

  it('odoo_get_task on project alpha uses the ticket connection, not the default or global client', async () => {
    const used: string[] = []
    const ticketClient = fakeClient()
    const tools = createOdooTools(() => ({
      client: fakeClient({
        async read() {
          throw new Error('global client must not be used')
        },
      }),
      getProjectConnections: (id) =>
        id === 'alpha'
          ? { defaultConnectionId: 'conn-alpha-db', ticketConnectionId: 'conn-alpha-tickets' }
          : null,
      getClientForConnection: async (id) => {
        used.push(id)
        return ticketClient
      },
    }))
    const getTask = tools.find((t) => t.name === 'odoo_get_task')!
    const result = await getTask.execute(
      { id: 42 },
      { conversationId: 'c-alpha', userId: 'u1', projectId: 'alpha', logger },
    )
    expect(used).toEqual(['conn-alpha-tickets'])
    expect(result.task).toMatchObject({ id: 42 })
    expect(result.connectionId).toBe('conn-alpha-tickets')
  })

  it('accepts an optional connectionId on ticket tools', () => {
    const tools = createOdooTools(() => null)
    const schema = tools.find((t) => t.name === 'odoo_get_task')!.inputSchema as {
      properties: Record<string, unknown>
    }
    expect(schema.properties.connectionId).toBeTruthy()
  })
})
