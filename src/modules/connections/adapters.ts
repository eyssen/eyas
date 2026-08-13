// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createOdooClient } from '@modules/odoo/client.js'
import { connectionSecretName, getSystemType } from './catalog.js'
import type { ConnectionsService, SecretsLike } from './service.js'
import type { Connection, ConnectionTestResult } from './types.js'

export interface AdapterContext {
  secrets?: SecretsLike | null
  /** MCP client from communication submodule, if present. */
  mcpClient?: {
    list?: () => Array<{ id: string; name: string; status: string; error?: string | null }>
    get?: (id: string) => { id: string; name: string; status: string; error?: string | null } | null
  } | null
  fetchImpl?: typeof fetch
}

async function secretFor(
  conn: Connection,
  field: string,
  secrets: SecretsLike | null | undefined,
  resolved: Record<string, string>,
): Promise<string | null> {
  if (resolved[field]) return resolved[field]
  const vaultName = connectionSecretName(conn.id, field)
  if (resolved[vaultName]) return resolved[vaultName]
  // Legacy / shared secret names (e.g. github-token from skill docs)
  const catalog = getSystemType(conn.systemType)
  const legacy = (conn.config?.secretName as string | undefined)
    ?? (catalog?.skillName ? undefined : undefined)
  if (legacy && resolved[legacy]) return resolved[legacy]
  if (!secrets) return null
  try {
    const v = await secrets.get(vaultName, 'system', { trusted: true })
    if (v) return v
  } catch { /* */ }
  // Fall back to well-known global secret names used by integration skills
  const globals: Record<string, string[]> = {
    github: ['github-token'],
    gitlab: ['gitlab-token'],
    linear: ['linear-api-key'],
    notion: ['notion-token'],
    jira: ['jira-api-token'],
    slack: ['slack-bot-token'],
    odoo: ['odoo-api-key'],
  }
  for (const name of globals[conn.systemType] ?? []) {
    try {
      const v = await secrets.get(name, 'system', { trusted: true })
      if (v) return v
    } catch { /* */ }
  }
  return null
}

async function testOdoo(conn: Connection, ctx: AdapterContext, resolved: Record<string, string>): Promise<ConnectionTestResult> {
  const url = String(conn.config.url ?? '')
  const db = String(conn.config.db ?? '')
  const username = String(conn.config.username ?? '')
  const apiKey = await secretFor(conn, 'api-key', ctx.secrets, resolved)
  if (!url || !db || !username || !apiKey) {
    return { ok: false, status: 'error', message: 'Missing url, db, username, or api-key secret' }
  }
  try {
    const client = createOdooClient({ url, db, username, apiKey })
    const uid = await client.getUid()
    return { ok: true, status: 'connected', message: `Authenticated (uid ${uid})`, details: { uid } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 'error', message }
  }
}

async function testMcp(conn: Connection, ctx: AdapterContext): Promise<ConnectionTestResult> {
  const mcp = ctx.mcpClient
  if (!mcp?.list && !mcp?.get) {
    return { ok: false, status: 'error', message: 'MCP client module is not available' }
  }
  const serverId = conn.config.mcpServerId as string | undefined
  const serverName = conn.config.mcpServerName as string | undefined
  let server: { id: string; name: string; status: string; error?: string | null } | null = null
  if (serverId && mcp.get) {
    server = mcp.get(serverId)
  }
  if (!server && mcp.list) {
    const all = mcp.list()
    server = all.find((s) => s.id === serverId || s.name === serverName || s.name === conn.name) ?? null
  }
  if (!server) {
    return {
      ok: false,
      status: 'error',
      message: 'No matching MCP server. Set config.mcpServerId or mcpServerName after adding the server under MCP Settings.',
    }
  }
  if (server.status === 'connected') {
    return { ok: true, status: 'connected', message: `MCP server "${server.name}" is connected`, details: { mcpServerId: server.id } }
  }
  return {
    ok: false,
    status: 'error',
    message: `MCP server "${server.name}" status is ${server.status}${server.error ? `: ${server.error}` : ''}`,
    details: { mcpServerId: server.id, mcpStatus: server.status },
  }
}

