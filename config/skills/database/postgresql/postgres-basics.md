---
name: postgres-basics
description: PostgreSQL fundamentals and connection with postgres.js
trigger_patterns:
  - "postgresql"
  - "postgres"
  - "postgres.js"
  - "pg database"
  - "sql database"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: postgres.js
    url: https://github.com/porsager/postgres
    license: Unlicense
---
# PostgreSQL Basics

## Connection with postgres.js
```typescript
import postgres from 'postgres';

const sql = postgres({
  host: 'localhost',
  port: 5432,
  database: 'eyas',
  username: 'app',
  password: process.env.DB_PASSWORD,
  max: 10,              // connection pool size
  idle_timeout: 20,     // seconds
  connect_timeout: 10,  // seconds
});
```

## Queries
```typescript
// Tagged template literals — safe from SQL injection
const users = await sql`SELECT * FROM users WHERE active = ${true}`;

// Single row
const [user] = await sql`SELECT * FROM users WHERE id = ${userId}`;

// Insert and return
const [created] = await sql`
  INSERT INTO users (name, email)
  VALUES (${name}, ${email})
  RETURNING *
`;

// Dynamic columns and tables
const columns = ['name', 'email'];
const rows = await sql`SELECT ${sql(columns)} FROM users`;
```

## Transactions
```typescript
const result = await sql.begin(async (tx) => {
  const [order] = await tx`INSERT INTO orders (user_id) VALUES (${userId}) RETURNING *`;
  await tx`INSERT INTO order_items (order_id, product_id) VALUES (${order.id}, ${productId})`;
  return order;
});
// Automatically commits on success, rolls back on error
```

## Essential Data Types
- `TEXT` / `VARCHAR(n)`: strings (prefer TEXT unless length constraint needed)
- `INTEGER` / `BIGINT`: whole numbers
- `NUMERIC(p,s)`: exact decimal (money, quantities)
- `BOOLEAN`: true/false
- `TIMESTAMPTZ`: timestamp with time zone (always use this over TIMESTAMP)
- `UUID`: universally unique identifier
- `JSONB`: binary JSON (indexable, queryable)

## Key Features vs SQLite
- Multi-user concurrent read/write
- Rich data types (arrays, JSONB, ranges, enums)
- Advanced indexing (GIN, GiST, BRIN)
- Full-text search built-in (tsvector/tsquery)
- Row-level security policies
- Logical replication

## Best Practices
- Always use `TIMESTAMPTZ` instead of `TIMESTAMP`
- Use parameterized queries — never concatenate user input
- Set `statement_timeout` to prevent long-running queries
- Use connection pooling (postgres.js handles this internally)
