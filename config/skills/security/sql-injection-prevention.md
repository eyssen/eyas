---
name: sql-injection-prevention
description: SQL injection prevention with parameterized queries and ORM safety
trigger_patterns:
  - "sql injection"
  - "parameterized query"
  - "prepared statement"
  - "query safety"
capabilities:
  - security
version: "1.0.0"
sources:
  - name: Drizzle ORM
    url: https://github.com/drizzle-team/drizzle-orm
    license: Apache-2.0
---
# SQL Injection Prevention

## The Vulnerability
```typescript
// DANGEROUS — string concatenation
const query = `SELECT * FROM users WHERE name = '${userInput}'`;
// Input: ' OR '1'='1 → returns all users
```

## Parameterized Queries (Safe)
```typescript
// Raw SQL with parameters
const result = db.run(
  'SELECT * FROM users WHERE name = ? AND role = ?',
  [userInput, roleInput]
);
```

## ORM-Based (Drizzle — Safe by Default)
```typescript
import { eq, and, like } from 'drizzle-orm';

// Safe — values are always parameterized
const user = await db.select()
  .from(users)
  .where(and(
    eq(users.name, userInput),
    eq(users.role, roleInput)
  ));

// Safe dynamic queries
const conditions = [];
if (name) conditions.push(like(users.name, `%${name}%`));
if (role) conditions.push(eq(users.role, role));
const results = await db.select().from(users).where(and(...conditions));
```

## Dangerous Patterns to Avoid
```typescript
// NEVER use sql`` with unvalidated interpolation
const bad = sql`SELECT * FROM ${sql.raw(tableName)}`;  // raw() bypasses escaping

// SAFE — use sql.identifier for dynamic table/column names
const safe = sql`SELECT * FROM ${sql.identifier(tableName)}`;
```

## Defense Layers
1. **Parameterized queries** — primary defense (always)
2. **Input validation** — reject unexpected characters with Zod
3. **Least privilege** — DB user has only needed permissions
4. **WAF** — detect and block SQL injection patterns at network level

## Testing for Injection
- Include injection payloads in API tests: `' OR 1=1 --`, `'; DROP TABLE users; --`
- Use automated scanners periodically
- Review all raw SQL queries in code review
