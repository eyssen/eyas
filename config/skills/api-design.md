---
name: api-design
description: REST/GraphQL API design and OpenAPI specification
trigger_patterns: ["api design", "REST", "GraphQL", "OpenAPI", "endpoint"]
capabilities: [api-access]
version: "1.0.0"
---
# API Design Guide

## REST Conventions
- Use nouns for resources: `/api/v1/users`
- HTTP methods: GET (read), POST (create), PATCH (update), DELETE (remove)
- Status codes: 200 OK, 201 Created, 400 Bad Request, 404 Not Found, 500 Server Error
- Pagination: `?limit=20&offset=0`
