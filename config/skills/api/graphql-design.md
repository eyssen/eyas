---
name: graphql-design
description: GraphQL schema design, resolvers, and best practices
trigger_patterns:
  - "graphql"
  - "graphql schema"
  - "resolver"
  - "mutation"
  - "graphql query"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: GraphQL
    url: https://github.com/graphql/graphql-spec
    license: MIT
---
# GraphQL Design Guide

## Schema Design
```graphql
type User {
  id: ID!
  name: String!
  email: String!
  posts(first: Int = 10, after: String): PostConnection!
}

type PostConnection {
  edges: [PostEdge!]!
  pageInfo: PageInfo!
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
}
```

## Input Types
```graphql
input CreateUserInput {
  name: String!
  email: String!
  role: UserRole = USER
}
```

## Resolver Pattern
```typescript
const resolvers = {
  Query: {
    user: (_, { id }, ctx) => ctx.dataSources.users.findById(id),
  },
  User: {
    posts: (parent, args, ctx) => ctx.dataSources.posts.findByAuthor(parent.id, args),
  },
};
```

## Pagination (Relay Cursor)
Use cursor-based pagination for stable results:
- `first` / `after` for forward pagination
- `last` / `before` for backward pagination
- Return `PageInfo { hasNextPage, endCursor }`

## Best Practices
- Use `ID!` for all entity identifiers
- Input types for mutations — never inline arguments
- Avoid deeply nested queries — set max depth limit
- Use DataLoader to batch and deduplicate N+1 queries
- Errors: use union types (`Result = Success | Error`) over throwing
- Rate limit by query complexity score, not just request count

## Security
- Limit query depth (max 7-10 levels)
- Limit query complexity score
- Disable introspection in production
- Validate and sanitize all input fields
