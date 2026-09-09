---
name: cors-policy
description: CORS configuration — origins, methods, credentials, and preflight
trigger_patterns:
  - "cors"
  - "cross origin"
  - "preflight"
  - "access control allow"
  - "cors error"
capabilities:
  - security
version: "1.0.0"
sources:
  - name: Hono
    url: https://github.com/honojs/hono
    license: MIT
---
# CORS Policy Guide

## How CORS Works
1. Browser sends `Origin` header with cross-origin request
2. Server responds with `Access-Control-Allow-Origin`
3. For non-simple requests, browser sends OPTIONS preflight first
4. Server responds with allowed methods, headers, and max age

## Hono Configuration
```typescript
import { cors } from 'hono/cors';

app.use('/api/*', cors({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  exposeHeaders: ['X-RateLimit-Remaining', 'X-Request-Id'],
  maxAge: 86400,       // cache preflight for 24h
  credentials: true,   // allow cookies
}));
```

## Dynamic Origin Validation
```typescript
app.use('/api/*', cors({
  origin: (origin) => {
    const allowed = ['https://app.example.com', 'https://staging.example.com'];
    return allowed.includes(origin) ? origin : '';
  },
}));
```

## Common CORS Errors
- **Missing `Access-Control-Allow-Origin`** — server does not handle CORS
- **Wildcard `*` with credentials** — not allowed by spec, must list specific origins
- **Missing preflight response** — OPTIONS handler not configured
- **Blocked header** — header not listed in `Access-Control-Allow-Headers`

## Security Rules
- Never use `Access-Control-Allow-Origin: *` with credentials
- Whitelist specific origins — do not reflect the request `Origin` blindly
- Limit exposed methods to what the API actually uses
- Keep `maxAge` reasonable — allows updating policy without long cache
- For internal APIs: consider not enabling CORS at all

## Preflight Triggers
These cause a preflight OPTIONS request:
- Methods other than GET, HEAD, POST
- Headers other than Accept, Content-Type (with restrictions), Content-Language
- Content-Type other than `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`
