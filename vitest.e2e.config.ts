import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// E2E config: runs ONLY the live-server integration tests under tests/e2e.
// These require a running EYAS server (set EYAS_TEST_URL, default
// http://localhost:3100). Invoke via `bun run test:e2e`.
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
    conditions: ['import', 'module', 'default'],
  },
})
