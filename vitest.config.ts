import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // E2E tests require a live EYAS server on localhost:3000, so they are NOT
    // part of the default run (which must be green offline / in CI). Run them
    // explicitly with `bun run test:e2e` (vitest.e2e.config.ts) against a
    // started server.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/modules/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/web/**'],
    },
  },
  resolve: {
    alias: {
      // Mirrors src/web/vite.config.ts's '@' alias so root-level tests can import
      // web source files (e.g. theme-store.ts) that use the '@/...' path alias.
      '@': resolve(__dirname, 'src/web/src'),
      '@core': resolve(__dirname, 'src/core'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@eyas-docs': resolve(__dirname, 'packages/docs'),
    },
    conditions: ['import', 'module', 'default'],
  },
})
