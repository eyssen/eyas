---
name: react
description: React 19 hooks, server components, and modern patterns
trigger_patterns:
  - "react"
  - "hooks"
  - "server components"
  - "rsc"
  - "use client"
  - "react 19"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: React
    url: https://github.com/facebook/react
    license: MIT
---
# React 19 Best Practices

## Hooks Rules
- Only call hooks at the top level — never inside conditions or loops
- Custom hooks must start with `use`
- Keep hooks focused — one concern per hook

## Modern State Management
```tsx
// useActionState (React 19)
const [state, submitAction, isPending] = useActionState(
  async (prev, formData) => {
    const result = await saveUser(formData);
    return result.error ?? { success: true };
  },
  { success: false }
);
```

## use() Hook (React 19)
```tsx
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise);  // suspends until resolved
  return <h1>{user.name}</h1>;
}
```

## Custom Hook Pattern
```tsx
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

## Component Guidelines
- Prefer function components — no class components
- Co-locate state with the component that owns it
- Lift state up only when siblings need it
- Use `React.memo` sparingly — profile before optimizing
- Keep components under 100 lines — extract sub-components

## Key Patterns
- Render props for flexible composition
- Compound components for related UI (Tabs, Accordion)
- Context for cross-cutting concerns (theme, auth, i18n)
- Controlled vs uncontrolled: prefer controlled for forms
