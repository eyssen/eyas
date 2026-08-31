---
name: http-client-patterns
description: HTTP client patterns with ky and undici
trigger_patterns:
  - "http client"
  - "fetch"
  - "api call"
  - "ky"
  - "undici"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: ky
    url: https://github.com/sindresorhus/ky
    license: MIT
  - name: undici
    url: https://github.com/nodejs/undici
    license: MIT
---
# HTTP Client Patterns

## ky (Browser and Node.js)
```typescript
import ky from 'ky';

const api = ky.create({
  prefixUrl: 'https://api.example.com/v1',
  timeout: 30000,
  headers: { 'Authorization': `Bearer ${token}` },
  retry: { limit: 3, statusCodes: [408, 429, 500, 502, 503] },
  hooks: {
    beforeRequest: [(request) => {
      // add timestamp, logging, etc.
    }],
    afterResponse: [(request, options, response) => {
      // log response, update rate limit counters
    }],
  },
});

const users = await api.get('users', {
  searchParams: { page: 1, limit: 20 },
}).json<User[]>();

const created = await api.post('users', {
  json: { name: 'Alice', email: 'alice@example.com' },
}).json<User>();
```

## undici (Node.js/Bun High Performance)
```typescript
import { request } from 'undici';

const { statusCode, headers, body } = await request('https://api.example.com/data', {
  method: 'GET',
  headers: { 'Accept': 'application/json' },
});

const data = await body.json();
```

## Native fetch (Universal)
```typescript
const response = await fetch('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(10000),
});

if (!response.ok) {
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

const data = await response.json();
```

## Request Patterns
- **Timeout**: always set timeouts to prevent hanging
- **Abort**: use `AbortController` for cancelable requests
- **Streaming**: use `response.body` ReadableStream for large responses
- **Pagination**: iterate with cursor or page-based pagination helpers

## Best Practices
- Create a pre-configured client instance (base URL, auth, headers)
- Validate response data with Zod before trusting it
- Log request/response metadata for debugging (not bodies in production)
- Handle network errors separately from HTTP error status codes
- Use ky for convenience (retry, hooks, JSON), undici for raw performance
