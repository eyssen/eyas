---
name: input-validation
description: Input validation and sanitization for TypeScript applications
trigger_patterns:
  - "input validation"
  - "zod validation"
  - "sanitize"
  - "schema validation"
  - "data validation"
capabilities:
  - security
version: "1.0.0"
sources:
  - name: Zod
    url: https://github.com/colinhacks/zod
    license: MIT
  - name: validator.js
    url: https://github.com/validatorjs/validator.js
    license: MIT
---
# Input Validation

## Zod Schema Validation
```typescript
import { z } from 'zod';

const UserInput = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().toLowerCase(),
  age: z.number().int().min(0).max(150).optional(),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
  tags: z.array(z.string().max(50)).max(10).default([]),
});

type UserInput = z.infer<typeof UserInput>;

// Validate — throws ZodError on failure
const validated = UserInput.parse(rawInput);

// Safe parse — returns result object
const result = UserInput.safeParse(rawInput);
if (!result.success) {
  const errors = result.error.flatten().fieldErrors;
}
```

## Validation Layers
1. **Transport** — Content-Type, body size, encoding
2. **Schema** — structure, types, required fields (Zod)
3. **Business** — domain rules (e.g., start date before end date)
4. **Sanitization** — trim whitespace, normalize, escape HTML

## Common Validations
```typescript
const SafeString = z.string().trim().min(1).max(1000);
const UUID = z.string().uuid();
const Slug = z.string().regex(/^[a-z0-9-]+$/);
const PositiveInt = z.number().int().positive();
const DateRange = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
}).refine(d => d.start < d.end, { message: 'Start must be before end' });
```

## Best Practices
- Validate at the boundary — API handler, form submission, message consumer
- Reject unknown fields: `z.object({}).strict()`
- Never trust client-side validation alone
- Use `z.coerce` for query params (string to number/date)
- Return all validation errors at once, not one at a time
- Sanitize before storage, escape before rendering
