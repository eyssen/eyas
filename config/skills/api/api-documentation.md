---
name: api-documentation
description: API documentation best practices and tools
trigger_patterns:
  - "api documentation"
  - "api docs"
  - "swagger ui"
  - "scalar"
  - "api reference"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: "@scalar/openapi-parser"
    url: https://github.com/scalar/scalar
    license: MIT
---
# API Documentation

## Documentation Structure
1. **Getting Started** — auth, base URL, quick example
2. **Authentication** — how to obtain and use tokens
3. **Endpoints Reference** — grouped by resource, auto-generated from OpenAPI
4. **Error Codes** — complete list with descriptions
5. **Rate Limits** — quotas and headers
6. **Changelog** — what changed per version
7. **SDKs / Examples** — code samples in multiple languages

## OpenAPI-Driven Docs
Generate documentation directly from your OpenAPI spec:
```typescript
import { apiReference } from '@scalar/hono-api-reference';

app.get('/docs', apiReference({
  spec: { url: '/openapi.json' },
  theme: 'default',
}));
```

## Writing Good Endpoint Docs
```yaml
/api/v1/users/{id}:
  get:
    summary: Get user by ID
    description: Returns a single user. Requires `users:read` permission.
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: string, format: uuid }
        example: "550e8400-e29b-41d4-a716-446655440000"
    responses:
      "200":
        description: User found
        content:
          application/json:
            example:
              data: { id: "550e...", name: "Alice", email: "alice@example.com" }
```

## Best Practices
- Keep docs in sync — generate from spec, never hand-write separately
- Include runnable examples (curl, fetch, SDK)
- Show both success and error response examples
- Document rate limits per endpoint
- Use realistic example values, not "string" or "test"
- Provide a sandbox/playground for interactive testing
- Version your docs alongside your API
