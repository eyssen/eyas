---
name: api-security
description: API security hardening — headers, CORS, input validation, and transport
trigger_patterns:
  - "api security"
  - "security headers"
  - "cors"
  - "input validation api"
  - "api hardening"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: helmet
    url: https://github.com/helmetjs/helmet
    license: MIT
---
# API Security

## Security Headers
```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('X-XSS-Protection', '0');  // modern browsers use CSP instead
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});
```

## CORS Configuration
```typescript
app.use('/api/*', cors({
  origin: ['https://app.example.com'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
  credentials: true,
}));
```

## Input Validation
```typescript
import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().toLowerCase(),
  age: z.number().int().min(0).max(150).optional(),
});
// Validate early, reject fast
```

## Transport Security
- Always use HTTPS in production
- Pin TLS 1.2+ minimum
- Use HSTS header to prevent protocol downgrade
- Redirect HTTP to HTTPS at load balancer level

## Request Safety
- Limit request body size (1MB default, configurable per endpoint)
- Set timeouts on all requests (30s default)
- Validate Content-Type header matches body
- Sanitize all user input before storage

## Authentication Security
- Use short-lived tokens (15min access, 7d refresh)
- Rotate refresh tokens on each use
- Implement account lockout after failed attempts
- Log authentication events for audit

## Best Practices
- Defense in depth — multiple layers of validation
- Principle of least privilege for API keys
- Never expose internal error details
- Audit log all state-changing operations
