---
name: connection-pooling
description: Database connection pooling strategies and configuration
trigger_patterns:
  - "connection pool"
  - "connection pooling"
  - "database connections"
  - "pool size"
  - "pgbouncer"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: postgres
    url: https://github.com/porsager/postgres
    license: Unlicense
---
# Connection Pooling

## Why Connection Pooling?
- Database connections are expensive to create (TCP handshake, auth, memory allocation)
- Reusing connections reduces latency and server resource consumption
- Controls maximum concurrent connections to prevent database overload

## Application-Level Pooling
Most database drivers include built-in pooling:

```typescript
// postgres.js — built-in pool
import postgres from 'postgres';
const sql = postgres({
  max: 10,             // max connections in pool
  idle_timeout: 20,    // close idle connections after 20s
  connect_timeout: 10, // timeout for new connection attempts
});

// better-sqlite3 — single connection (SQLite is single-writer)
// No pooling needed; use a single shared instance
```

## Pool Sizing
- **Formula**: connections = (core_count * 2) + effective_spindle_count
- For SSD: roughly `CPU cores * 2` (typical: 10-20)
- Too few: requests queue waiting for connections
- Too many: database context-switching overhead, memory pressure

## External Poolers (PgBouncer)
```ini
[databases]
eyas = host=localhost port=5432 dbname=eyas

[pgbouncer]
pool_mode = transaction     # release connection after each transaction
max_client_conn = 200       # max client connections
default_pool_size = 20      # connections per database
min_pool_size = 5           # keep at least 5 warm
server_idle_timeout = 300   # close unused server connections
```

## Pool Modes (PgBouncer)
- **Session**: connection held for entire client session (most compatible)
- **Transaction**: connection returned after each transaction (recommended)
- **Statement**: connection returned after each statement (limited features)

## Monitoring
- Track pool utilization (active/idle/waiting connections)
- Alert on connection wait times exceeding threshold
- Monitor for connection leaks (connections never returned to pool)

## Best Practices
- Always return connections to the pool (use try/finally or connection managers)
- Set connection timeouts to avoid hanging on unreachable databases
- Use health checks to remove broken connections from the pool
- Close pools gracefully on application shutdown
- For SQLite: single connection with WAL mode handles most workloads
