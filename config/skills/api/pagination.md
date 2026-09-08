---
name: pagination
description: API pagination patterns — offset, cursor, and keyset pagination
trigger_patterns:
  - "pagination"
  - "offset pagination"
  - "cursor pagination"
  - "page size"
  - "next page"
capabilities:
  - api-access
version: "1.0.0"
---
# API Pagination

## Offset Pagination
```
GET /api/v1/users?limit=20&offset=40
```
```json
{
  "data": [...],
  "meta": { "total": 142, "limit": 20, "offset": 40 }
}
```
- Simple to implement
- Supports "jump to page N"
- Degrades on large offsets (DB scans skipped rows)
- Inconsistent if data changes between pages

## Cursor Pagination (Recommended)
```
GET /api/v1/users?limit=20&after=eyJpZCI6MTAwfQ==
```
```json
{
  "data": [...],
  "meta": {
    "hasNext": true,
    "nextCursor": "eyJpZCI6MTIwfQ==",
    "hasPrev": true,
    "prevCursor": "eyJpZCI6MTAxfQ=="
  }
}
```
- Stable results even with inserts/deletes
- Efficient — uses indexed column (usually `id` or `created_at`)
- Cannot jump to arbitrary page

## Keyset Pagination (SQL)
```sql
SELECT * FROM users
WHERE (created_at, id) > ('2025-01-15', 'abc-123')
ORDER BY created_at, id
LIMIT 21;  -- fetch limit+1 to detect hasNext
```

## Best Practices
- Default `limit` to 20, max to 100
- Always return `hasNext` / `hasPrev` indicators
- Encode cursor as opaque base64 — clients should not parse it
- Include total count only if cheap (or make it optional via `?include=count`)
- For real-time feeds, always use cursor-based pagination
- Return empty `data: []` with `hasNext: false` for last page
