---
name: responsive-design
description: Responsive web design patterns with CSS Grid, Flexbox, and media queries
trigger_patterns:
  - "responsive"
  - "responsive design"
  - "media query"
  - "mobile first"
  - "breakpoint"
capabilities:
  - web
version: "1.0.0"
---
# Responsive Design

## Mobile-First Approach
Start with styles for the smallest screen, add complexity for larger ones.

```css
/* Mobile (default) */
.container { padding: 1rem; }

/* Tablet */
@media (min-width: 768px) {
  .container { padding: 2rem; max-width: 720px; margin: 0 auto; }
}

/* Desktop */
@media (min-width: 1024px) {
  .container { max-width: 960px; }
}
```

## CSS Grid Layout
```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}
```

## Flexbox Patterns
```css
/* Responsive navigation */
.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* Card row that stacks on mobile */
.cards {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
@media (min-width: 768px) {
  .cards { flex-direction: row; }
}
```

## Tailwind CSS Breakpoints
```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <div class="p-4">Card</div>
</div>
```
Default breakpoints: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px)

## Typography
```css
/* Fluid typography */
html {
  font-size: clamp(14px, 1vw + 10px, 18px);
}
```

## Images
```html
<img
  src="image-800.jpg"
  srcset="image-400.jpg 400w, image-800.jpg 800w, image-1200.jpg 1200w"
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="Description"
  loading="lazy"
/>
```

## Container Queries
```css
.card-container { container-type: inline-size; }

@container (min-width: 400px) {
  .card { flex-direction: row; }
}
```

## Best Practices
- Design for touch targets: minimum 44x44px on mobile
- Test on real devices, not just browser resize
- Use relative units (rem, em, %) over fixed pixels
- Avoid horizontal scrolling on any viewport size
- Lazy load off-screen images and heavy content
