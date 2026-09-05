---
name: typescript
description: TypeScript 5.9+ strict mode, ESM, generics, and utility types
trigger_patterns:
  - "typescript"
  - "ts strict"
  - "generics"
  - "utility types"
  - "type inference"
  - "esm modules"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: TypeScript
    url: https://github.com/microsoft/TypeScript
    license: Apache-2.0
---
# TypeScript 5.9+ Best Practices

## Strict Mode Essentials
Always enable all strict checks in `tsconfig.json`:
```json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true } }
```

## ESM Module Pattern
Use explicit `.js` extensions in imports for Node/Bun compatibility:
```typescript
import { MyService } from './services/my-service.js';
export type { Config } from './types.js';
```

## Generics — Constrained and Descriptive
```typescript
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

## Utility Types Cheat Sheet
- `Partial<T>` — all props optional
- `Required<T>` — all props required
- `Pick<T, K>` / `Omit<T, K>` — select or exclude keys
- `Record<K, V>` — typed key-value map
- `Readonly<T>` — immutable shallow copy
- `Awaited<T>` — unwrap Promise types (5.0+)
- `NoInfer<T>` — prevent inference widening (5.4+)

## Discriminated Unions
```typescript
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };
```

## Satisfies Operator (4.9+)
```typescript
const config = { port: 3000, host: 'localhost' } satisfies ServerConfig;
```
