---
name: postgres-json
description: PostgreSQL JSONB storage, querying, and indexing patterns
trigger_patterns:
  - "postgres json"
  - "jsonb"
  - "json query"
  - "postgres document"
  - "json index"
capabilities:
  - database
version: "1.0.0"
---
# PostgreSQL JSONB

## JSONB vs JSON
- `JSONB`: binary storage, indexable, no duplicate keys, slightly slower insert
- `JSON`: text storage, preserves formatting and key order, no indexing
- Always use `JSONB` unless you need exact text preservation

## Storing JSONB
```sql
CREATE TABLE events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO events (type, metadata) VALUES (
  'user.login',
  '{"ip": "1.2.3.4", "browser": "Chrome", "country": "HU"}'
);
```

## Querying JSONB
```sql
-- Access nested value (returns JSONB)
SELECT metadata->'browser' FROM events;

-- Access as text
SELECT metadata->>'browser' FROM events;

-- Nested path
SELECT metadata #>> '{address,city}' FROM events;

-- Containment (uses GIN index)
SELECT * FROM events WHERE metadata @> '{"country": "HU"}';

-- Key existence
SELECT * FROM events WHERE metadata ? 'ip';

-- JSON path (PostgreSQL 12+)
SELECT * FROM events
WHERE jsonb_path_exists(metadata, '$.score ? (@ > 90)');
```

## Indexing JSONB
```sql
-- GIN index for containment queries (@>, ?, ?|, ?&)
CREATE INDEX idx_events_metadata ON events USING GIN (metadata);

-- Targeted GIN for specific path (smaller, faster)
CREATE INDEX idx_events_metadata_ops ON events USING GIN (metadata jsonb_path_ops);

-- B-tree on extracted value
CREATE INDEX idx_events_country ON events ((metadata->>'country'));
```

## JSONB Functions
```sql
-- Merge objects
SELECT '{"a":1}'::jsonb || '{"b":2}'::jsonb;  -- {"a":1,"b":2}

-- Remove key
SELECT metadata - 'browser' FROM events;

-- Set nested value
SELECT jsonb_set(metadata, '{country}', '"DE"') FROM events;

-- Expand to rows
SELECT * FROM jsonb_each_text('{"a":"1","b":"2"}'::jsonb);

-- Aggregate rows to JSONB array
SELECT jsonb_agg(row_to_json(t)) FROM (SELECT id, type FROM events) t;
```

## Best Practices
- Use JSONB for flexible/schema-less data, not as a replacement for proper columns
- Index specific paths you query frequently
- Validate JSONB structure at the application level (Zod)
- Avoid deeply nested structures — flatten for better queryability
- Use generated columns for frequently accessed JSONB values
