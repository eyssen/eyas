---
name: openapi-spec
description: OpenAPI 3.1 specification writing and API-first design
trigger_patterns:
  - "openapi"
  - "swagger"
  - "api spec"
  - "api schema"
  - "api first"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: OpenAPI Initiative
    url: https://github.com/OAI/OpenAPI-Specification
    license: Apache-2.0
---
# OpenAPI 3.1 Specification

## Basic Structure
```yaml
openapi: "3.1.0"
info:
  title: My API
  version: "1.0.0"
paths:
  /api/v1/users:
    get:
      operationId: listUsers
      tags: [users]
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
      responses:
        "200":
          description: User list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserList"
```

## Reusable Components
```yaml
components:
  schemas:
    User:
      type: object
      required: [id, name, email]
      properties:
        id: { type: string, format: uuid }
        name: { type: string, minLength: 1, maxLength: 100 }
        email: { type: string, format: email }
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

## Error Response Schema
```yaml
    Error:
      type: object
      required: [error, message]
      properties:
        error: { type: string }
        message: { type: string }
        details: { type: array, items: { type: object } }
```

## API-First Workflow
1. Design the OpenAPI spec before writing code
2. Generate types from spec (`openapi-typescript`)
3. Implement handlers matching the spec
4. Validate requests/responses against spec in tests
5. Generate client SDKs from spec for consumers

## Best Practices
- Use `operationId` on every endpoint — it becomes the function name in generated clients
- Group endpoints with `tags`
- Define all error responses (400, 401, 403, 404, 500)
- Use `$ref` aggressively to avoid schema duplication
- Add `examples` for documentation clarity
