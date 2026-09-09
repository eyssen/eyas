---
name: authentication-patterns
description: Authentication patterns — password hashing, JWT, session management
trigger_patterns:
  - "authentication"
  - "password hashing"
  - "bcrypt"
  - "login security"
  - "session management"
capabilities:
  - security
version: "1.0.0"
sources:
  - name: jose
    url: https://github.com/panva/jose
    license: MIT
  - name: bcrypt
    url: https://github.com/kelektiv/node.bcrypt.js
    license: MIT
---
# Authentication Patterns

## Password Hashing
```typescript
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

## JWT Token Pair
```typescript
import { SignJWT, jwtVerify } from 'jose';

async function issueTokens(userId: string) {
  const accessToken = await new SignJWT({ sub: userId, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .sign(secret);

  const refreshToken = await new SignJWT({ sub: userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret);

  return { accessToken, refreshToken };
}
```

## Session Security
- Store session ID in httpOnly, Secure, SameSite=Strict cookie
- Generate session IDs with crypto-random bytes (min 128 bits)
- Regenerate session ID after login (prevent fixation)
- Expire idle sessions after 30 minutes

## Account Protection
- Lock account after 5 failed login attempts (15 min cooldown)
- Implement progressive delays between attempts
- Log all auth events with IP and user agent
- Require re-authentication for sensitive operations

## Best Practices
- Never store plaintext passwords — hash with bcrypt or argon2
- Short-lived access tokens (15min), longer refresh tokens (7d)
- Rotate refresh tokens on each use (detect reuse = compromise)
- Use constant-time comparison for secrets (`timingSafeEqual`)
- Invalidate all sessions on password change
