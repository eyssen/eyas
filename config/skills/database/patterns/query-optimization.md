---
name: query-optimization
description: SQL query optimization techniques and anti-patterns
trigger_patterns:
  - "query optimization"
  - "slow query"
  - "sql performance"
  - "n+1"
  - "query plan"
capabilities:
  - database
version: "1.0.0"
---
# Query Optimization

## The N+1 Problem
```typescript
// BAD: N+1 queries
const orders = await db.select().from(ordersTable);
for (const order of orders) {
  const items = await db.select().from(itemsTable).where(eq(itemsTable.orderId, order.id));
}

// GOOD: single query with join
const ordersWithItems = await db
  .select()
  .from(ordersTable)
  .leftJoin(itemsTable, eq(ordersTable.id, itemsTable.orderId));
```

## Pagination
```typescript
// Offset-based (simple but slow for large offsets)
const page = await db.select().from(items).limit(20).offset(40);

// Cursor-based (fast for large datasets)
const page = await db.select().from(items)
  .where(gt(items.id, lastSeenId))
  .orderBy(items.id)
  .limit(20);
```

## Common Anti-Patterns
1. **SELECT ***: fetch only needed columns
2. **Functions in WHERE**: `WHERE YEAR(created_at) = 2026` prevents index use
3. **Implicit type conversion**: comparing string column with number
4. **OR on different columns**: often cannot use indexes — consider UNION
5. **NOT IN with subquery**: use NOT EXISTS or LEFT JOIN IS NULL instead
6. **LIKE '%term'**: leading wildcard cannot use B-tree index — use FTS

## Optimization Techniques
- Add covering indexes (INCLUDE columns) for index-only scans
- Use EXISTS instead of COUNT for existence checks
- Batch small queries into a single round-trip
- Materialize expensive subqueries with CTEs (but check performance)
- Use UNION ALL instead of UNION when duplicates are impossible

## Analyzing Queries
```sql
-- PostgreSQL
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;

-- SQLite
EXPLAIN QUERY PLAN SELECT ...;
```

Look for: sequential scans on large tables, high row estimates, sort operations without indexes, nested loops with many iterations.

## Best Practices
- Optimize the slowest queries first (highest impact)
- Profile in production-like conditions (data volume matters)
- Keep statistics up to date (ANALYZE in PostgreSQL)
- Set query timeouts to prevent runaway queries
- Monitor and log slow queries automatically
