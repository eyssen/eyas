---
name: financial-calculations
description: Financial calculations including currency handling, interest, and budgeting
trigger_patterns:
  - "financial calculation"
  - "currency"
  - "interest rate"
  - "compound interest"
  - "money calculation"
capabilities:
  - currency-handling
  - interest-calculation
  - financial-formulas
version: "1.0.0"
sources:
  - name: dinero.js
    url: https://github.com/dinerojs/dinero.js
    license: MIT
---
# Financial Calculations

## Currency Handling with Dinero.js
Never use floating-point for money. Use integer cents or a library.

```typescript
import { dinero, add, subtract, multiply, toDecimal } from 'dinero.js';
import { USD, EUR, HUF } from '@dinerojs/currencies';

const price = dinero({ amount: 1999, currency: USD });  // $19.99
const tax = dinero({ amount: 540, currency: USD });      // $5.40
const total = add(price, tax);                           // $25.39

toDecimal(total);  // "25.39"

// Hungarian Forint (0 decimal places)
const hufPrice = dinero({ amount: 5990, currency: HUF });  // 5990 Ft
```

## Common Financial Formulas

### Compound Interest
```
A = P * (1 + r/n)^(n*t)
```
- P = principal, r = annual rate, n = compounds per year, t = years
```typescript
function compoundInterest(principal: number, rate: number, compounds: number, years: number): number {
  return principal * Math.pow(1 + rate / compounds, compounds * years);
}
compoundInterest(10000, 0.05, 12, 10);  // ~16470.09
```

### Present Value
```
PV = FV / (1 + r)^n
```
What is a future amount worth today?

### ROI (Return on Investment)
```
ROI = (Gain - Cost) / Cost * 100
```

### Break-Even Point
```
Break-Even = Fixed Costs / (Price per Unit - Variable Cost per Unit)
```

### Profit Margin
```
Gross Margin = (Revenue - COGS) / Revenue * 100
Net Margin = Net Income / Revenue * 100
```

## Floating-Point Trap
```typescript
// WRONG — floating point errors
0.1 + 0.2;  // 0.30000000000000004

// CORRECT — use integer cents
(10 + 20) / 100;  // 0.3

// BEST — use Dinero.js or similar library
```

## Currency Formatting
```typescript
new Intl.NumberFormat('hu-HU', {
  style: 'currency',
  currency: 'HUF',
  maximumFractionDigits: 0,
}).format(5990);  // "5 990 Ft"

new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format(19.99);  // "$19.99"
```

## Best Practices
- NEVER use `number` for currency — use integer cents or a money library
- Store amounts as integers in the database (cents, smallest unit)
- Always specify currency — never assume
- Round at the last step, not intermediate calculations
- Use `Intl.NumberFormat` for display formatting
