---
name: browser-automation
description: Browser automation and testing with Playwright
trigger_patterns:
  - "playwright"
  - "browser automation"
  - "e2e test"
  - "headless browser"
  - "browser test"
capabilities:
  - web
version: "1.0.0"
sources:
  - name: Playwright
    url: https://github.com/microsoft/playwright
    license: Apache-2.0
---
# Browser Automation with Playwright

## Basic Navigation
```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('https://example.com');
await page.waitForLoadState('networkidle');

const title = await page.title();
const content = await page.textContent('main');

await browser.close();
```

## Interacting with Elements
```typescript
// Click
await page.click('button#submit');

// Fill form
await page.fill('input[name="email"]', 'test@example.com');
await page.fill('input[name="password"]', 'secret');

// Select dropdown
await page.selectOption('select#country', 'HU');

// Upload file
await page.setInputFiles('input[type="file"]', 'document.pdf');

// Wait for element
await page.waitForSelector('.results', { timeout: 10000 });
```

## Screenshots and PDF
```typescript
// Full page screenshot
await page.screenshot({ path: 'page.png', fullPage: true });

// Element screenshot
await page.locator('.chart').screenshot({ path: 'chart.png' });

// PDF generation
await page.pdf({ path: 'report.pdf', format: 'A4' });
```

## Network Interception
```typescript
await page.route('**/*.{png,jpg,gif}', route => route.abort()); // block images
await page.route('**/api/data', route => {
  route.fulfill({ status: 200, body: JSON.stringify(mockData) });
});
```

## Multiple Browser Contexts
```typescript
// Isolated contexts (separate cookies, storage)
const context1 = await browser.newContext();
const context2 = await browser.newContext();
const page1 = await context1.newPage();
const page2 = await context2.newPage();
```

## Best Practices
- Use `headless: true` in CI, `headless: false` for debugging
- Prefer Locators over raw selectors for auto-waiting and retry
- Set reasonable timeouts (not too short, not infinite)
- Use `page.waitForLoadState()` instead of fixed delays
- Close browser in a finally block to prevent resource leaks
- Use browser contexts for isolation instead of separate browser instances
