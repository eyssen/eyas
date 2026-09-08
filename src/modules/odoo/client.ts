// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Minimal Odoo JSON-RPC client (XML-RPC-compatible auth + execute_kw).
 * Secrets come from the EYAS secrets registry — never hardcode credentials.
 */

export interface OdooClientConfig {
  url: string
  db: string
  username: string
  /** API key or password */
  apiKey: string
}

export interface OdooClient {
  readonly configured: boolean
  searchRead(
    model: string,
    domain: unknown[],
    fields?: string[],
    opts?: { limit?: number; offset?: number; order?: string },
  ): Promise<Record<string, unknown>[]>
  read(model: string, ids: number[], fields?: string[]): Promise<Record<string, unknown>[]>
  write(model: string, ids: number[], values: Record<string, unknown>): Promise<boolean>
  messagePost(model: string, resId: number, body: string, opts?: { messageType?: string }): Promise<number>
  getUid(): Promise<number>
}

async function jsonRpc(url: string, service: string, method: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${url.replace(/\/$/, '')}/jsonrpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Date.now(),
    }),
  })
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`)
  const data = (await res.json()) as { result?: unknown; error?: { data?: { message?: string }; message?: string } }
  if (data.error) {
    throw new Error(data.error.data?.message ?? data.error.message ?? 'Odoo RPC error')
  }
  return data.result
}

export function createOdooClient(config: OdooClientConfig | null): OdooClient {
  let uid: number | null = null

  if (!config?.url || !config.db || !config.username || !config.apiKey) {
    return {
      configured: false,
      async getUid() {
        throw new Error('Odoo is not configured (set odoo-url, odoo-db, odoo-username, odoo-api-key secrets)')
      },
      async searchRead() {
        throw new Error('Odoo is not configured')
      },
      async read() {
        throw new Error('Odoo is not configured')
      },
      async write() {
        throw new Error('Odoo is not configured')
      },
      async messagePost() {
        throw new Error('Odoo is not configured')
      },
    }
  }

  const { url, db, username, apiKey } = config

  async function ensureUid(): Promise<number> {
    if (uid != null) return uid
    const result = await jsonRpc(url, 'common', 'authenticate', [db, username, apiKey, {}])
    if (typeof result !== 'number' || result <= 0) {
      throw new Error('Odoo authentication failed')
    }
    uid = result
    return uid
  }

  async function executeKw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
    const u = await ensureUid()
    return jsonRpc(url, 'object', 'execute_kw', [db, u, apiKey, model, method, args, kwargs])
  }

  return {
    configured: true,

    async getUid() {
      return ensureUid()
    },

    async searchRead(model, domain, fields = [], opts = {}) {
      const kwargs: Record<string, unknown> = {}
      if (fields.length) kwargs.fields = fields
      if (opts.limit != null) kwargs.limit = opts.limit
      if (opts.offset != null) kwargs.offset = opts.offset
      if (opts.order) kwargs.order = opts.order
      const result = await executeKw(model, 'search_read', [domain], kwargs)
      return (result as Record<string, unknown>[]) ?? []
    },

    async read(model, ids, fields = []) {
      const kwargs = fields.length ? { fields } : {}
      const result = await executeKw(model, 'read', [ids], kwargs)
      return (result as Record<string, unknown>[]) ?? []
    },

    async write(model, ids, values) {
      const result = await executeKw(model, 'write', [ids, values])
      return Boolean(result)
    },

    async messagePost(model, resId, body, opts = {}) {
      const result = await executeKw(model, 'message_post', [[resId]], {
        body,
        message_type: opts.messageType ?? 'comment',
        subtype_xmlid: 'mail.mt_comment',
      })
      return Number(result)
    },
  }
}
