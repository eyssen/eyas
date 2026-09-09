---
name: tdd
description: Test-Driven Development — red-green-refactor cycle and BDD approach
trigger_patterns:
  - "tdd"
  - "test driven"
  - "red green refactor"
  - "bdd"
  - "behavior driven"
capabilities:
  - coding
version: "1.0.0"
---
# Test-Driven Development

## Red-Green-Refactor Cycle
1. **Red** — Write a failing test for the next small behavior
2. **Green** — Write the minimum code to make the test pass
3. **Refactor** — Clean up while keeping tests green

## TDD Example Flow
```typescript
// Step 1: RED — test first
it('should return empty array for no matches', () => {
  expect(search([], 'query')).toEqual([]);
});

// Step 2: GREEN — simplest implementation
function search(items: Item[], query: string): Item[] {
  return [];
}

// Step 3: RED — next behavior
it('should find items by name', () => {
  const items = [{ name: 'alpha' }, { name: 'beta' }];
  expect(search(items, 'alpha')).toEqual([{ name: 'alpha' }]);
});

// Step 4: GREEN — extend
function search(items: Item[], query: string): Item[] {
  return items.filter(i => i.name.includes(query));
}
```

## BDD Style (Given-When-Then)
```typescript
describe('Cart checkout', () => {
  it('given a cart with items, when user checks out, then order is created', async () => {
    // Given
    const cart = createCart([item('Book', 29.99)]);
    // When
    const order = await checkout(cart, paymentMethod);
    // Then
    expect(order.status).toBe('confirmed');
    expect(order.total).toBe(29.99);
  });
});
```

## TDD Principles
- Write the test before the code — always
- Only write enough code to pass the current test
- Refactor only when tests are green
- Small steps — one assertion focus per iteration
- Tests are documentation — name them as specifications
- If you cannot write a test, the requirement is unclear

## When TDD Shines
- Business logic with clear rules
- Algorithms and data transformations
- API contract validation
- Bug reproduction and regression prevention
