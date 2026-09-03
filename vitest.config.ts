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
    // Registers `.toBeInTheDocument()`, `.toHaveTextContent()` etc. for the
    // jsdom component tests (scheduler-page.test.tsx and friends). Safe to
    // load for every test file, including plain-node ones — it only extends
    // `expect`, it does not touch the DOM itself.
    setupFiles: ['@testing-library/jest-dom/vitest'],
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
    server: {
      deps: {
        // By default Vitest "externalizes" plain node_modules packages —
        // loading them with Node's own resolver instead of Vite's, which
        // skips the `resolve.alias`/`dedupe` below entirely. That's invisible
        // for packages with no React of their own, but react-grid-layout
        // (installed only under src/web/node_modules, see the 'react' alias
        // comment) calls React hooks internally; externalized, its own
        // `import { useState } from 'react'` resolves via Node's algorithm
        // straight to src/web's nested copy, landing on the exact
        // two-React-instances failure ("resolveDispatcher().useState is
        // null") the alias/dedupe pair exists to prevent. Inlining forces it
        // through Vite's resolver instead, where the alias applies.
        //
        // '@tanstack/react-router' and 'zustand' are the same shape
        // (installed only under src/web/node_modules): a widget component
        // calling `useNavigate()` — which itself reads a zustand-backed auth
        // store inside `useWebSocket()` — fails the same way
        // ("resolveDispatcher().useX is null") for each in turn unless both
        // are forced through the alias too.
        //
        // 'radix-ui' (the umbrella package components/ui/tooltip.tsx imports,
        // plus the '@radix-ui/*' packages it re-exports) is the same shape
        // again, and it is what makes home-page.test.tsx runnable at all:
        // HomePage renders <ContextualHelp>, which mounts Radix's
        // TooltipProvider. Radix is installed only under src/web/node_modules,
        // so externalized it resolves its own `import { useRef } from 'react'`
        // to the nested copy and every render dies with "null is not an object
        // (evaluating 'resolveDispatcher().useRef')" — all nine of
        // home-page.test.tsx's cases, before a line of it is even reached.
        inline: [/react-grid-layout/, /react-resizable/, /react-draggable/, /@tanstack\/react-router/, /zustand/, /radix-ui/],
      },
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
      // Same shadowing problem as 'sonner' above, hit for the first time by
      // Task 14's home-page.test.tsx: '@tanstack/react-router' also exists
      // only under src/web/node_modules (no root copy), and a root-level test
      // file's `vi.mock('@tanstack/react-router', ...)` resolves the bare
      // specifier from the ROOT — which fails to find it at all — while
      // src/web/src component files resolve it directory-relatively to the
      // nested copy. Without this alias the mock registers under a different
      // module id than the real import, so it never intercepts and `<Link>`
      // still throws ("router.isServer" on a null router) outside a real
      // RouterProvider. Pin both resolutions to the one copy that exists.
      '@tanstack/react-router': resolve(__dirname, 'src/web/node_modules/@tanstack/react-router'),
      // src/web has its OWN nested node_modules/zod (3.25.76, a zod-4-shaped
      // dual ESM/CJS package) even though the root copy (3.24.4, used
      // throughout src/core and src/modules) is pinned in the root
      // package.json. widget-registry.ts (src/web/src/pages/home) is the
      // first src/web file to import 'zod' — Node/Vite's nearest-node_modules
      // resolution picks the nested copy first, and loading THAT copy through
      // Vite's ESM pipeline yields an `import { z } from 'zod'` whose `z`
      // binding is `undefined` at runtime (TypeError: "undefined is not an
      // object (evaluating 'z.object')") even though requiring the same
      // package directly under Node/Bun exports `z` correctly — a load-path
      // interop quirk, not a genuinely broken package. Pin to the root copy,
      // the same fix already applied to 'react'/'react-dom' above for the
      // identical nested-vs-root shadowing problem.
      zod: resolve(__dirname, 'node_modules/zod'),
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
