---
name: api-versioning
description: API versioning strategies — URL, header, and content negotiation
trigger_patterns:
  - "api version"
  - "versioning"
  - "breaking change"
  - "backward compatible"
  - "api evolution"
capabilities:
  - api-access
version: "1.0.0"
---
# API Versioning

## Strategies
| Strategy | Example | Pros | Cons |
|----------|---------|------|------|
| URL path | `/api/v1/users` | Simple, visible, cacheable | URL changes on version bump |
| Header | `Accept: application/vnd.api.v2+json` | Clean URLs | Hidden, harder to test |
| Query param | `/users?version=2` | Easy to switch | Pollutes query string |

**Recommended:** URL path versioning — simplest to implement, debug, and document.

## What Is a Breaking Change
- Removing a field from response
- Renaming a field
- Changing field type (string -> number)
- Removing an endpoint
- Changing authentication mechanism
- Making an optional parameter required

## Non-Breaking Changes (Safe)
- Adding a new optional field to response
- Adding a new endpoint
- Adding a new optional query parameter
- Adding a new enum value (if client handles unknown values)

## Migration Strategy
1. Announce deprecation with timeline (minimum 3 months)
2. Add `Deprecation` and `Sunset` headers to old version
3. Log usage of deprecated endpoints to track migration
4. Provide migration guide with concrete examples
5. Remove old version only after traffic drops to zero

## Best Practices
- Support at most 2 major versions simultaneously
- Use `Sunset` header: `Sunset: Sat, 01 Mar 2025 00:00:00 GMT`
- Version the API, not individual endpoints
- Default to latest stable version for unversioned requests
- Document all changes in a public changelog
