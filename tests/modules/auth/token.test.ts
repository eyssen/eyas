import { describe, it, expect } from 'vitest'
import { createTokenService } from '@modules/auth/token'

describe('token service', () => {
  const secret = 'a-very-secret-key-that-is-at-least-32-chars-long!'
  const service = createTokenService(secret)

  describe('access tokens', () => {
    it('creates a valid JWT access token', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'owner' }, 900)
      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3)
    })

    it('verifies a valid access token and returns payload', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'admin' }, 900)
      const payload = await service.verifyAccessToken(token)
      expect(payload.sub).toBe('user-123')
      expect(payload.role).toBe('admin')
    })

    it('rejects a tampered token', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'owner' }, 900)
      const tampered = token.slice(0, -5) + 'XXXXX'
      await expect(service.verifyAccessToken(tampered)).rejects.toThrow()
    })

    it('rejects an expired token', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'owner' }, -1)
      await expect(service.verifyAccessToken(token)).rejects.toThrow()
    })
  })

  describe('refresh tokens', () => {
    it('generates a random refresh token string', () => {
      const token = service.generateRefreshToken()
      expect(token).toBeTruthy()
      expect(token.length).toBeGreaterThanOrEqual(32)
    })

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => service.generateRefreshToken()))
      expect(tokens.size).toBe(50)
    })
  })
})
