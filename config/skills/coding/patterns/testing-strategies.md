---
name: testing-strategies
description: Unit, integration, and end-to-end testing strategies
trigger_patterns:
  - "testing strategy"
  - "unit test"
  - "integration test"
  - "e2e test"
  - "test pyramid"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Vitest
    url: https://github.com/vitest-dev/vitest
    license: MIT
---
# Testing Strategies

## Test Pyramid
1. **Unit tests** (70%) — fast, isolated, single function/class
2. **Integration tests** (20%) — module boundaries, DB, API routes
3. **E2E tests** (10%) — full user flows, browser automation

## Unit Test Structure (AAA)
```typescript
describe('PriceCalculator', () => {
  it('should apply discount when quantity exceeds threshold', () => {
    // Arrange
    const calc = new PriceCalculator({ discountThreshold: 10 });
    // Act
    const price = calc.calculate({ unitPrice: 100, quantity: 15 });
    // Assert
    expect(price).toBe(1350); // 15 * 100 * 0.9
  });
});
```

## Integration Test with DB
```typescript
describe('UserRepository', () => {
  let db: TestDatabase;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.cleanup(); });

  it('should persist and retrieve user', async () => {
    const repo = new UserRepository(db.connection);
    await repo.create({ name: 'Alice', email: 'a@b.com' });
    const user = await repo.findByEmail('a@b.com');
    expect(user?.name).toBe('Alice');
  });
});
```

## Test Doubles
- **Stub** — returns canned data
- **Mock** — verifies interactions (use `vi.fn()`)
- **Spy** — wraps real implementation, records calls
- **Fake** — lightweight working implementation (in-memory DB)

## Guidelines
- Test behavior, not implementation details
- One assertion per concept (multiple `expect` OK if testing same behavior)
- Name tests: `should [expected behavior] when [condition]`
- Keep tests independent — no shared mutable state
