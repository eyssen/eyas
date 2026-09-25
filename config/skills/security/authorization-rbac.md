---
name: authorization-rbac
description: Role-based access control and attribute-based authorization with CASL
trigger_patterns:
  - "authorization"
  - "rbac"
  - "casl"
  - "permissions"
  - "access control"
  - "role based"
capabilities:
  - security
version: "1.0.0"
sources:
  - name: CASL
    url: https://github.com/stalniy/casl
    license: MIT
---
# Authorization — RBAC with CASL

## Define Abilities
```typescript
import { AbilityBuilder, PureAbility } from '@casl/ability';

type Actions = 'create' | 'read' | 'update' | 'delete' | 'manage';
type Subjects = 'Task' | 'User' | 'Project' | 'all';

function defineAbilitiesFor(user: { role: string; id: string }) {
  const { can, cannot, build } = new AbilityBuilder<PureAbility<[Actions, Subjects]>>(PureAbility);

  if (user.role === 'admin') {
    can('manage', 'all');
  } else if (user.role === 'user') {
    can('read', 'Project');
    can('create', 'Task');
    can(['read', 'update', 'delete'], 'Task', { ownerId: user.id });
    cannot('delete', 'Project');
  } else {
    can('read', 'Project');
  }
  return build();
}
```

## Check Permissions
```typescript
const ability = defineAbilitiesFor(currentUser);

if (ability.can('update', 'Task')) {
  // allowed
}

// With subject instance
if (ability.can('delete', subject('Task', task))) {
  // checks conditions like { ownerId: user.id }
}
```

## Middleware
```typescript
function authorize(action: Actions, resourceType: Subjects) {
  return async (c: Context, next: Next) => {
    const ability = c.get('ability');
    if (ability.cannot(action, resourceType)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}

app.delete('/tasks/:id', authorize('delete', 'Task'), deleteTaskHandler);
```

## RBAC Design Principles
- Define roles with minimal required permissions
- Check permissions at the API layer AND data layer
- Use attribute-based conditions for row-level security
- Audit permission changes — who granted what, when
- Test authorization as thoroughly as business logic

## Common Roles Pattern
- **admin** — full access, user management
- **member** — CRUD own resources, read shared
- **viewer** — read-only access
- **guest** — minimal public access
