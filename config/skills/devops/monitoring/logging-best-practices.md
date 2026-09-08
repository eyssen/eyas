---
name: logging-best-practices
description: Structured logging patterns with pino
trigger_patterns:
  - "logging"
  - "pino"
  - "structured log"
  - "log format"
  - "log level"
capabilities:
  - devops
version: "1.0.0"
sources:
  - name: pino
    url: https://github.com/pinojs/pino
    license: MIT
---
# Logging Best Practices

## Pino Setup
```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) { return { level: label }; },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: ['password', 'token', 'authorization', '*.secret'],
});
```

## Structured Logging
```typescript
// Good: structured context
logger.info({ userId: '123', action: 'login', ip: '1.2.3.4' }, 'User logged in');

// Bad: string interpolation
logger.info(`User 123 logged in from 1.2.3.4`);
```

## Child Loggers
```typescript
// Add context that applies to all logs in a request
const reqLogger = logger.child({
  requestId: crypto.randomUUID(),
  method: req.method,
  path: req.path,
});

reqLogger.info('Request started');
// All subsequent logs include requestId, method, path
```

## Log Levels
- **fatal**: application cannot continue
- **error**: operation failed, needs attention
- **warn**: unexpected but handled situation
- **info**: significant business events (startup, shutdown, key operations)
- **debug**: detailed diagnostic information
- **trace**: very detailed, verbose (function entry/exit)

## What to Log
- Request/response metadata (method, path, status, duration)
- Business events (order created, payment processed)
- Authentication events (login, logout, failed attempts)
- Error details with stack traces and context
- External service calls (target, duration, status)

## What NOT to Log
- Passwords, tokens, API keys, secrets
- Full request/response bodies (unless debug level)
- Personal data (GDPR) — use redaction
- High-frequency data that provides no diagnostic value

## Performance
- Pino is the fastest Node.js logger (JSON serialization optimized)
- Use `pino-pretty` only in development, never in production
- Async logging with `pino.destination()` for high-throughput
- Set appropriate log level in production (info or warn)
