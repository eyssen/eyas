/**
 * E2E: Authentication tests
 * Run: bun vitest run tests/e2e/auth.test.ts
 * Requires: EYAS server running on localhost:3000
 */
import { describe, it, expect } from 'vitest'
import { login, get } from './helpers.js'

describe('E2E: Authentication', () => {
  it('should login with valid credentials', async () => {
    const session = await login()
    expect(session.cookie).toContain('eyas_session=')
    expect(session.username).toBe('testadmin')
    expect(session.userId).toBeTruthy()
  })

  it('should reject invalid credentials', async () => {
    await expect(login('invalid', 'wrong')).rejects.toThrow('Login failed')
  })

  it('should return user info on GET /auth/me', async () => {
    const session = await login()
    const res = await get(session, '/api/v1/auth/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string; role: string } }
    expect(body.user.username).toBe('testadmin')
    expect(body.user.role).toBe('owner')
  })

  it('should reject unauthenticated requests', async () => {
    const res = await fetch('http://localhost:3100/api/v1/auth/me')
    expect(res.status).toBe(401)
  })
})