async function testHttp(conn: Connection, ctx: AdapterContext, resolved: Record<string, string>): Promise<ConnectionTestResult> {
  const fetchFn = ctx.fetchImpl ?? globalThis.fetch
  if (!fetchFn) {
    return { ok: false, status: 'error', message: 'fetch is not available' }
  }

  const type = conn.systemType
  try {
    if (type === 'github') {
      const token = await secretFor(conn, 'token', ctx.secrets, resolved)
      if (!token) return { ok: false, status: 'error', message: 'Missing token secret' }
      const base = String(conn.config.baseUrl ?? 'https://api.github.com').replace(/\/$/, '')
      const res = await fetchFn(`${base}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'EYAS-connections',
        },
      })
      if (!res.ok) {
        return { ok: false, status: 'error', message: `GitHub API HTTP ${res.status}` }
      }
      const body = (await res.json()) as { login?: string }
      return { ok: true, status: 'connected', message: `GitHub OK as ${body.login ?? 'user'}`, details: { login: body.login } }
    }

    if (type === 'gitlab') {
      const token = await secretFor(conn, 'token', ctx.secrets, resolved)
      if (!token) return { ok: false, status: 'error', message: 'Missing token secret' }
      const base = String(conn.config.baseUrl ?? 'https://gitlab.com').replace(/\/$/, '')
      const res = await fetchFn(`${base}/api/v4/user`, {
        headers: { 'PRIVATE-TOKEN': token },
      })
      if (!res.ok) return { ok: false, status: 'error', message: `GitLab API HTTP ${res.status}` }
      const body = (await res.json()) as { username?: string }
      return { ok: true, status: 'connected', message: `GitLab OK as ${body.username ?? 'user'}` }
    }

    if (type === 'linear') {
      const key = await secretFor(conn, 'api-key', ctx.secrets, resolved)
      if (!key) return { ok: false, status: 'error', message: 'Missing api-key secret' }
      const res = await fetchFn('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '{ viewer { id name } }' }),
      })
      if (!res.ok) return { ok: false, status: 'error', message: `Linear API HTTP ${res.status}` }
      const body = (await res.json()) as { data?: { viewer?: { name?: string } }; errors?: unknown[] }
      if (body.errors?.length) {
        return { ok: false, status: 'error', message: 'Linear GraphQL error' }
      }
      return { ok: true, status: 'connected', message: `Linear OK as ${body.data?.viewer?.name ?? 'viewer'}` }
    }

    if (type === 'notion') {
      const token = await secretFor(conn, 'token', ctx.secrets, resolved)
      if (!token) return { ok: false, status: 'error', message: 'Missing token secret' }
      const res = await fetchFn('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
        },
      })
      if (!res.ok) return { ok: false, status: 'error', message: `Notion API HTTP ${res.status}` }
      return { ok: true, status: 'connected', message: 'Notion OK' }
    }

    if (type === 'jira') {
      const token = await secretFor(conn, 'api-token', ctx.secrets, resolved)
      const email = String(conn.config.email ?? '')
      const base = String(conn.config.baseUrl ?? '').replace(/\/$/, '')
      if (!token || !email || !base) {
        return { ok: false, status: 'error', message: 'Missing baseUrl, email, or api-token' }
      }
      const auth = Buffer.from(`${email}:${token}`).toString('base64')
      const res = await fetchFn(`${base}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      })
      if (!res.ok) return { ok: false, status: 'error', message: `Jira API HTTP ${res.status}` }
      return { ok: true, status: 'connected', message: 'Jira OK' }
    }

    if (type === 'slack') {
      const token = await secretFor(conn, 'bot-token', ctx.secrets, resolved)
      if (!token) return { ok: false, status: 'error', message: 'Missing bot-token secret' }
      const res = await fetchFn('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = (await res.json()) as { ok?: boolean; error?: string; team?: string }
      if (!body.ok) return { ok: false, status: 'error', message: body.error ?? 'Slack auth.test failed' }
      return { ok: true, status: 'connected', message: `Slack OK (${body.team ?? 'workspace'})` }
    }

    // custom-http + fallback
    const baseUrl = String(conn.config.baseUrl ?? '').replace(/\/$/, '')
    if (!baseUrl) {
      // No network probe possible — verify secrets presence only
      const catalog = getSystemType(conn.systemType)
      const required = catalog?.secretFields.filter((f) => f.required) ?? []
      for (const f of required) {
        const v = await secretFor(conn, f.name, ctx.secrets, resolved)
        if (!v) return { ok: false, status: 'error', message: `Missing required secret: ${f.name}` }
      }
      return {
        ok: true,
        status: 'connected',
        message: 'Secrets present (no health endpoint configured)',
      }
    }
    const healthPath = String(conn.config.healthPath ?? '/').startsWith('http')
      ? String(conn.config.healthPath)
      : `${baseUrl}${String(conn.config.healthPath ?? '/')}`
    const token = await secretFor(conn, 'token', ctx.secrets, resolved)
    const headerName = String(conn.config.authHeader ?? 'Authorization')
    const headers: Record<string, string> = {}
    if (token) {
      headers[headerName] = headerName.toLowerCase() === 'authorization' && !token.startsWith('Bearer ')
        ? `Bearer ${token}`
        : token
    }
    const res = await fetchFn(healthPath, { headers })
    if (!res.ok) return { ok: false, status: 'error', message: `HTTP ${res.status} from ${healthPath}` }
    return { ok: true, status: 'connected', message: `HTTP ${res.status} OK` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 'error', message }
  }
}

/**
 * Run adapter-specific health check and persist status on the connection.
 */
export async function testConnection(
  service: ConnectionsService,
  conn: Connection,
  ctx: AdapterContext,
): Promise<ConnectionTestResult> {
  if (conn.status === 'pending') {
    return { ok: false, status: 'pending', message: 'Connection is pending approval' }
  }
  if (conn.status === 'disabled') {
    return { ok: false, status: 'disabled', message: 'Connection is disabled' }
  }

  let resolved: Record<string, string> = {}
  if (ctx.secrets) {
    resolved = await service.resolveSecrets(conn, ctx.secrets)
  }

  let result: ConnectionTestResult
  switch (conn.adapter) {
    case 'native':
      if (conn.systemType === 'odoo') {
        result = await testOdoo(conn, ctx, resolved)
      } else {
        result = { ok: false, status: 'error', message: `No native adapter for ${conn.systemType}` }
      }
      break
    case 'mcp':
      result = await testMcp(conn, ctx)
      break
    case 'http':
    case 'channel':
    default:
      result = await testHttp(conn, ctx, resolved)
      break
  }

  service.setHealth(conn.id, {
    status: result.status === 'connected' ? 'connected' : result.status === 'pending' || result.status === 'disabled' ? result.status : 'error',
    lastError: result.ok ? null : (result.message ?? 'test failed'),
  })

  return result
}
