---
name: accessibility
description: Web accessibility (a11y) guidelines and ARIA patterns
trigger_patterns:
  - "accessibility"
  - "a11y"
  - "aria"
  - "screen reader"
  - "wcag"
capabilities:
  - web
version: "1.0.0"
---
# Web Accessibility

## Core Principles (WCAG POUR)
1. **Perceivable**: content must be presentable in ways users can perceive
2. **Operable**: interface must be usable via keyboard, mouse, and assistive tech
3. **Understandable**: content and operation must be comprehensible
4. **Robust**: content must work with current and future assistive technologies

## Semantic HTML
```html
<!-- Good: semantic elements -->
<nav aria-label="Main navigation">
  <ul><li><a href="/">Home</a></li></ul>
</nav>
<main>
  <article>
    <h1>Page Title</h1>
    <p>Content...</p>
  </article>
</main>

<!-- Bad: div soup -->
<div class="nav"><div class="link" onclick="...">Home</div></div>
```

## Keyboard Navigation
- All interactive elements must be focusable and operable via keyboard
- Visible focus indicators (never `outline: none` without replacement)
- Logical tab order (follows visual layout)
- Skip-to-content link for keyboard users
- Trap focus in modals and dialogs

## ARIA Patterns
```html
<!-- Button with state -->
<button aria-expanded="false" aria-controls="menu">Menu</button>
<ul id="menu" role="menu" hidden>...</ul>

<!-- Live region for dynamic content -->
<div aria-live="polite" aria-atomic="true">
  3 new notifications
</div>

<!-- Dialog -->
<dialog role="dialog" aria-labelledby="dialog-title" aria-modal="true">
  <h2 id="dialog-title">Confirm Action</h2>
</dialog>
```

## Color and Contrast
- Minimum contrast ratio: 4.5:1 for normal text, 3:1 for large text
- Never use color alone to convey information
- Support dark mode and high-contrast mode
- Test with color blindness simulators

## Images and Media
- `alt` text for informative images; empty `alt=""` for decorative
- Captions and transcripts for video/audio content
- `aria-label` or `aria-labelledby` for icon-only buttons

## Testing
- Tab through the entire page — is everything reachable?
- Use browser DevTools accessibility inspector
- Test with screen reader (VoiceOver on macOS, NVDA on Windows)
- Automated checks: axe-core, Lighthouse accessibility audit
- WCAG 2.1 AA is the standard target for most applications
