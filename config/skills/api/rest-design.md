---
name: rest-design
description: RESTful API design conventions, resource naming, and HTTP semantics
trigger_patterns:
  - "rest api"
  - "rest design"
  - "resource naming"
  - "http methods"
  - "rest conventions"
capabilities:
  - api-access
version: "1.0.0"
---
# REST API Design

## Resource Naming
- Use plural nouns: `/api/v1/users`, `/api/v1/orders`
- Nested resources for ownership: `/api/v1/users/:id/orders`
- Use kebab-case: `/api/v1/project-types`
- Never use verbs in URLs — the HTTP method IS the verb

## HTTP Methods
| Method | Purpose | Idempotent | Response |
|--------|---------|------------|----------|
| GET | Read resource(s) | Yes | 200 |
| POST | Create resource | No | 201 + Location header |
| PUT | Full replace | Yes | 200 |
| PATCH | Partial update | Yes | 200 |
| DELETE | Remove resource | Yes | 204 |

## Status Codes
- `200` OK — successful read/update
- `201` Created — successful creation
- `204` No Content — successful delete
- `400` Bad Request — validation error
- `401` Unauthorized — missing/invalid auth
- `403` Forbidden — authenticated but not allowed
- `404` Not Found — resource does not exist
- `409` Conflict — duplicate or state conflict
- `422` Unprocessable Entity — semantic validation failure
- `429` Too Many Requests — rate limited
- `500` Internal Server Error — server bug

## Response Envelope
```json
{ "data": { "id": "123", "name": "Alice" }, "meta": { "requestId": "abc" } }
```
For collections:
```json
{ "data": [...], "meta": { "total": 142, "limit": 20, "offset": 0 } }
```

## Guidelines
- Always return consistent response shapes
- Include `requestId` for tracing
- Use `ETag` / `If-None-Match` for caching
- Support `fields` query param for sparse responses
