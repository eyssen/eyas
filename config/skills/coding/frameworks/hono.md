---
name: hono
description: Hono web framework — routes, middleware, and Bun integration
trigger_patterns:
  - "hono"
  - "hono route"
  - "hono middleware"
  - "web framework"
  - "http server bun"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Hono
    url: https://github.com/honojs/hono
    license: MIT
---
# Hono Framework Guide

## Basic Route Setup
```typescript
import { Hono } from 'hono';

const app = new Hono();

app.get('/api/v1/users', async (c) => {
  const users = await userService.list();
  return c.json(users);
});

app.post('/api/v1/users', async (c) => {
  const body = await c.req.json();
  const user = await userService.create(body);
  return c.json(user, 201);
});
```

## Middleware
```typescript
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

app.use('*', logger());
app.use('/api/*', cors({ origin: 'https://app.example.com' }));

// Custom middleware
const auth = (): MiddlewareHandler => async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', await verifyToken(token));
  await next();
};
```

## Route Groups
```typescript
const api = new Hono();
api.use('*', auth());
api.get('/tasks', listTasks);
api.post('/tasks', createTask);
app.route('/api/v1', api);
```

## Error Handling
```typescript
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: err.message }, err.statusCode);
  return c.json({ error: 'Internal Server Error' }, 500);
});
app.notFound((c) => c.json({ error: 'Not Found' }, 404));
```

## Bun Integration
```typescript
export default { port: 3000, fetch: app.fetch };
```

## Typed Routes with Zod
```typescript
import { zValidator } from '@hono/zod-validator';
app.post('/users', zValidator('json', createUserSchema), async (c) => {
  const data = c.req.valid('json');  // fully typed
  return c.json(await create(data), 201);
});
```
