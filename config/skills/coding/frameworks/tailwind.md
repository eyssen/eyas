---
name: tailwind
description: Tailwind CSS utility classes, responsive design, and component patterns
trigger_patterns:
  - "tailwind"
  - "utility classes"
  - "responsive design"
  - "css classes"
  - "tailwind config"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Tailwind CSS
    url: https://github.com/tailwindlabs/tailwindcss
    license: MIT
---
# Tailwind CSS Guide

## Layout Essentials
```html
<!-- Flex row with gap -->
<div class="flex items-center gap-4">
  <span class="flex-shrink-0">Icon</span>
  <span class="flex-1 truncate">Long text content</span>
</div>

<!-- Grid responsive -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- cards -->
</div>
```

## Responsive Breakpoints
- `sm:` (640px), `md:` (768px), `lg:` (1024px), `xl:` (1280px), `2xl:` (1536px)
- Mobile-first: base styles apply to all, breakpoints override upward

## Dark Mode
```html
<div class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
  <p class="text-gray-600 dark:text-gray-400">Subtitle</p>
</div>
```

## Common Component Patterns
```html
<!-- Card -->
<div class="rounded-lg border bg-card p-6 shadow-sm">
  <h3 class="text-lg font-semibold">Title</h3>
  <p class="mt-2 text-sm text-muted-foreground">Description</p>
</div>

<!-- Button -->
<button class="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
  Click me
</button>
```

## Best Practices
- Use CSS variables for theming (`--primary`, `--background`)
- Group related utilities: layout, spacing, typography, colors
- Extract repeated patterns into components, not `@apply`
- Use `cn()` (clsx + tailwind-merge) for conditional classes
- Avoid arbitrary values `[13px]` — extend the theme instead
- Keep class lists readable — line break after 5-6 utilities
