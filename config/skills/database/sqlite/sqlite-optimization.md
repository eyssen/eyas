---
name: sqlite-optimization
description: SQLite performance optimization with better-sqlite3
trigger_patterns:
  - "sqlite optimization"
  - "sqlite performance"
  - "better-sqlite3"
  - "sqlite fast"
  - "sqlite tuning"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: better-sqlite3
    url: https://github.com/WiseLibs/better-sqlite3
    license: MIT
---
# SQLite Optimization

## better-sqlite3 Setup
```typescript
import Database from 'better-sqlite3';

const db = new Database('app.db');

// Essential pragmas for performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');    // 64MB cache
db.pragma('foreign_keys = ON');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');  // 256MB memory-mapped I/O
```

## Prepared Statements
```typescript
// Prepare once, execute many times
const insert = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
const getById = db.prepare('SELECT * FROM items WHERE id = ?');

// Use .get() for single row, .all() for multiple, .run() for writes
const item = getById.get(42);
const result = insert.run('test', 100);
```

## Batch Operations with Transactions
```typescript
const insertMany = db.transaction((items: Array<{ name: string; value: number }>) => {
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  for (const item of items) {
    stmt.run(item.name, item.value);
  }
});

// 10,000 inserts in a single transaction: ~50ms vs ~50s without transaction
insertMany(items);
```

## Indexing Strategy
- Create indexes on columns used in WHERE, JOIN, and ORDER BY
- Composite indexes: leftmost prefix rule applies
- Use `EXPLAIN QUERY PLAN` to verify index usage
- Partial indexes for filtered queries: `CREATE INDEX idx ON t(col) WHERE active = 1`

## Common Performance Issues
- Missing indexes on frequently queried columns
- Too many individual INSERT/UPDATE statements (batch them)
- Not using WAL mode (blocks concurrent reads during writes)
- Excessive use of `SELECT *` — select only needed columns
- Large BLOB storage — consider external files with path references

## Bun:sqlite Alternative
- Bun has a built-in SQLite module (`bun:sqlite`) with similar API
- Slightly different method names but same optimization principles apply
- Use better-sqlite3 for Node.js fallback compatibility
