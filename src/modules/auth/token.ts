import { SignJWT, jwtVerify } from 'jose'

export interface TokenPayload {
  sub: string
  role: string
}

export interface TokenService {
  signAccessToken(payload: TokenPayload, expiresInSeconds: number): Promise<string>
  verifyAccessToken(token: string): Promise<TokenPayload>
  generateRefreshToken(): string
}

export function createTokenService(secret: string): TokenService {
  const secretKey = new TextEncoder().encode(secret)

  return {
    async signAccessToken(payload, expiresInSeconds) {
      const now = Math.floor(Date.now() / 1000)
      return new SignJWT({ role: payload.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(payload.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + expiresInSeconds)
        .sign(secretKey)
    },

    async verifyAccessToken(token) {
      const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] })
      return {
        sub: payload.sub!,
        role: payload.role as string,
      }
    },

    generateRefreshToken() {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    },
  }
}
