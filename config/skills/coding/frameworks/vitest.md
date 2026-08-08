---
name: vitest
description: Vitest configuration, mocking, snapshots, and test utilities
trigger_patterns:
  - "vitest"
  - "vitest config"
  - "vi.fn"
  - "mock"
  - "test runner"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Vitest
    url: https://github.com/vitest-dev/vitest
    license: MIT
---
# Vitest Guide

## Configuration (vitest.config.ts)
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
    testTimeout: 10_000,
    setupFiles: ['./tests/setup.ts'],
  },
});
```

## Mocking
```typescript
// Mock a module
vi.mock('./services/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

// Spy on method
const spy = vi.spyOn(userRepo, 'findById').mockResolvedValue(mockUser);
expect(spy).toHaveBeenCalledWith('user-123');

// Mock timers
vi.useFakeTimers();
vi.advanceTimersByTime(5000);
vi.useRealTimers();
```

## Lifecycle Hooks
```typescript
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.close(); });
beforeEach(() => { vi.clearAllMocks(); });
```

## Assertions
```typescript
expect(result).toBe(42);
expect(array).toHaveLength(3);
expect(obj).toMatchObject({ name: 'Alice' });
expect(() => riskyFn()).toThrow(/invalid/i);
expect(asyncFn()).resolves.toBe('done');
```

## Test Organization
```typescript
describe('OrderService', () => {
  describe('create', () => {
    it('should create order with valid items', async () => { ... });
    it('should reject empty cart', async () => { ... });
  });
  describe('cancel', () => {
    it('should refund payment on cancellation', async () => { ... });
  });
});
```

## Tips
- Use `it.each` for parameterized tests
- Use `it.skip` / `it.only` during development, never commit them
- Prefer `toMatchObject` over `toEqual` for partial matching
- Run `vitest --reporter=verbose` for detailed output
