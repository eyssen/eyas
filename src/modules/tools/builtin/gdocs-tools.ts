// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Google Docs tools — thin wrappers over the Docs/Drive APIs using a service
// account JSON path from secrets. No external helper binary required.

import type { ToolImplementation } from '../types.js'

interface GdocsDeps {
  /** Returns service-account JSON string or null. */
  getServiceAccountJson: () => Promise<string | null>
  logger?: { warn: (...a: any[]) => void; debug: (...a: any[]) => void }
}

async function getAccessToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson) as {
    client_email: string
    private_key: string
    token_uri?: string
  }
  // Dynamic import of jose-free JWT via crypto — use google token endpoint with
  // a minimal RS256 JWT built by Node crypto (avoid heavy deps).
  const { createSign } = await import('node:crypto')
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file',
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url')
  const unsigned = `${header}.${claim}`
  const sign = createSign('RSA-SHA256')
  sign.update(unsigned)
  const signature = sign.sign(sa.private_key, 'base64url')
  const jwt = `${unsigned}.${signature}`
  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as { access_token: string }
  return json.access_token
}

function extractDocId(urlOrId: string): string {
  const m = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(urlOrId)
  if (m) return m[1]!
  return urlOrId.trim()
}

export function createGdocsTools(deps: GdocsDeps): ToolImplementation[] {
  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T | { error: string }> {
    const sa = await deps.getServiceAccountJson()
    if (!sa) return { error: 'Google Docs not configured — set secret google-docs-sa-json' }
    try {
      const token = await getAccessToken(sa)
      return await fn(token)
    } catch (err: any) {
      return { error: err?.message ?? String(err) }
    }
  }

  return [
    {
      name: 'gdocs_read',
      description: 'Read the plain-text content of a Google Doc by URL or document ID.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Document URL or ID' },
        },
        required: ['documentId'],
      },
      execute: async (input) => {
        const docId = extractDocId(String(input.documentId))
        return withToken(async (token) => {
          const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) throw new Error(`Docs API ${res.status}`)
          const doc = await res.json() as any
          const chunks: string[] = []
          for (const el of doc.body?.content ?? []) {
            for (const e of el.paragraph?.elements ?? []) {
              if (e.textRun?.content) chunks.push(e.textRun.content)
            }
          }
          return { documentId: docId, title: doc.title, text: chunks.join('') }
        })
      },
    },
    {
      name: 'gdocs_replace',
      description: 'Find-and-replace text in a Google Doc. Requires the service account to have edit access.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          find: { type: 'string' },
          replace: { type: 'string' },
          matchCase: { type: 'boolean' },
        },
        required: ['documentId', 'find', 'replace'],
      },
      execute: async (input) => {
        const docId = extractDocId(String(input.documentId))
        return withToken(async (token) => {
          const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [{
                replaceAllText: {
                  containsText: {
                    text: String(input.find),
                    matchCase: input.matchCase !== false,
                  },
                  replaceText: String(input.replace),
                },
              }],
            }),
          })
          if (!res.ok) throw new Error(`Docs API ${res.status}: ${(await res.text()).slice(0, 200)}`)
          const json = await res.json()
          return { documentId: docId, result: json }
        })
      },
    },
    {
      name: 'gdocs_append',
      description: 'Append plain text to the end of a Google Doc.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['documentId', 'text'],
      },
      execute: async (input) => {
        const docId = extractDocId(String(input.documentId))
        const text = String(input.text)
        return withToken(async (token) => {
          // End-of-doc insert: index 1 is start; use a large index via endOfSegment
          const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [{
                insertText: {
                  endOfSegmentLocation: { segmentId: '' },
                  text: text.endsWith('\n') ? text : `${text}\n`,
                },
              }],
            }),
          })
          if (!res.ok) throw new Error(`Docs API ${res.status}: ${(await res.text()).slice(0, 200)}`)
          return { documentId: docId, ok: true }
        })
      },
    },
  ]
}
