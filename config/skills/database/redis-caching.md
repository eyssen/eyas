---
name: redis-caching
description: Redis caching patterns with ioredis
trigger_patterns:
  - "redis"
  - "caching"
  - "cache"
  - "ioredis"
  - "key value store"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: ioredis
    url: https://github.com/redis/ioredis
    license: MIT
---
# Redis Caching

## Connection with ioredis
```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  },
});
```

## Basic Operations
```typescript
// String values
await redis.set('user:123', JSON.stringify(user), 'EX', 3600); // 1h TTL
const cached = await redis.get('user:123');
const user = cached ? JSON.parse(cached) : null;

// Hash (structured data)
await redis.hset('session:abc', { userId: '123', role: 'admin' });
const session = await redis.hgetall('session:abc');

// Delete
await redis.del('user:123');
```

## Caching Patterns

### Cache-Aside (Lazy Loading)
```typescript
async function getUser(id: string): Promise<User> {
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.select().from(users).where(eq(users.id, id));
  await redis.set(`user:${id}`, JSON.stringify(user), 'EX', 3600);
  return user;
}
```

### Write-Through
Write to cache and database simultaneously on every update.

### Cache Invalidation
```typescript
// Invalidate on update
async function updateUser(id: string, data: Partial<User>) {
  await db.update(users).set(data).where(eq(users.id, id));
  await redis.del(`user:${id}`);
}

// Pattern-based invalidation
const keys = await redis.keys('user:123:*');
if (keys.length) await redis.del(...keys);
```

## Data Structures
- **Strings**: simple key-value (counters, serialized objects)
- **Hashes**: field-value pairs (user profiles, sessions)
- **Lists**: ordered collections (queues, recent items)
- **Sets**: unique collections (tags, online users)
- **Sorted Sets**: ranked collections (leaderboards, scheduled jobs)

## Best Practices
- Always set TTL — avoid unbounded cache growth
- Use key namespacing: `module:entity:id`
- Handle cache misses gracefully (fallback to database)
- Use pipelines for batch operations
- Monitor hit/miss ratios to validate caching effectiveness
