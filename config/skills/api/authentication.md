---
name: api-authentication
description: API authentication patterns — JWT, OAuth 2.0, API keys, and session tokens
trigger_patterns:
  - "api authentication"
  - "jwt"
  - "oauth"
  - "api key"
  - "bearer token"
  - "session auth"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: jose
    url: https://github.com/panva/jose
    license: MIT
  - name: passport
    url: https://github.com/jaredhanson/passport
    license: MIT
---
# API Authentication

## JWT with jose
```typescript
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

async function createToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return payload;
}
```

## Auth Middleware Pattern
```typescript
async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const payload = await verifyToken(header.slice(7));
    c.set('userId', payload.sub);
    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
}
```

## Auth Methods Comparison
| Method | Use Case | Stateless | Revocable |
|--------|----------|-----------|-----------|
| JWT | API-to-API, SPA | Yes | No (use short TTL) |
| Session token | Web apps | No | Yes |
| API key | Service accounts | Yes | Yes |
| OAuth 2.0 | Third-party access | Yes | Yes |

## Security Checklist
- Store tokens in httpOnly cookies (not localStorage)
- Use short expiration (15min access + refresh token rotation)
- Validate `aud`, `iss` claims in JWT
- Hash API keys before storing in DB
- Implement token revocation for sensitive operations
- Rate limit login endpoints aggressively
- Use PKCE for OAuth public clients
