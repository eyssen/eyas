---
name: api-testing
description: API testing strategies — integration tests, contract tests, and mocking
trigger_patterns:
  - "api testing"
  - "api test"
  - "supertest"
  - "contract test"
  - "api mock"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: supertest
    url: https://github.com/ladjs/supertest
    license: MIT
---
# API Testing

## Integration Test with Hono
```typescript
import { testClient } from 'hono/testing';

describe('Users API', () => {
  const client = testClient(app);

  it('should create a user', async () => {
    const res = await client.api.v1.users.$post({
      json: { name: 'Alice', email: 'alice@test.com' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('Alice');
  });

  it('should return 400 for invalid email', async () => {
    const res = await client.api.v1.users.$post({
      json: { name: 'Bob', email: 'not-an-email' },
    });
    expect(res.status).toBe(400);
  });
});
```

## Test Patterns
- **Happy path** — valid input returns expected result
- **Validation** — invalid input returns 400 with details
- **Auth** — missing token returns 401, wrong role returns 403
- **Not found** — non-existent resource returns 404
- **Idempotency** — duplicate POST handled correctly

## Contract Testing
Validate API responses match your OpenAPI spec:
```typescript
it('should match OpenAPI schema', async () => {
  const res = await client.api.v1.users.$get();
  const body = await res.json();
  const valid = validateAgainstSchema(body, 'UserList');
  expect(valid.errors).toEqual([]);
});
```

## Test Database
```typescript
let db: TestDatabase;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.reset(); });  // clean state per test
```

## Best Practices
- Test the HTTP layer — real requests, real middleware
- One test database per test suite, reset between tests
- Never depend on test execution order
- Test error responses as carefully as success responses
- Mock external services (email, payment), not your own code
