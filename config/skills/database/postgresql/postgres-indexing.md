---
name: postgres-indexing
description: PostgreSQL indexing strategies — B-tree, GIN, GiST, and partial indexes
trigger_patterns:
  - "postgres index"
  - "create index"
  - "gin index"
  - "indexing strategy"
  - "postgres b-tree"
capabilities:
  - database
version: "1.0.0"
---
# PostgreSQL Indexing

## Index Types

### B-tree (Default)
Best for equality and range queries on scalar values.
```sql
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_orders_date ON orders (created_at DESC);
```

### GIN (Generalized Inverted Index)
Best for array containment, JSONB queries, and full-text search.
```sql
CREATE INDEX idx_docs_tags ON documents USING GIN (tags);
CREATE INDEX idx_data_jsonb ON events USING GIN (metadata jsonb_path_ops);
CREATE INDEX idx_search ON articles USING GIN (to_tsvector('english', content));
```

### GiST (Generalized Search Tree)
Best for geometric data, ranges, and proximity searches.
```sql
CREATE INDEX idx_events_range ON events USING GIST (tstzrange(start_at, end_at));
```

### BRIN (Block Range Index)
Best for naturally ordered data (timestamps on append-only tables). Very small index size.
```sql
CREATE INDEX idx_logs_created ON logs USING BRIN (created_at);
```

## Composite Indexes
```sql
-- Leftmost prefix rule: this index serves queries on (user_id) and (user_id, status)
CREATE INDEX idx_orders_user_status ON orders (user_id, status);
```

## Partial Indexes
Only index rows matching a condition — smaller and faster.
```sql
CREATE INDEX idx_active_users ON users (email) WHERE active = true;
CREATE INDEX idx_pending_orders ON orders (created_at) WHERE status = 'pending';
```

## Unique Indexes
```sql
CREATE UNIQUE INDEX idx_users_email_unique ON users (email);
-- Partial unique: allow multiple NULL but unique non-NULL
CREATE UNIQUE INDEX idx_users_phone ON users (phone) WHERE phone IS NOT NULL;
```

## Index Maintenance
```sql
-- Check index usage
SELECT indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;  -- unused indexes at the top

-- Check index size
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Rebuild bloated index
REINDEX INDEX CONCURRENTLY idx_name;
```

## Best Practices
- Create indexes CONCURRENTLY in production to avoid locking
- Remove unused indexes — they slow down writes
- Prefer partial indexes when queries filter on a constant condition
- Use INCLUDE columns for index-only scans
- Analyze query plans with EXPLAIN before and after adding indexes
