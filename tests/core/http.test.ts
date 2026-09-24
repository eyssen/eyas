import { describe, it, expect } from 'vitest'
import { createApp } from '@core/http/server'
import { getVersion } from '@core/version'

describe('HTTP Server', () => {
  it('responds to health check', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.version).toBe(getVersion())
  })

  it('returns 404 for unknown routes', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/nonexistent')
    expect(res.status).toBe(404)
  })

  it('sets CORS headers', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
  })

  it('handles errors gracefully', async () => {
    const app = createApp()
    app.get('/api/v1/test-error', () => { throw new Error('test error') })
    const res = await app.request('/api/v1/test-error')
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBeDefined()
  })
})
