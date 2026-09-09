---
name: refactoring
description: Code smells identification and safe refactoring techniques
trigger_patterns:
  - "refactor"
  - "code smell"
  - "clean code"
  - "technical debt"
  - "extract method"
capabilities:
  - coding
version: "1.0.0"
---
# Refactoring Guide

## Common Code Smells
- **Long method** (>20 lines) — extract smaller functions
- **God class** — split into focused, single-responsibility classes
- **Feature envy** — method uses another class's data more than its own
- **Primitive obsession** — use value objects instead of raw types
- **Shotgun surgery** — one change requires edits in many places
- **Dead code** — unused functions, unreachable branches

## Safe Refactoring Steps
1. Ensure tests exist and pass (green baseline)
2. Make one small, focused change
3. Run tests after each change
4. Commit frequently — each step reversible

## Extract Method
```typescript
// Before
function processOrder(order: Order) {
  const tax = order.subtotal * 0.21;
  const shipping = order.weight > 5 ? 9.99 : 4.99;
  const total = order.subtotal + tax + shipping;
  // ... 20 more lines
}

// After
function calculateTax(subtotal: number): number { return subtotal * 0.21; }
function calculateShipping(weight: number): number { return weight > 5 ? 9.99 : 4.99; }
```

## Replace Conditional with Polymorphism
```typescript
// Before: switch on type string
// After: interface + implementations
interface PaymentProcessor { charge(amount: number): Promise<Receipt>; }
class StripeProcessor implements PaymentProcessor { ... }
class PayPalProcessor implements PaymentProcessor { ... }
```

## Rename for Clarity
- `data` -> `userPreferences`
- `handle()` -> `processIncomingMessage()`
- `tmp` -> `pendingNotifications`

## Refactoring Priorities
1. Fix bugs first — refactor second
2. Refactor code you are actively changing
3. Leave code better than you found it
4. Do not refactor and add features in the same commit
