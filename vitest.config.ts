import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    // .tsx is included so React components can be tested directly. Until
    // 2026-08-25 every web test was a pure-logic .ts file (the project's pattern
    // is to extract logic out of components and test that); component tests
    // cover what extraction cannot — that a control is actually disabled, that
    // an error actually renders. Those files opt into a DOM with the
    // `// @vitest-environment jsdom` docblock; the default here stays 'node'.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
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
  // The web app's own vite config gets this from @vitejs/plugin-react; the root
  // config has no plugins, so JSX would fall back to the classic runtime and
  // every component test would die on "React is not defined".
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // Mirrors src/web/vite.config.ts's '@' alias so root-level tests can import
      // web source files (e.g. theme-store.ts) that use the '@/...' path alias.
      '@': resolve(__dirname, 'src/web/src'),
      '@core': resolve(__dirname, 'src/core'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@eyas-docs': resolve(__dirname, 'packages/docs'),
      // src/web has its OWN nested node_modules/react (a separate install, not a
      // symlink into the root copy), even though both pin 19.2.4. Without this,
      // a component under src/web resolves 'react' from its nested copy while
      // @testing-library/react (root devDependency) resolves the root copy, so
      // the test graph ends up with two distinct React instances and every hook
      // call throws "Invalid hook call" / "resolveDispatcher().useState" is
      // null. Force both to the single root copy that @testing-library/react
      // uses.
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      // 'sonner' is only a src/web dependency (no root copy exists at all). A
      // test file's `vi.mock('sonner', ...)` resolves the bare specifier from
      // the ROOT, and without this alias that resolves to nothing / a
      // different id than src/web/src's own `import { toast } from 'sonner'`
      // resolves to — so the mock silently never intercepts the real import,
      // and toast calls vanish instead of hitting the test's spy. Pin both
      // resolutions to the one copy that exists.
      sonner: resolve(__dirname, 'src/web/node_modules/sonner'),
    },
    conditions: ['import', 'module', 'default'],
    // The plain alias above only catches direct `import ... from 'react'` in
    // source under test; a dependency's own bare import of 'react' (e.g.
    // zustand, resolved from src/web's nested node_modules) is resolved
    // relative to ITS OWN location by Vite's normal algorithm and can still
    // land on the nested copy. `dedupe` forces every resolution of these
    // packages — direct or transitive — to the single copy under the project
    // root, which is what @testing-library/react also uses.
    dedupe: ['react', 'react-dom'],
  },
})
