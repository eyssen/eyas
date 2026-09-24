---
name: migration-strategies
description: Database schema migration strategies with Drizzle ORM
trigger_patterns:
  - "database migration"
  - "schema migration"
  - "drizzle migrate"
  - "drizzle kit"
  - "alter table"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: Drizzle ORM
    url: https://github.com/drizzle-team/drizzle-orm
    license: Apache-2.0
---
# Database Migration Strategies

## Drizzle Kit Migrations
```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: './data/app.db' },
});
```

```bash
# Generate migration from schema changes
drizzle-kit generate

# Apply pending migrations
drizzle-kit migrate

# Push schema directly (development only)
drizzle-kit push
```

## Migration File Structure
```
drizzle/
  0000_initial.sql
  0001_add_users_email_index.sql
  0002_create_orders_table.sql
  meta/
    _journal.json    # tracks applied migrations
```

## Safe Migration Patterns

### Adding a column
```sql
ALTER TABLE users ADD COLUMN phone TEXT;  -- nullable, no default needed
```

### Adding a NOT NULL column
```sql
-- Step 1: add nullable
ALTER TABLE users ADD COLUMN role TEXT;
-- Step 2: backfill
UPDATE users SET role = 'user' WHERE role IS NULL;
-- Step 3: add constraint (separate migration after backfill)
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
```

### Renaming a column (zero-downtime)
1. Add new column
2. Backfill data from old to new
3. Deploy code that reads from new, writes to both
4. Drop old column in a later migration

### Adding an index
```sql
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);  -- PostgreSQL
CREATE INDEX idx_users_email ON users (email);                -- SQLite
```

## Best Practices
- One concern per migration file
- Migrations must be idempotent where possible
- Always test migrations on a copy of production data
- Keep migrations backward-compatible (old code must still work)
- Never modify an already-applied migration — create a new one
- Back up before applying migrations in production
