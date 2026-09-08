---
name: error-handling
description: Error handling patterns — Result types, custom errors, and error boundaries
trigger_patterns:
  - "error handling"
  - "try catch"
  - "result type"
  - "error boundary"
  - "custom error"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: neverthrow
    url: https://github.com/supermacro/neverthrow
    license: MIT
  - name: ts-results
    url: https://github.com/vultix/ts-results
    license: MIT
---
# Error Handling Patterns

## Result Type (neverthrow)
```typescript
import { ok, err, Result } from 'neverthrow';

function parseConfig(raw: string): Result<Config, ParseError> {
  try {
    return ok(JSON.parse(raw));
  } catch (e) {
    return err(new ParseError('Invalid JSON'));
  }
}

// Chain without try/catch
const result = parseConfig(data)
  .map(config => config.port)
  .mapErr(e => new AppError(e.message));
```

## Custom Error Hierarchy
```typescript
class AppError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
  }
}
class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, 'NOT_FOUND', 404);
  }
}
```

## Error Boundary Pattern (HTTP)
```typescript
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.code, message: err.message }, err.statusCode);
  }
  logger.error({ err }, 'Unhandled error');
  return c.json({ error: 'INTERNAL' }, 500);
});
```

## Guidelines
- Never swallow errors silently — log or propagate
- Use Result types for expected failures (validation, parsing)
- Use exceptions for unexpected failures (I/O, bugs)
- Always include context in error messages
- Avoid `catch (e: any)` — narrow the type
