---
name: orm-patterns
description: ORM patterns and Drizzle ORM usage
trigger_patterns:
  - "orm"
  - "drizzle"
  - "drizzle orm"
  - "database orm"
  - "type safe queries"
capabilities:
  - database
version: "1.0.0"
sources:
  - name: Drizzle ORM
    url: https://github.com/drizzle-team/drizzle-orm
    license: Apache-2.0
---
# ORM Patterns with Drizzle

## Schema Definition
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role', { enum: ['admin', 'user', 'guest'] }).notNull().default('user'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id),
  status: text('status').notNull().default('draft'),
  total: integer('total').notNull(), // cents
});
```

## Query Builder
```typescript
import { eq, and, gt, like, desc, sql } from 'drizzle-orm';

// Select with filter
const activeUsers = await db.select()
  .from(users)
  .where(eq(users.role, 'admin'));

// Join
const ordersWithUser = await db.select({
  orderId: orders.id,
  userName: users.name,
  total: orders.total,
})
  .from(orders)
  .innerJoin(users, eq(orders.userId, users.id))
  .where(gt(orders.total, 1000))
  .orderBy(desc(orders.total));

// Insert
const [newUser] = await db.insert(users)
  .values({ id: crypto.randomUUID(), name: 'Alice', email: 'alice@example.com' })
  .returning();

// Update
await db.update(users)
  .set({ role: 'admin' })
  .where(eq(users.id, userId));

// Delete
await db.delete(orders).where(eq(orders.id, orderId));
```

## Relations
```typescript
import { relations } from 'drizzle-orm';

export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
}));
```

## Transaction Pattern
```typescript
await db.transaction(async (tx) => {
  const [order] = await tx.insert(orders).values({ userId, total }).returning();
  await tx.insert(orderItems).values(items.map(i => ({ ...i, orderId: order.id })));
});
```

## Best Practices
- Define schema in TypeScript — single source of truth for types and migrations
- Use `.$inferSelect` and `.$inferInsert` for type inference
- Prefer query builder over raw SQL for type safety
- Use transactions for multi-table writes
- Keep Drizzle schema close to the module that owns the data
