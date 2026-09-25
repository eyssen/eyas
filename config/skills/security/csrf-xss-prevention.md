---
name: csrf-xss-prevention
description: Cross-site scripting and cross-site request forgery prevention
trigger_patterns:
  - "csrf"
  - "xss"
  - "cross site"
  - "script injection"
  - "sanitize html"
capabilities:
  - security
version: "1.0.0"
sources:
  - name: DOMPurify
    url: https://github.com/cure53/DOMPurify
    license: Apache-2.0
  - name: helmet
    url: https://github.com/helmetjs/helmet
    license: MIT
---
# CSRF and XSS Prevention

## XSS Prevention
**Rule: Never trust user input in HTML output.**

### Content Security Policy
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'
```

### HTML Sanitization
```typescript
import DOMPurify from 'dompurify';

const clean = DOMPurify.sanitize(userInput, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  ALLOWED_ATTR: ['href'],
});
```

### Output Encoding
```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

## CSRF Prevention

### SameSite Cookies
```typescript
setCookie(c, 'session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',  // blocks cross-origin requests
  path: '/',
  maxAge: 3600,
});
```

### CSRF Token Pattern
```typescript
// Generate token per session
const csrfToken = crypto.randomBytes(32).toString('hex');

// Validate on state-changing requests
app.use('*', async (c, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const token = c.req.header('X-CSRF-Token');
    if (token !== c.get('csrfToken')) return c.json({ error: 'Invalid CSRF token' }, 403);
  }
  await next();
});
```

## Best Practices
- Use `SameSite=Strict` cookies — eliminates most CSRF
- Set CSP headers — blocks inline scripts and unauthorized sources
- Sanitize HTML with DOMPurify before rendering user content
- Use React/framework auto-escaping — avoid `dangerouslySetInnerHTML`
- Validate `Origin` header on state-changing requests
