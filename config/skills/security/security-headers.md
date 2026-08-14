---
name: security-headers
description: HTTP security headers configuration and best practices
trigger_patterns:
  - "security headers"
  - "content security policy"
  - "csp"
  - "hsts"
  - "x-frame-options"
capabilities:
  - security
version: "1.0.0"
sources:
  - name: helmet
    url: https://github.com/helmetjs/helmet
    license: MIT
---
# Security Headers

## Essential Headers
```typescript
// Hono middleware
app.use('*', async (c, next) => {
  await next();
  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff');
  // Block iframe embedding (clickjacking prevention)
  c.header('X-Frame-Options', 'DENY');
  // Force HTTPS for 1 year
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Control referrer information
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Disable browser features you do not use
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});
```

## Content Security Policy (CSP)
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' wss://your-domain.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

## Header Reference
| Header | Purpose | Recommended Value |
|--------|---------|-------------------|
| `X-Content-Type-Options` | Prevent MIME sniffing | `nosniff` |
| `X-Frame-Options` | Prevent clickjacking | `DENY` |
| `Strict-Transport-Security` | Force HTTPS | `max-age=31536000; includeSubDomains` |
| `Content-Security-Policy` | Control resource loading | See above |
| `Referrer-Policy` | Limit referrer data | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Disable browser APIs | Deny unused features |
| `Cross-Origin-Opener-Policy` | Isolate browsing context | `same-origin` |
| `Cross-Origin-Resource-Policy` | Restrict resource sharing | `same-origin` |

## Testing
- Use [securityheaders.com](https://securityheaders.com) to scan your site
- Check CSP violations with `report-uri` directive during rollout
- Start CSP in report-only mode: `Content-Security-Policy-Report-Only`

## Best Practices
- Set all headers globally via middleware
- Start CSP strict, relax only as needed
- Test CSP with `report-only` before enforcing
- Review headers after every infrastructure change
