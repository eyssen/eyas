---
name: postgres-performance
description: PostgreSQL performance tuning — configuration, EXPLAIN, and optimization
trigger_patterns:
  - "postgres performance"
  - "postgres slow"
  - "explain analyze"
  - "postgres tuning"
  - "query plan"
capabilities:
  - database
version: "1.0.0"
---
# PostgreSQL Performance

## Key Configuration Parameters
```ini
# Memory
shared_buffers = '256MB'          # 25% of RAM for dedicated DB server
work_mem = '16MB'                 # per-operation sort/hash memory
maintenance_work_mem = '128MB'    # VACUUM, CREATE INDEX
effective_cache_size = '768MB'    # hint for query planner (75% of RAM)

# WAL
wal_buffers = '16MB'
checkpoint_completion_target = 0.9

# Planner
random_page_cost = 1.1            # SSD (default 4.0 is for HDD)
effective_io_concurrency = 200    # SSD
```

## EXPLAIN ANALYZE
```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders
WHERE user_id = 42
ORDER BY created_at DESC
LIMIT 20;
```

Key things to look for:
- **Seq Scan** on large tables — missing index
- **Nested Loop** with high row estimates — consider hash/merge join
- **Sort** with high memory — add index for ORDER BY
- **Actual vs estimated rows** — stale statistics, run ANALYZE

## Common Optimizations
1. **Add indexes** for WHERE, JOIN, ORDER BY columns
2. **Use LIMIT** with ORDER BY for pagination
3. **Avoid SELECT *** — fetch only needed columns
4. **Use EXISTS** instead of COUNT for existence checks
5. **Batch inserts** — use multi-row VALUES or COPY
6. **Partial indexes** for filtered queries

## VACUUM and Statistics
```sql
-- Manual vacuum (usually autovacuum handles this)
VACUUM ANALYZE orders;

-- Check table bloat
SELECT relname, n_dead_tup, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

## Connection Management
- Use connection pooling (PgBouncer or application-level)
- Set `idle_in_transaction_session_timeout` to kill abandoned transactions
- Monitor active connections: `SELECT * FROM pg_stat_activity`

## Monitoring Queries
```sql
-- Slowest queries (requires pg_stat_statements)
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Table sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```
