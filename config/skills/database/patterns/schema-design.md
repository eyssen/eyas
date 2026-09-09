---
name: schema-design
description: Database schema design principles and patterns
trigger_patterns:
  - "schema design"
  - "database design"
  - "table design"
  - "normalization"
  - "data model"
capabilities:
  - database
version: "1.0.0"
---
# Schema Design

## Design Principles
1. **Normalize first, denormalize for performance** — start with 3NF
2. **Every table needs a primary key** — prefer surrogate keys (auto-increment or UUID)
3. **Use appropriate data types** — smallest type that fits the domain
4. **Name consistently** — snake_case, plural table names, singular column names
5. **Document constraints** — NOT NULL, UNIQUE, CHECK, foreign keys

## Common Patterns

### Timestamps
```sql
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

### Soft Delete
```sql
ALTER TABLE items ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_items_active ON items (id) WHERE deleted_at IS NULL;
```

### Polymorphic Association
```sql
-- Junction table approach (preferred)
CREATE TABLE taggables (
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  taggable_type TEXT NOT NULL,   -- 'document', 'conversation'
  taggable_id INTEGER NOT NULL,
  PRIMARY KEY (tag_id, taggable_type, taggable_id)
);
```

### Tree/Hierarchy
```sql
-- Adjacency list (simple, recursive queries)
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL
);

-- Materialized path (fast reads, complex writes)
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,  -- '/1/5/12/'
  name TEXT NOT NULL
);
```

### Enum-like Values
```sql
-- Status as TEXT with CHECK constraint
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'shipped', 'delivered', 'cancelled'))
);
```

## Anti-Patterns to Avoid
- Entity-Attribute-Value (EAV) — use JSONB for flexible schemas
- Storing comma-separated values in a single column
- Using FLOAT for money (use INTEGER cents or NUMERIC)
- Generic "data" JSONB column without any typed columns
- Missing foreign key constraints

## Best Practices
- Add indexes for foreign keys (not auto-created in PostgreSQL)
- Use CHECK constraints for domain validation
- Prefer TEXT over VARCHAR unless you need strict length limits
- Add comments to tables and columns for documentation
- Review schema with EXPLAIN on real-world queries before finalizing
