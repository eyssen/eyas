---
name: secure-coding
description: Secure coding practices for TypeScript backend applications
trigger_patterns:
  - "secure coding"
  - "security best practice"
  - "hardening"
  - "defense in depth"
  - "secure by default"
capabilities:
  - security
version: "1.0.0"
---
# Secure Coding Practices

## Input Handling
- Validate all input at the boundary — never trust client data
- Use strict schemas (Zod) with explicit types and constraints
- Reject unknown fields — `z.object({}).strict()`
- Sanitize before storage, escape before rendering

## Output Safety
- Never expose internal IDs, stack traces, or system paths in responses
- Mask sensitive fields in logs (email, IP, tokens)
- Use separate DTOs for API responses — do not return raw DB rows

## Error Handling
```typescript
// BAD — leaks internals
catch (err) { return c.json({ error: err.message, stack: err.stack }, 500); }

// GOOD — generic message, log details server-side
catch (err) {
  logger.error({ err, requestId }, 'Unhandled error');
  return c.json({ error: 'Internal server error', requestId }, 500);
}
```

## Timing Attacks
```typescript
import { timingSafeEqual } from 'crypto';

// Always use constant-time comparison for secrets
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

## File Operations
- Validate file paths — prevent path traversal (`../../../etc/passwd`)
- Use `path.resolve()` and verify result is within allowed directory
- Set file size limits on uploads
- Validate file type by content (magic bytes), not just extension

## Database
- Use parameterized queries — always
- Apply least privilege to DB users
- Enable audit logging for sensitive tables
- Encrypt PII columns at rest

## Dependencies
- Audit regularly, fail CI on critical vulnerabilities
- Minimize dependency count — less code = less attack surface
- Verify license compatibility (MIT project = no GPL)

## Checklist for Code Review
- [ ] All input validated and sanitized
- [ ] No secrets in code or logs
- [ ] Error responses do not leak internals
- [ ] Auth/authz checks on every protected route
- [ ] Sensitive operations have audit logging
