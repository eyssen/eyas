---
name: error-responses
description: Standardized API error response format and error handling patterns
trigger_patterns:
  - "error response"
  - "api error"
  - "error format"
  - "problem details"
  - "error code"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: http-errors
    url: https://github.com/jshttp/http-errors
    license: MIT
---
# API Error Responses

## Standard Error Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "name", "message": "Required field missing" }
    ],
    "requestId": "req-abc-123"
  }
}
```

## Error Code Registry
| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Authenticated but not allowed |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Duplicate or state conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Implementation
```typescript
class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown[],
  ) {
    super(message);
  }
}

// Global error handler
app.onError((err, c) => {
  const requestId = c.get('requestId');
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details, requestId } }, err.statusCode);
  }
  logger.error({ err, requestId }, 'Unhandled error');
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId } }, 500);
});
```

## Best Practices
- Never expose stack traces or internal details in production
- Always include `requestId` for support/debugging
- Use machine-readable `code`, human-readable `message`
- Return `details[]` for validation errors — one entry per field
- Log full error server-side, return sanitized error to client
- Document all error codes in your API spec
