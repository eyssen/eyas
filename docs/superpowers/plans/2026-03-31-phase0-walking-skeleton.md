# Phase 0: Walking Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** A working EYAS server that starts, serves a React frontend shell, and responds to health checks — the foundation everything else builds on.

**Architecture:** Bun + Hono HTTP server with Drizzle/SQLite, event bus, YAML config, Pino logger, i18next i18n, and a module loader that discovers modules. Frontend is Vite + React 19 + shadcn/ui with a shell layout and empty UI Registry. No auth, no AI, no modules yet — just the skeleton.

**Tech Stack:** Bun 1.x, TypeScript 5.9+ strict ESM, Hono, Drizzle ORM + bun:sqlite, Zod, Pino, i18next, Vite, React 19, shadcn/ui, Tailwind CSS, Zustand, TanStack Router, Vitest

---

## Tasks

- Task 1: Project Scaffolding (package.json, tsconfig, vitest, bunfig, gitignore)
- Task 2: Core Types (EyasModule, SubmoduleManifest, FrontendManifest, ModuleContext)
- Task 3: Logger (Pino with pretty-print)
- Task 4: Config Loader (YAML + Zod validation + default.yaml)
- Task 5: Database Connection (Drizzle + bun:sqlite, WAL mode)
- Task 6: Event Bus (LocalBus with EventEmitter pattern)
- Task 7: HTTP Server (Hono with health check, CORS, error handling)
- Task 8: i18n Setup (i18next with HU/EN locales)
- Task 9: Module Loader (dependency resolution, lifecycle hooks)
- Task 10: Bootstrap (orchestrates startup) + main.ts entry point
- Task 11: Frontend Shell — Scaffolding (Vite, React, Tailwind, shadcn/ui)
- Task 12: Frontend Shell — Layout, Navigation, UI Registry, Home Page
- Task 13: Final Integration Test

See the full plan with code in the conversation history. Each task follows TDD: write failing test, implement, verify, commit.
