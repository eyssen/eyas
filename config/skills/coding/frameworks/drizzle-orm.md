---
name: drizzle-orm
description: Drizzle ORM schema definition, queries, migrations, and type-safe operations
trigger_patterns:
  - "drizzle"
  - "orm"
  - "database schema"
  - "drizzle query"
  - "migration"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Drizzle ORM
    url: https://github.com/drizzle-team/drizzle-orm
    license: Apache-2.0
---
# Drizzle ORM Guide

## Schema Definition (SQLite)
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role', { enum: ['admin', 'user'] }).default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

## Relations
```typescript
import { relations } from 'drizzle-orm';

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}));
```

## Queries
```typescript
// Select with filter
const activeUsers = await db.select().from(users).where(eq(users.role, 'admin'));

// Relational query
const usersWithPosts = await db.query.users.findMany({
  with: { posts: { limit: 5 } },
  where: eq(users.role, 'admin'),
});

// Insert
await db.insert(users).values({ id: newId(), name, email, createdAt: new Date() });

// Update
await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));

// Transaction
await db.transaction(async (tx) => {
  await tx.insert(orders).values(order);
  await tx.update(inventory).set({ qty: sql`qty - 1` }).where(eq(inventory.id, itemId));
});
```

## Migrations
```bash
bunx drizzle-kit generate   # generate migration SQL
bunx drizzle-kit migrate    # apply migrations
bunx drizzle-kit studio     # visual browser
```

## Best Practices
- Define schema in a single `schema/` directory, export all tables
- Use `$inferSelect` and `$inferInsert` for TypeScript types
- Prefer `db.query` (relational) over raw joins for readability
- Always use transactions for multi-table writes
