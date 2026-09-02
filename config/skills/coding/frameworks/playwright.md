---
name: playwright
description: Playwright E2E testing — selectors, page objects, and CI integration
trigger_patterns:
  - "playwright"
  - "e2e test"
  - "browser test"
  - "page object"
  - "end to end"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Playwright
    url: https://github.com/microsoft/playwright
    license: Apache-2.0
---
# Playwright E2E Testing

## Basic Test
```typescript
import { test, expect } from '@playwright/test';

test('user can log in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('alice@example.com');
  await page.getByLabel('Password').fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Welcome, Alice')).toBeVisible();
});
```

## Page Object Pattern
```typescript
class LoginPage {
  constructor(private page: Page) {}
  async login(email: string, password: string) {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
}

test('login flow', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await page.goto('/login');
  await loginPage.login('alice@example.com', 'secret');
  await expect(page).toHaveURL('/dashboard');
});
```

## Selectors — Priority Order
1. `getByRole` — accessible role + name (best)
2. `getByLabel` — form inputs by label
3. `getByText` — visible text content
4. `getByTestId` — `data-testid` attribute (fallback)
Avoid: CSS selectors, XPath — brittle and hard to maintain.

## Waiting and Assertions
```typescript
await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 });
await expect(page.getByRole('table')).toContainText('Order #123');
await page.waitForResponse(resp => resp.url().includes('/api/orders'));
```

## Configuration
```typescript
// playwright.config.ts
export default defineConfig({
  use: { baseURL: 'http://localhost:3000', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { command: 'bun run serve', port: 3000, reuseExistingServer: true },
});
```

## Tips
- Run with `--ui` for interactive debugging
- Use `test.describe.serial()` for ordered flows
- Never use hardcoded `waitForTimeout` — use auto-waiting
