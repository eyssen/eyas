# eYssen EYAS Hand — Phase 4: Tauri v2 GUI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native desktop GUI for EYAS Hand using Tauri v2. The app wraps the existing TypeScript core daemon, provides a settings UI via React webview, adds system tray integration with status indicators, native OS notifications for approval requests, and platform installers (DMG/MSI/deb).

**Architecture:** Tauri v2 Rust shell (minimal ~400 lines) manages the app window, system tray, and native notifications. A React + shadcn/ui + Tailwind webview provides the settings UI. The Tauri app spawns the TS daemon as a sidecar child process. The daemon exposes a local HTTP API on a random port; the webview fetches from it. Auto-updater via Tauri's built-in plugin.

**Tech Stack:** Rust (Tauri v2), TypeScript, React 19, Vite, Tailwind CSS v4, shadcn/ui, Hono (daemon HTTP), Zod

**Phases 1-3 already done:** CLI execution, permission system, TUI, OS Automation, Computer Use. This phase adds `packages/gui` and `packages/core/src/daemon-http.ts`.

**Repo:** `~/GitHub/eyas-hand/`

---

## File Structure

### New files in eyas-hand repo

```
packages/gui/                           -- New Tauri v2 package
  package.json
  tsconfig.json
  vite.config.ts                        -- Vite for webview bundling
  src-tauri/                            -- Rust side
    Cargo.toml
    tauri.conf.json                     -- Tauri config (window, tray, updater)
    build.rs                            -- Tauri build script
    icons/                              -- App icons (Tauri generates from source)
      icon.png                          -- 1024x1024 source icon
    src/
      main.rs                           -- Tauri app entry + sidecar management
      tray.rs                           -- System tray menu + icon logic
  src/                                  -- React webview frontend
    index.html
    main.tsx                            -- React entry
    App.tsx                             -- Root component with tab routing
    pages/
      connection-page.tsx               -- Connection status + pairing
      directories-page.tsx              -- Directory permissions
      cli-tools-page.tsx                -- CLI tool permissions
      apps-page.tsx                     -- App permissions
      computer-use-page.tsx             -- Computer Use settings
      activity-page.tsx                 -- Activity log
    components/
      layout.tsx                        -- App shell with sidebar tabs
      approval-dialog.tsx               -- Native-style approval popup
      status-indicator.tsx              -- Connection status dot
    hooks/
      use-daemon-api.ts                 -- Fetch/mutate daemon HTTP API
      use-config.ts                     -- Config management hook
      use-approval-ws.ts               -- WebSocket hook for real-time approvals
    lib/
      api.ts                            -- HTTP client to daemon
    styles/
      globals.css                       -- Tailwind base + EYAS vibrancy tokens

packages/core/src/
  daemon-http.ts                        -- Local HTTP API server (new file)
```

---

## Task 1: Daemon HTTP API (`daemon-http.ts`)

**Goal:** Add a local HTTP server to the core daemon so the GUI webview can communicate with it. This is the bridge between the Tauri webview and the TypeScript daemon.

**Files:**
- Create: `packages/core/src/daemon-http.ts`
- Edit: `packages/core/src/index.ts` (add export)
- Edit: `packages/core/package.json` (add hono dependency)

- [ ] **Step 1: Add Hono dependency to core package**

```json
// packages/core/package.json — add to dependencies:
{
  "dependencies": {
    "hono": "^4.7.0"
  }
}
```

```bash
cd ~/GitHub/eyas-hand && bun install
```

- [ ] **Step 2: Create daemon-http.ts**

```typescript
// packages/core/src/daemon-http.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { createServer } from 'http'
import type { HandConfig } from './config/config-schema.js'
import type { HandDaemon } from './hand-daemon.js'
import type { HandWsClient } from './connection/ws-client.js'
import { ConnectionState } from './connection/ws-client.js'
import { loadConfig } from './config/config-loader.js'
import { writeConfigValue, addToConfigArray } from './config/config-writer.js'
import { scanCliTools } from './discovery/cli-scanner.js'

export interface DaemonHttpOptions {
  daemon: HandDaemon
  wsClient: HandWsClient
  configPath: string
  handId: string
}

export interface ActivityEntry {
  id: string
  timestamp: number
  type: 'exec' | 'fs' | 'approval' | 'connection'
  action: string
  result?: 'success' | 'blocked' | 'denied' | 'error'
  detail?: string
}

const MAX_ACTIVITY = 200

export class DaemonHttpServer {
  private app: Hono
  private server: ReturnType<typeof createServer> | null = null
  private port = 0
  private activity: ActivityEntry[] = []
  private approvalCallbacks: Array<(data: string) => void> = []
  private startTime = Date.now()

  constructor(private opts: DaemonHttpOptions) {
    this.app = this.buildApp()
  }

  getPort(): number {
    return this.port
  }

  addActivity(entry: ActivityEntry): void {
    this.activity.unshift(entry)
    if (this.activity.length > MAX_ACTIVITY) {
      this.activity.length = MAX_ACTIVITY
    }
  }

  notifyApproval(data: unknown): void {
    const json = JSON.stringify(data)
    for (const cb of this.approvalCallbacks) {
      cb(json)
    }
  }

  private buildApp(): Hono {
    const app = new Hono()

    // Allow webview origin (Tauri uses tauri://localhost or https://tauri.localhost)
    app.use('/*', cors({
      origin: ['tauri://localhost', 'https://tauri.localhost', 'http://localhost:1420'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowHeaders: ['Content-Type'],
    }))

    // GET /status — connection state, hand ID, uptime
    app.get('/status', (c) => {
      return c.json({
        handId: this.opts.handId,
        connectionState: this.opts.wsClient.getState(),
        uptime: Date.now() - this.startTime,
        platform: process.platform,
        arch: process.arch,
        version: '0.1.0',
      })
    })

    // GET /config — current config
    app.get('/config', async (c) => {
      const config = await loadConfig(this.opts.configPath)
      return c.json(config)
    })

    // POST /config — update config (partial update)
    app.post('/config', async (c) => {
      const body = await c.req.json<{ key: string; value: unknown; action?: 'set' | 'add' }>()

      if (!body.key) {
        return c.json({ error: 'key is required' }, 400)
      }

      try {
        if (body.action === 'add' && typeof body.value === 'string') {
          await addToConfigArray(this.opts.configPath, body.key, body.value)
        } else {
          await writeConfigValue(this.opts.configPath, body.key, body.value)
        }
        const config = await loadConfig(this.opts.configPath)
        return c.json({ ok: true, config })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    // DELETE /config/array-item — remove item from array config
    app.delete('/config/array-item', async (c) => {
      const body = await c.req.json<{ key: string; value: string }>()
      if (!body.key || !body.value) {
        return c.json({ error: 'key and value are required' }, 400)
      }
      // Read config, remove from array, rewrite
      try {
        const config = await loadConfig(this.opts.configPath)
        // Navigate to the array in config using dot notation
        const parts = body.key.split('.')
        let current: unknown = config
        for (const part of parts.slice(0, -1)) {
          current = (current as Record<string, unknown>)[part]
        }
        const lastKey = parts[parts.length - 1]
        const arr = (current as Record<string, unknown>)[lastKey]
        if (Array.isArray(arr)) {
          const filtered = arr.filter((item: unknown) => item !== body.value)
          await writeConfigValue(this.opts.configPath, body.key, filtered)
        }
        const updated = await loadConfig(this.opts.configPath)
        return c.json({ ok: true, config: updated })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    // GET /tools — discovered CLI tools
    app.get('/tools', async (c) => {
      const tools = await scanCliTools()
      return c.json({ tools })
    })

    // GET /activity — recent commands/events
    app.get('/activity', (c) => {
      const limit = Number(c.req.query('limit') ?? '50')
      const offset = Number(c.req.query('offset') ?? '0')
      return c.json({
        entries: this.activity.slice(offset, offset + limit),
        total: this.activity.length,
      })
    })

    // POST /connect — connect to EYAS
    app.post('/connect', (c) => {
      if (this.opts.wsClient.getState() === ConnectionState.Connected) {
        return c.json({ ok: true, message: 'Already connected' })
      }
      this.opts.wsClient.connect()
      return c.json({ ok: true, message: 'Connecting...' })
    })

    // POST /disconnect — disconnect from EYAS
    app.post('/disconnect', (c) => {
      this.opts.wsClient.disconnect()
      return c.json({ ok: true, message: 'Disconnected' })
    })

    // POST /pair — initiate pairing
    app.post('/pair', async (c) => {
      const body = await c.req.json<{ url: string; code: string; name?: string }>()
      if (!body.url || !body.code) {
        return c.json({ error: 'url and code are required' }, 400)
      }

      try {
        const { pairWithEyas } = await import('./connection/pairing.js')
        const result = await pairWithEyas(
          body.url,
          body.code,
          this.opts.handId,
          body.name ?? this.opts.handId,
          process.platform,
        )
        // Persist to config
        await writeConfigValue(this.opts.configPath, 'hand.eyas_url', body.url)
        if (body.name) {
          await writeConfigValue(this.opts.configPath, 'hand.name', body.name)
        }
        return c.json({ ok: true, handId: result.handId })
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    // GET /approval/stream — SSE for real-time approval requests
    app.get('/approval/stream', (c) => {
      const stream = new ReadableStream({
        start: (controller) => {
          const encoder = new TextEncoder()
          const callback = (data: string) => {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }
          this.approvalCallbacks.push(callback)

          // Cleanup when client disconnects
          c.req.raw.signal.addEventListener('abort', () => {
            const idx = this.approvalCallbacks.indexOf(callback)
            if (idx >= 0) this.approvalCallbacks.splice(idx, 1)
          })
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      })
    })

    // POST /approval/respond — respond to an approval request
    app.post('/approval/respond', async (c) => {
      const body = await c.req.json<{ approvalId: string; decision: 'allow' | 'always' | 'deny'; action: string }>()
      if (!body.approvalId || !body.decision || !body.action) {
        return c.json({ error: 'approvalId, decision, and action are required' }, 400)
      }

      // Forward the approval response to the daemon via the WebSocket client
      const { createHandMessage, MSG } = await import('@eyas/hand-protocol')
      this.opts.wsClient.send(
        createHandMessage(MSG.APPROVAL_RESPONSE, {
          decision: body.decision,
          action: body.action,
        }, body.approvalId)
      )

      return c.json({ ok: true })
    })

    return app
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      const server = createServer(this.app.fetch as never)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        this.server = server
        resolve(this.port)
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve())
      } else {
        resolve()
      }
    })
  }
}
```

- [ ] **Step 3: Export DaemonHttpServer from core index**

Add to `packages/core/src/index.ts`:

```typescript
export { DaemonHttpServer, type DaemonHttpOptions, type ActivityEntry } from './daemon-http.js'
```

- [ ] **Step 4: Test daemon HTTP API**

Create `tests/core/daemon-http.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DaemonHttpServer } from '@eyas/hand-core'
import type { DaemonHttpOptions, ActivityEntry } from '@eyas/hand-core'

// Minimal mocks
function makeMockDaemon() {
  return {
    handId: 'test-hand-001',
    buildCapabilities: vi.fn(),
    handleMessage: vi.fn(),
    setSendFn: vi.fn(),
  } as any
}

function makeMockWsClient() {
  return {
    getState: vi.fn().mockReturnValue('disconnected'),
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
  } as any
}

describe('DaemonHttpServer', () => {
  let server: DaemonHttpServer
  let port: number

  beforeEach(async () => {
    const opts: DaemonHttpOptions = {
      daemon: makeMockDaemon(),
      wsClient: makeMockWsClient(),
      configPath: '/tmp/test-hand-config.yaml',
      handId: 'test-hand-001',
    }
    server = new DaemonHttpServer(opts)
    port = await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  it('GET /status returns hand info', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`)
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.handId).toBe('test-hand-001')
    expect(data.connectionState).toBe('disconnected')
    expect(typeof data.uptime).toBe('number')
  })

  it('GET /activity returns empty list initially', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/activity`)
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.entries).toEqual([])
    expect(data.total).toBe(0)
  })

  it('GET /activity returns added entries', async () => {
    const entry: ActivityEntry = {
      id: '1',
      timestamp: Date.now(),
      type: 'exec',
      action: 'ls',
      result: 'success',
    }
    server.addActivity(entry)
    const res = await fetch(`http://127.0.0.1:${port}/activity`)
    const data = await res.json()
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].action).toBe('ls')
  })

  it('POST /connect triggers ws connect', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/connect`, { method: 'POST' })
    expect(res.ok).toBe(true)
  })

  it('POST /disconnect triggers ws disconnect', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/disconnect`, { method: 'POST' })
    expect(res.ok).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
cd ~/GitHub/eyas-hand && bun run test
```

---

## Task 2: Scaffold Tauri v2 project

**Goal:** Create the `packages/gui` workspace package with Tauri v2 Rust shell, configured for window management, system tray, and auto-updater.

**Prerequisites:** Rust toolchain (`rustup`), Tauri CLI v2 (`cargo install tauri-cli --version "^2.0"`)

**Files:**
- Create: `packages/gui/package.json`
- Create: `packages/gui/tsconfig.json`
- Create: `packages/gui/vite.config.ts`
- Create: `packages/gui/src-tauri/Cargo.toml`
- Create: `packages/gui/src-tauri/tauri.conf.json`
- Create: `packages/gui/src-tauri/build.rs`
- Create: `packages/gui/src-tauri/src/main.rs`
- Create: `packages/gui/src-tauri/src/tray.rs`

- [ ] **Step 1: Create packages/gui/package.json**

```json
{
  "name": "@eyas/hand-gui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.5.0",
    "@tauri-apps/plugin-notification": "^2.2.0",
    "@tauri-apps/plugin-updater": "^2.5.0",
    "@tauri-apps/plugin-shell": "^2.2.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "lucide-react": "^0.510.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.2.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.5.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.4.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.9.0",
    "vite": "^6.3.0"
  }
}
```

- [ ] **Step 2: Create packages/gui/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "src-tauri"]
}
```

- [ ] **Step 3: Create packages/gui/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Prevent vite from obscuring Rust errors
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  // Env variables to expose to webview
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    // Don't minify in debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
```

- [ ] **Step 4: Create packages/gui/src-tauri/Cargo.toml**

```toml
[package]
name = "eyas-hand-gui"
version = "0.1.0"
description = "eYssen EYAS Hand — Desktop GUI"
authors = ["eYssen"]
license = "MIT"
edition = "2021"

[lib]
name = "eyas_hand_gui_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-notification = "2"
tauri-plugin-updater = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 5: Create packages/gui/src-tauri/build.rs**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 6: Create packages/gui/src-tauri/tauri.conf.json**

```json
{
  "$schema": "https://raw.githubusercontent.com/nickel-org/nickel.rs/refs/heads/master/src/static_file_handler.rs",
  "productName": "EYAS Hand",
  "version": "0.1.0",
  "identifier": "com.eyssen.eyas-hand",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "bun run dev",
    "beforeBuildCommand": "bun run build"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "title": "EYAS Hand",
        "width": 900,
        "height": 640,
        "minWidth": 680,
        "minHeight": 480,
        "resizable": true,
        "visible": false,
        "decorations": true,
        "transparent": false,
        "center": true
      }
    ],
    "trayIcon": {
      "iconPath": "icons/icon.png",
      "iconAsTemplate": true,
      "tooltip": "EYAS Hand"
    },
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "minimumSystemVersion": "10.15"
    },
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": ""
    }
  },
  "plugins": {
    "notification": {
      "all": true
    },
    "updater": {
      "pubkey": "",
      "endpoints": []
    },
    "shell": {
      "scope": [
        {
          "name": "eyas-hand-daemon",
          "cmd": "bun",
          "args": true
        }
      ]
    }
  }
}
```

- [ ] **Step 7: Create packages/gui/src-tauri/src/tray.rs**

```rust
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Status states for the tray icon tooltip
#[derive(Clone, Debug, serde::Serialize)]
pub enum TrayStatus {
    Connected,
    Disconnected,
    Paused,
    Connecting,
}

impl std::fmt::Display for TrayStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TrayStatus::Connected => write!(f, "Connected"),
            TrayStatus::Disconnected => write!(f, "Disconnected"),
            TrayStatus::Paused => write!(f, "Paused"),
            TrayStatus::Connecting => write!(f, "Connecting..."),
        }
    }
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Open EYAS Hand", true, None::<&str>)?;
    let activity_i = MenuItem::with_id(app, "activity", "Activity Log", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let pause_i = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
    let disconnect_i = MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit EYAS Hand", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_i,
            &activity_i,
            &sep,
            &pause_i,
            &disconnect_i,
            &sep2,
            &quit_i,
        ],
    )?;

    TrayIconBuilder::with_id("main-tray")
        .icon(Image::from_path("icons/icon.png").unwrap_or_else(|_| {
            Image::from_bytes(include_bytes!("../../icons/icon.png"))
                .expect("Failed to load tray icon")
        }))
        .icon_as_template(true)
        .tooltip("EYAS Hand — Disconnected")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "activity" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "activity");
                }
            }
            "pause" => {
                let _ = app.emit("tray-action", "pause");
            }
            "disconnect" => {
                let _ = app.emit("tray-action", "disconnect");
            }
            "quit" => {
                let _ = app.emit("tray-action", "quit");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Update tray tooltip to reflect current status
pub fn update_tray_status(app: &AppHandle, status: TrayStatus) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tooltip = format!("EYAS Hand — {}", status);
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}
```

- [ ] **Step 8: Create packages/gui/src-tauri/src/main.rs**

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// State shared between Tauri commands
struct AppState {
    daemon_port: Mutex<Option<u16>>,
    daemon_child_id: Mutex<Option<u32>>,
}

/// Tauri command: get the daemon HTTP port
#[tauri::command]
fn get_daemon_port(state: tauri::State<'_, Arc<AppState>>) -> Option<u16> {
    *state.daemon_port.lock().unwrap()
}

/// Tauri command: update tray status from webview
#[tauri::command]
fn update_status(app: tauri::AppHandle, status: String) {
    let tray_status = match status.as_str() {
        "connected" => tray::TrayStatus::Connected,
        "connecting" => tray::TrayStatus::Connecting,
        "paused" => tray::TrayStatus::Paused,
        _ => tray::TrayStatus::Disconnected,
    };
    tray::update_tray_status(&app, tray_status);
}

/// Tauri command: send native notification
#[tauri::command]
async fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    let state = Arc::new(AppState {
        daemon_port: Mutex::new(None),
        daemon_child_id: Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            get_daemon_port,
            update_status,
            send_notification,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Create system tray
            tray::create_tray(&handle)?;

            // Spawn the TS daemon as a sidecar via shell plugin
            // The daemon will print the HTTP port on stdout as "DAEMON_PORT=<port>"
            let state_clone = state.clone();
            let handle_clone = handle.clone();

            tauri::async_runtime::spawn(async move {
                let shell = handle_clone.shell();
                let (mut rx, _child) = shell
                    .sidecar("eyas-hand-daemon")
                    .expect("failed to create sidecar")
                    .args(["serve", "--http", "--port-stdout"])
                    .spawn()
                    .expect("failed to spawn daemon sidecar");

                // Store child PID
                // (Tauri manages the sidecar lifecycle automatically)

                // Read stdout for the port announcement
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let line_str = String::from_utf8_lossy(&line);
                            if let Some(port_str) = line_str.strip_prefix("DAEMON_PORT=") {
                                if let Ok(port) = port_str.trim().parse::<u16>() {
                                    *state_clone.daemon_port.lock().unwrap() = Some(port);
                                    let _ = handle_clone.emit("daemon-ready", port);
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            let line_str = String::from_utf8_lossy(&line);
                            eprintln!("[daemon] {}", line_str);
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[daemon] terminated with {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Hide window on close (keep in tray)
            let main_window = app.get_webview_window("main").unwrap();
            let window_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            // Show window after setup
            let _ = app.get_webview_window("main").unwrap().show();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 9: Create placeholder icon**

```bash
# Generate a minimal 1024x1024 placeholder PNG (will be replaced with real icon)
# For now, use Tauri's icon generator with a placeholder
mkdir -p ~/GitHub/eyas-hand/packages/gui/src-tauri/icons
```

Note: Run `cargo tauri icon <source-image>` to generate all icon sizes from a 1024x1024 source PNG.

- [ ] **Step 10: Add daemon --http flag support to cli.ts**

Edit `~/GitHub/eyas-hand/src/cli.ts` to add `--http` and `--port-stdout` flags to the `serve` command:

```typescript
// In cli.ts, modify cmdServe to accept options:

async function cmdServe(args: string[] = []): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      http: { type: 'boolean', default: false },
      'port-stdout': { type: 'boolean', default: false },
    },
    strict: false,
  })

  const enableHttp = values.http as boolean
  const portStdout = values['port-stdout'] as boolean

  const creds = loadCredentials()
  if (!creds) {
    console.error('Not paired. Run: hand pair --url <wss://...> --code <123456>')
    process.exit(1)
  }

  const config = await loadConfig(CONFIG_FILE)
  const eyasUrl = config.hand.eyasUrl || ''

  if (!eyasUrl) {
    console.error('No EYAS URL configured. Run: hand pair --url <wss://...> --code <123456>')
    process.exit(1)
  }

  const daemon = new HandDaemon({
    config,
    configPath: CONFIG_FILE,
    handId: creds.handId,
    token: creds.token,
    eyasUrl,
  })

  const client = new HandWsClient({
    url: eyasUrl,
    handId: creds.handId,
    token: creds.token,
    platform: process.platform,
  })

  // Wire: daemon sends via client
  daemon.setSendFn((msg) => client.send(msg))

  // Wire: incoming messages go to daemon
  client.on('message', (msg) => {
    daemon.handleMessage(msg).catch((err: unknown) => {
      console.error('Error handling message:', err)
    })
  })

  // Start HTTP API if requested (for GUI communication)
  let httpServer: import('@eyas/hand-core').DaemonHttpServer | undefined
  if (enableHttp) {
    const { DaemonHttpServer } = await import('@eyas/hand-core')
    httpServer = new DaemonHttpServer({
      daemon,
      wsClient: client,
      configPath: CONFIG_FILE,
      handId: creds.handId,
    })
    const port = await httpServer.start()
    if (portStdout) {
      // Signal the port to the parent process (Tauri reads this)
      console.log(`DAEMON_PORT=${port}`)
    } else {
      console.log(`HTTP API listening on http://127.0.0.1:${port}`)
    }
  }

  // On connected: announce capabilities
  client.on('connected', async () => {
    console.log('Connected to EYAS.')
    try {
      const caps = await daemon.buildCapabilities()
      client.sendMessage(MSG.HAND_CAPABILITIES, caps)
    } catch (err) {
      console.error('Failed to build capabilities:', err)
    }
  })

  // Write daemon state file for TUI to read
  function writeDaemonState(status: string) {
    try {
      writeFileSync(STATE_FILE, JSON.stringify({
        status,
        pid: process.pid,
        handId: creds!.handId,
        httpPort: httpServer?.getPort(),
        timestamp: Date.now(),
      }))
    } catch {}
  }

  // Log state changes
  client.on('stateChange', (state: ConnectionState) => {
    writeDaemonState(state)
    switch (state) {
      case ConnectionState.Connecting:
        console.log('Connecting...')
        break
      case ConnectionState.Reconnecting:
        console.log('Reconnecting...')
        break
      case ConnectionState.Disconnected:
        console.log('Disconnected.')
        break
      case ConnectionState.Authenticating:
        console.log('Authenticating...')
        break
    }
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...')
    if (httpServer) await httpServer.stop()
    client.disconnect()
    try { unlinkSync(STATE_FILE) } catch {}
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log(`Starting hand daemon — Hand ID: ${creds.handId}`)
  console.log(`EYAS: ${eyasUrl}`)
  client.connect()
}
```

Update the `main()` switch to pass args:

```typescript
case 'serve':
  await cmdServe(rest)
  break
```

---

## Task 3: React webview setup (Vite + React + Tailwind + shadcn/ui)

**Goal:** Set up the webview frontend with the EYAS design system (Apple vibrancy material, dark+light mode).

**Files:**
- Create: `packages/gui/src/index.html`
- Create: `packages/gui/src/main.tsx`
- Create: `packages/gui/src/App.tsx`
- Create: `packages/gui/src/styles/globals.css`
- Create: `packages/gui/src/lib/api.ts`
- Create: `packages/gui/src/lib/utils.ts`
- Create: `packages/gui/src/components/layout.tsx`
- Create: `packages/gui/src/components/status-indicator.tsx`

- [ ] **Step 1: Create index.html**

```html
<!-- packages/gui/src/index.html -->
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EYAS Hand</title>
    <link rel="stylesheet" href="./styles/globals.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create main.tsx**

```tsx
// packages/gui/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 3: Create globals.css (EYAS vibrancy design tokens)**

```css
/* packages/gui/src/styles/globals.css */
@import "tailwindcss";

@layer base {
  :root {
    /* Light mode — macOS Sequoia Light */
    --background: 240 5% 96%;
    --foreground: 240 10% 4%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 4%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 4%;
    --primary: 215 100% 50%;
    --primary-foreground: 0 0% 100%;
    --secondary: 240 5% 92%;
    --secondary-foreground: 240 6% 10%;
    --muted: 240 5% 92%;
    --muted-foreground: 240 4% 46%;
    --accent: 240 5% 92%;
    --accent-foreground: 240 6% 10%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 6% 90%;
    --input: 240 6% 90%;
    --ring: 215 100% 50%;
    --radius: 0.75rem;

    /* Vibrancy material — light */
    --vibrancy-bg: rgba(255, 255, 255, 0.7);
    --vibrancy-border: rgba(0, 0, 0, 0.08);
    --card-glass: rgba(255, 255, 255, 0.7);
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    --nav-active-bg: rgba(0, 122, 255, 0.1);
    --nav-active-color: hsl(215, 100%, 50%);
    --gradient-bg: linear-gradient(180deg, #f5f5f7 0%, #ebebf0 100%);

    /* Status colors */
    --status-connected: 142 71% 45%;
    --status-disconnected: 0 84% 60%;
    --status-connecting: 38 92% 50%;
    --status-paused: 240 4% 46%;
  }

  .dark {
    /* Dark mode — macOS Sequoia Dark */
    --background: 230 30% 5%;
    --foreground: 0 0% 98%;
    --card: 230 25% 8%;
    --card-foreground: 0 0% 98%;
    --popover: 230 25% 8%;
    --popover-foreground: 0 0% 98%;
    --primary: 239 84% 67%;
    --primary-foreground: 0 0% 100%;
    --secondary: 230 20% 12%;
    --secondary-foreground: 0 0% 98%;
    --muted: 230 20% 12%;
    --muted-foreground: 230 10% 50%;
    --accent: 230 20% 12%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 63% 31%;
    --destructive-foreground: 0 0% 98%;
    --border: 230 15% 15%;
    --input: 230 15% 15%;
    --ring: 239 84% 67%;

    /* Vibrancy material — dark */
    --vibrancy-bg: rgba(20, 20, 40, 0.7);
    --vibrancy-border: rgba(255, 255, 255, 0.06);
    --card-glass: rgba(255, 255, 255, 0.03);
    --card-shadow: none;
    --nav-active-bg: rgba(129, 140, 248, 0.1);
    --nav-active-color: hsl(239, 84%, 67%);
    --gradient-bg: linear-gradient(180deg, #0a0a14 0%, #0e1020 100%);

    /* Status colors — dark */
    --status-connected: 142 71% 45%;
    --status-disconnected: 0 63% 50%;
    --status-connecting: 38 92% 50%;
    --status-paused: 230 10% 50%;
  }
}

@layer base {
  * {
    border-color: hsl(var(--border));
  }

  body {
    background: var(--gradient-bg);
    color: hsl(var(--foreground));
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    overflow: hidden;
    height: 100vh;
  }
}

/* Vibrancy utilities */
.vibrancy {
  background: var(--vibrancy-bg);
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
}

.glass-card {
  background: var(--card-glass);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 0.5px solid var(--vibrancy-border);
  border-radius: var(--radius);
  box-shadow: var(--card-shadow);
}

/* Section labels (Apple HIG) */
.section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}

/* Page title */
.page-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: hsl(var(--foreground));
}
```

- [ ] **Step 4: Create lib/utils.ts**

```typescript
// packages/gui/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: Create lib/api.ts**

```typescript
// packages/gui/src/lib/api.ts
import { invoke } from '@tauri-apps/api/core'

let daemonPort: number | null = null

/**
 * Get the daemon API base URL. Waits for daemon to be ready if needed.
 */
export async function getDaemonUrl(): Promise<string> {
  if (daemonPort) return `http://127.0.0.1:${daemonPort}`

  // Ask Tauri for the port
  const port = await invoke<number | null>('get_daemon_port')
  if (port) {
    daemonPort = port
    return `http://127.0.0.1:${port}`
  }

  throw new Error('Daemon not ready')
}

/**
 * Set the daemon port directly (called when daemon-ready event fires)
 */
export function setDaemonPort(port: number): void {
  daemonPort = port
}

/**
 * Fetch from the daemon HTTP API
 */
export async function daemonFetch<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const base = await getDaemonUrl()
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Daemon API error (${res.status}): ${text}`)
  }

  return res.json() as Promise<T>
}

/**
 * POST to daemon API
 */
export async function daemonPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return daemonFetch<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * DELETE to daemon API
 */
export async function daemonDelete<T = unknown>(path: string, body: unknown): Promise<T> {
  return daemonFetch<T>(path, {
    method: 'DELETE',
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 6: Create components/status-indicator.tsx**

```tsx
// packages/gui/src/components/status-indicator.tsx
import { cn } from '@/lib/utils'

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'authenticating' | 'paused'

interface StatusIndicatorProps {
  status: ConnectionStatus
  className?: string
  showLabel?: boolean
}

const statusConfig: Record<ConnectionStatus, { color: string; label: string; pulse: boolean }> = {
  connected: { color: 'bg-green-500', label: 'Connected', pulse: false },
  disconnected: { color: 'bg-red-500', label: 'Disconnected', pulse: false },
  connecting: { color: 'bg-amber-500', label: 'Connecting', pulse: true },
  reconnecting: { color: 'bg-amber-500', label: 'Reconnecting', pulse: true },
  authenticating: { color: 'bg-amber-500', label: 'Authenticating', pulse: true },
  paused: { color: 'bg-gray-400', label: 'Paused', pulse: false },
}

export function StatusIndicator({ status, className, showLabel = false }: StatusIndicatorProps) {
  const config = statusConfig[status] ?? statusConfig.disconnected

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="relative flex h-2.5 w-2.5">
        {config.pulse && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', config.color)} />
        )}
        <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', config.color)} />
      </span>
      {showLabel && (
        <span className="text-xs text-muted-foreground">{config.label}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Create components/layout.tsx**

```tsx
// packages/gui/src/components/layout.tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { StatusIndicator, type ConnectionStatus } from './status-indicator'
import {
  Wifi,
  FolderOpen,
  Terminal,
  AppWindow,
  Monitor,
  Activity,
} from 'lucide-react'

export type TabId = 'connection' | 'directories' | 'cli-tools' | 'apps' | 'computer-use' | 'activity'

interface LayoutProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  connectionStatus: ConnectionStatus
  children: ReactNode
}

const tabs: Array<{ id: TabId; label: string; icon: typeof Wifi }> = [
  { id: 'connection', label: 'Connection', icon: Wifi },
  { id: 'directories', label: 'Directories', icon: FolderOpen },
  { id: 'cli-tools', label: 'CLI Tools', icon: Terminal },
  { id: 'apps', label: 'Apps', icon: AppWindow },
  { id: 'computer-use', label: 'Computer Use', icon: Monitor },
  { id: 'activity', label: 'Activity', icon: Activity },
]

export function Layout({ activeTab, onTabChange, connectionStatus, children }: LayoutProps) {
  return (
    <div className="flex h-screen" data-tauri-drag-region>
      {/* Sidebar */}
      <aside className="vibrancy flex w-52 flex-col border-r border-[var(--vibrancy-border)]">
        {/* App title bar area — draggable on macOS */}
        <div className="flex h-12 items-center gap-2 px-4" data-tauri-drag-region>
          <span className="text-sm font-semibold" data-tauri-drag-region>EYAS Hand</span>
          <StatusIndicator status={connectionStatus} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-2 pt-1">
          <p className="section-label mb-2 px-2">Settings</p>
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-[var(--nav-active-bg)] font-medium text-[var(--nav-active-color)]'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {tab.label}
              </button>
            )
          })}
        </nav>

        {/* Footer status */}
        <div className="border-t border-[var(--vibrancy-border)] px-4 py-3">
          <StatusIndicator status={connectionStatus} showLabel />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  )
}
```

- [ ] **Step 8: Create App.tsx**

```tsx
// packages/gui/src/App.tsx
import { useState, useEffect, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Layout, type TabId } from './components/layout'
import type { ConnectionStatus } from './components/status-indicator'
import { setDaemonPort } from './lib/api'
import { useDaemonApi } from './hooks/use-daemon-api'
import { ConnectionPage } from './pages/connection-page'
import { DirectoriesPage } from './pages/directories-page'
import { CliToolsPage } from './pages/cli-tools-page'
import { AppsPage } from './pages/apps-page'
import { ComputerUsePage } from './pages/computer-use-page'
import { ActivityPage } from './pages/activity-page'
import { ApprovalDialog } from './components/approval-dialog'

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('connection')
  const [daemonReady, setDaemonReady] = useState(false)
  const { status } = useDaemonApi(daemonReady)

  const connectionStatus: ConnectionStatus = status?.connectionState ?? 'disconnected'

  // Listen for daemon ready event from Tauri
  useEffect(() => {
    const unlisten = listen<number>('daemon-ready', (event) => {
      setDaemonPort(event.payload)
      setDaemonReady(true)
    })

    // Also listen for navigation events from tray
    const unlistenNav = listen<string>('navigate', (event) => {
      if (event.payload === 'activity') setActiveTab('activity')
    })

    return () => {
      unlisten.then((fn) => fn())
      unlistenNav.then((fn) => fn())
    }
  }, [])

  // Update tray status when connection changes
  useEffect(() => {
    if (connectionStatus) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('update_status', { status: connectionStatus })
      })
    }
  }, [connectionStatus])

  const renderPage = useCallback(() => {
    if (!daemonReady) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
            <p className="text-sm text-muted-foreground">Starting daemon...</p>
          </div>
        </div>
      )
    }

    switch (activeTab) {
      case 'connection': return <ConnectionPage />
      case 'directories': return <DirectoriesPage />
      case 'cli-tools': return <CliToolsPage />
      case 'apps': return <AppsPage />
      case 'computer-use': return <ComputerUsePage />
      case 'activity': return <ActivityPage />
    }
  }, [activeTab, daemonReady])

  return (
    <>
      <Layout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connectionStatus={connectionStatus}
      >
        {renderPage()}
      </Layout>
      {daemonReady && <ApprovalDialog />}
    </>
  )
}
```

---

## Task 4: Hooks (daemon API + config + approval WebSocket)

**Goal:** Create the React hooks that communicate with the daemon HTTP API.

**Files:**
- Create: `packages/gui/src/hooks/use-daemon-api.ts`
- Create: `packages/gui/src/hooks/use-config.ts`
- Create: `packages/gui/src/hooks/use-approval-ws.ts`

- [ ] **Step 1: Create hooks/use-daemon-api.ts**

```tsx
// packages/gui/src/hooks/use-daemon-api.ts
import { useState, useEffect, useCallback } from 'react'
import { daemonFetch } from '@/lib/api'

interface DaemonStatus {
  handId: string
  connectionState: string
  uptime: number
  platform: string
  arch: string
  version: string
}

export function useDaemonApi(enabled: boolean) {
  const [status, setStatus] = useState<DaemonStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!enabled) return
    try {
      const data = await daemonFetch<DaemonStatus>('/status')
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [enabled])

  // Poll status every 2 seconds
  useEffect(() => {
    if (!enabled) return
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [enabled, fetchStatus])

  return { status, error, refetch: fetchStatus }
}

export function useTools(enabled: boolean) {
  const [tools, setTools] = useState<Array<{ id: string; name: string; type: string; path: string; version?: string }>>([])
  const [loading, setLoading] = useState(false)

  const fetchTools = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const data = await daemonFetch<{ tools: typeof tools }>('/tools')
      setTools(data.tools)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    fetchTools()
  }, [fetchTools])

  return { tools, loading, refetch: fetchTools }
}

export function useActivity(enabled: boolean) {
  const [entries, setEntries] = useState<Array<{
    id: string; timestamp: number; type: string; action: string; result?: string; detail?: string
  }>>([])
  const [total, setTotal] = useState(0)

  const fetchActivity = useCallback(async (limit = 50, offset = 0) => {
    if (!enabled) return
    try {
      const data = await daemonFetch<{ entries: typeof entries; total: number }>(
        `/activity?limit=${limit}&offset=${offset}`
      )
      setEntries(data.entries)
      setTotal(data.total)
    } catch {
      // ignore
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    fetchActivity()
    const interval = setInterval(() => fetchActivity(), 3000)
    return () => clearInterval(interval)
  }, [enabled, fetchActivity])

  return { entries, total, refetch: fetchActivity }
}
```

- [ ] **Step 2: Create hooks/use-config.ts**

```tsx
// packages/gui/src/hooks/use-config.ts
import { useState, useEffect, useCallback } from 'react'
import { daemonFetch, daemonPost, daemonDelete } from '@/lib/api'

interface HandConfig {
  hand: {
    name: string
    eyasUrl: string
    authToken?: string
  }
  permissions: {
    directories: Array<{ path: string; access: 'read-only' | 'read-write' }>
    cli: { allowed: string[]; blocked: string[] }
    apps: { allowed: string[]; blocked: string[] }
    safety: {
      maxConcurrentCommands: number
      commandTimeoutSeconds: number
      blockDestructiveByDefault: boolean
      requireApprovalForNetwork: boolean
    }
    computerUse: { enabled: boolean }
  }
  learned: Array<{ tool: string; learnedAt: string; context: string }>
}

export function useConfig(enabled: boolean) {
  const [config, setConfig] = useState<HandConfig | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchConfig = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const data = await daemonFetch<HandConfig>('/config')
      setConfig(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const updateConfig = useCallback(async (key: string, value: unknown, action?: 'set' | 'add') => {
    const result = await daemonPost<{ ok: boolean; config: HandConfig }>('/config', { key, value, action })
    if (result.ok && result.config) {
      setConfig(result.config)
    }
    return result
  }, [])

  const removeFromArray = useCallback(async (key: string, value: string) => {
    const result = await daemonDelete<{ ok: boolean; config: HandConfig }>('/config/array-item', { key, value })
    if (result.ok && result.config) {
      setConfig(result.config)
    }
    return result
  }, [])

  return { config, loading, refetch: fetchConfig, updateConfig, removeFromArray }
}
```

- [ ] **Step 3: Create hooks/use-approval-ws.ts**

```tsx
// packages/gui/src/hooks/use-approval-ws.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { getDaemonUrl, daemonPost } from '@/lib/api'

export interface ApprovalRequest {
  approvalId: string
  action: string
  description: string
  riskTier: 'yellow' | 'red'
  timestamp: number
}

export function useApprovalStream(enabled: boolean) {
  const [pending, setPending] = useState<ApprovalRequest[]>([])
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function connect() {
      try {
        const base = await getDaemonUrl()
        if (cancelled) return

        const es = new EventSource(`${base}/approval/stream`)
        eventSourceRef.current = es

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as ApprovalRequest
            setPending((prev) => [...prev, data])
          } catch {
            // ignore parse errors
          }
        }

        es.onerror = () => {
          // EventSource reconnects automatically
        }
      } catch {
        // Daemon not ready yet, retry
        if (!cancelled) {
          setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      eventSourceRef.current?.close()
    }
  }, [enabled])

  const respond = useCallback(async (approvalId: string, decision: 'allow' | 'always' | 'deny', action: string) => {
    await daemonPost('/approval/respond', { approvalId, decision, action })
    setPending((prev) => prev.filter((p) => p.approvalId !== approvalId))
  }, [])

  const dismiss = useCallback((approvalId: string) => {
    setPending((prev) => prev.filter((p) => p.approvalId !== approvalId))
  }, [])

  return { pending, respond, dismiss }
}
```

---

## Task 5: Settings pages

**Goal:** Implement the 6 settings pages for the GUI webview.

**Files:**
- Create: `packages/gui/src/pages/connection-page.tsx`
- Create: `packages/gui/src/pages/directories-page.tsx`
- Create: `packages/gui/src/pages/cli-tools-page.tsx`
- Create: `packages/gui/src/pages/apps-page.tsx`
- Create: `packages/gui/src/pages/computer-use-page.tsx`
- Create: `packages/gui/src/pages/activity-page.tsx`

- [ ] **Step 1: Create connection-page.tsx**

```tsx
// packages/gui/src/pages/connection-page.tsx
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { StatusIndicator } from '@/components/status-indicator'
import { useDaemonApi } from '@/hooks/use-daemon-api'
import { useConfig } from '@/hooks/use-config'
import { daemonPost } from '@/lib/api'
import { Wifi, WifiOff, Link2, Unlink } from 'lucide-react'

export function ConnectionPage() {
  const { status, error } = useDaemonApi(true)
  const { config } = useConfig(true)
  const [pairUrl, setPairUrl] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairName, setPairName] = useState('')
  const [pairing, setPairing] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)

  const isConnected = status?.connectionState === 'connected'

  const handleConnect = async () => {
    try {
      await daemonPost('/connect', {})
    } catch (err) {
      console.error('Connect failed:', err)
    }
  }

  const handleDisconnect = async () => {
    try {
      await daemonPost('/disconnect', {})
    } catch (err) {
      console.error('Disconnect failed:', err)
    }
  }

  const handlePair = async () => {
    if (!pairUrl || !pairCode) return
    setPairing(true)
    setPairError(null)
    try {
      await daemonPost('/pair', { url: pairUrl, code: pairCode, name: pairName || undefined })
      setPairUrl('')
      setPairCode('')
      setPairName('')
    } catch (err) {
      setPairError(err instanceof Error ? err.message : String(err))
    } finally {
      setPairing(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Connection</h1>

      {/* Status card */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isConnected ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            <div>
              <p className="font-medium">
                {status?.connectionState === 'connected' ? 'Connected to EYAS' : 'Not connected'}
              </p>
              <p className="text-xs text-muted-foreground">
                {config?.hand.eyasUrl || 'No EYAS URL configured'}
              </p>
            </div>
          </div>
          <StatusIndicator status={(status?.connectionState as any) ?? 'disconnected'} showLabel />
        </div>

        {status && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="section-label mb-1">Hand ID</p>
              <p className="font-mono text-xs">{status.handId}</p>
            </div>
            <div>
              <p className="section-label mb-1">Uptime</p>
              <p className="text-xs">{formatUptime(status.uptime)}</p>
            </div>
            <div>
              <p className="section-label mb-1">Platform</p>
              <p className="text-xs">{status.platform} / {status.arch}</p>
            </div>
            <div>
              <p className="section-label mb-1">Version</p>
              <p className="text-xs">{status.version}</p>
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {isConnected ? (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:opacity-90 transition"
            >
              <Unlink className="h-3.5 w-3.5" />
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={!config?.hand.eyasUrl}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" />
              Connect
            </button>
          )}
        </div>
      </div>

      {/* Pair new EYAS */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold mb-3">Pair with EYAS Server</h2>
        <div className="space-y-3">
          <div>
            <label className="section-label mb-1 block">EYAS WebSocket URL</label>
            <input
              type="text"
              value={pairUrl}
              onChange={(e) => setPairUrl(e.target.value)}
              placeholder="wss://eyas.example.com/api/v1/hand/ws"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="section-label mb-1 block">Pairing Code</label>
            <input
              type="text"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="section-label mb-1 block">Hand Name (optional)</label>
            <input
              type="text"
              value={pairName}
              onChange={(e) => setPairName(e.target.value)}
              placeholder="My MacBook"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {pairError && (
            <p className="text-xs text-destructive">{pairError}</p>
          )}
          <button
            onClick={handlePair}
            disabled={pairing || !pairUrl || !pairCode}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {pairing ? 'Pairing...' : 'Pair'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">API Error: {error}</p>
      )}
    </div>
  )
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
```

- [ ] **Step 2: Create directories-page.tsx**

```tsx
// packages/gui/src/pages/directories-page.tsx
import { useState } from 'react'
import { useConfig } from '@/hooks/use-config'
import { FolderOpen, Plus, Trash2, Eye, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DirectoriesPage() {
  const { config, updateConfig, removeFromArray, refetch } = useConfig(true)
  const [newPath, setNewPath] = useState('')
  const [newAccess, setNewAccess] = useState<'read-only' | 'read-write'>('read-only')
  const [adding, setAdding] = useState(false)

  const directories = config?.permissions.directories ?? []

  const handleAdd = async () => {
    if (!newPath.trim()) return
    setAdding(true)
    try {
      // Directories are objects; we write the whole array
      const updated = [...directories, { path: newPath.trim(), access: newAccess }]
      await updateConfig('permissions.directories', updated)
      setNewPath('')
      setNewAccess('read-only')
    } catch (err) {
      console.error('Failed to add directory:', err)
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (path: string) => {
    const updated = directories.filter((d) => d.path !== path)
    await updateConfig('permissions.directories', updated)
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Directory Permissions</h1>
      <p className="text-sm text-muted-foreground">
        Control which directories the EYAS agent can access on this machine.
      </p>

      {/* Current directories */}
      <div className="space-y-2">
        {directories.length === 0 && (
          <div className="glass-card flex items-center justify-center p-8 text-sm text-muted-foreground">
            No directories configured. Add one below.
          </div>
        )}
        {directories.map((dir) => (
          <div key={dir.path} className="glass-card flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-mono">{dir.path}</p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  {dir.access === 'read-only' ? (
                    <><Eye className="h-3 w-3" /> Read-only</>
                  ) : (
                    <><Pencil className="h-3 w-3" /> Read-write</>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleRemove(dir.path)}
              className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Add new directory */}
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold mb-3">Add Directory</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="/path/to/directory"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={newAccess}
            onChange={(e) => setNewAccess(e.target.value as 'read-only' | 'read-write')}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="read-only">Read-only</option>
            <option value="read-write">Read-write</option>
          </select>
          <button
            onClick={handleAdd}
            disabled={adding || !newPath.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create cli-tools-page.tsx**

```tsx
// packages/gui/src/pages/cli-tools-page.tsx
import { useState } from 'react'
import { useConfig } from '@/hooks/use-config'
import { useTools } from '@/hooks/use-daemon-api'
import { Terminal, Plus, Trash2, ShieldCheck, ShieldX, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CliToolsPage() {
  const { config, updateConfig } = useConfig(true)
  const { tools, loading: toolsLoading, refetch: refetchTools } = useTools(true)
  const [newTool, setNewTool] = useState('')
  const [searchFilter, setSearchFilter] = useState('')

  const allowed = config?.permissions.cli.allowed ?? []
  const blocked = config?.permissions.cli.blocked ?? []

  const handleAllow = async (tool: string) => {
    if (!tool.trim() || allowed.includes(tool.trim())) return
    await updateConfig('permissions.cli.allowed', tool.trim(), 'add')
    // Remove from blocked if present
    if (blocked.includes(tool.trim())) {
      const updated = blocked.filter((t) => t !== tool.trim())
      await updateConfig('permissions.cli.blocked', updated)
    }
    setNewTool('')
  }

  const handleBlock = async (tool: string) => {
    if (!tool.trim() || blocked.includes(tool.trim())) return
    await updateConfig('permissions.cli.blocked', tool.trim(), 'add')
    // Remove from allowed if present
    if (allowed.includes(tool.trim())) {
      const updated = allowed.filter((t) => t !== tool.trim())
      await updateConfig('permissions.cli.allowed', updated)
    }
  }

  const handleRemoveAllowed = async (tool: string) => {
    const updated = allowed.filter((t) => t !== tool)
    await updateConfig('permissions.cli.allowed', updated)
  }

  const handleRemoveBlocked = async (tool: string) => {
    const updated = blocked.filter((t) => t !== tool)
    await updateConfig('permissions.cli.blocked', updated)
  }

  const filteredTools = tools.filter(
    (t) => !searchFilter || t.name.toLowerCase().includes(searchFilter.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <h1 className="page-title">CLI Tools</h1>
      <p className="text-sm text-muted-foreground">
        Manage which command-line tools the EYAS agent can execute.
      </p>

      {/* Allowed / Blocked lists */}
      <div className="grid grid-cols-2 gap-4">
        {/* Allowed */}
        <div className="glass-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            Allowed ({allowed.length})
          </h2>
          <div className="space-y-1">
            {allowed.map((tool) => (
              <div key={tool} className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent">
                <span className="text-sm font-mono">{tool}</span>
                <button onClick={() => handleRemoveAllowed(tool)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {allowed.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No tools explicitly allowed</p>
            )}
          </div>
        </div>

        {/* Blocked */}
        <div className="glass-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ShieldX className="h-4 w-4 text-red-500" />
            Blocked ({blocked.length})
          </h2>
          <div className="space-y-1">
            {blocked.map((tool) => (
              <div key={tool} className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent">
                <span className="text-sm font-mono">{tool}</span>
                <button onClick={() => handleRemoveBlocked(tool)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {blocked.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No tools explicitly blocked</p>
            )}
          </div>
        </div>
      </div>

      {/* Add tool */}
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold mb-3">Add Tool</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            placeholder="e.g. git, docker, curl"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && handleAllow(newTool)}
          />
          <button
            onClick={() => handleAllow(newTool)}
            disabled={!newTool.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:opacity-90 transition disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            Allow
          </button>
          <button
            onClick={() => handleBlock(newTool)}
            disabled={!newTool.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            <ShieldX className="h-4 w-4" />
            Block
          </button>
        </div>
      </div>

      {/* Discovered tools */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Discovered Tools ({tools.length})</h2>
          <button
            onClick={refetchTools}
            disabled={toolsLoading}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            {toolsLoading ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter tools..."
            className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filteredTools.map((tool) => (
            <div key={tool.id} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-mono">{tool.name}</span>
                {tool.version && (
                  <span className="text-xs text-muted-foreground">{tool.version}</span>
                )}
              </div>
              <div className="flex gap-1">
                {!allowed.includes(tool.name) && (
                  <button
                    onClick={() => handleAllow(tool.name)}
                    className="rounded p-1 text-muted-foreground hover:text-green-500 transition"
                    title="Allow"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </button>
                )}
                {!blocked.includes(tool.name) && (
                  <button
                    onClick={() => handleBlock(tool.name)}
                    className="rounded p-1 text-muted-foreground hover:text-red-500 transition"
                    title="Block"
                  >
                    <ShieldX className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create apps-page.tsx**

```tsx
// packages/gui/src/pages/apps-page.tsx
import { useState } from 'react'
import { useConfig } from '@/hooks/use-config'
import { AppWindow, Plus, Trash2, ShieldCheck, ShieldX } from 'lucide-react'

export function AppsPage() {
  const { config, updateConfig } = useConfig(true)
  const [newApp, setNewApp] = useState('')

  const allowed = config?.permissions.apps.allowed ?? []
  const blocked = config?.permissions.apps.blocked ?? []

  const handleAllow = async (app: string) => {
    if (!app.trim() || allowed.includes(app.trim())) return
    await updateConfig('permissions.apps.allowed', app.trim(), 'add')
    if (blocked.includes(app.trim())) {
      const updated = blocked.filter((a) => a !== app.trim())
      await updateConfig('permissions.apps.blocked', updated)
    }
    setNewApp('')
  }

  const handleBlock = async (app: string) => {
    if (!app.trim() || blocked.includes(app.trim())) return
    await updateConfig('permissions.apps.blocked', app.trim(), 'add')
    if (allowed.includes(app.trim())) {
      const updated = allowed.filter((a) => a !== app.trim())
      await updateConfig('permissions.apps.allowed', updated)
    }
    setNewApp('')
  }

  const handleRemoveAllowed = async (app: string) => {
    const updated = allowed.filter((a) => a !== app)
    await updateConfig('permissions.apps.allowed', updated)
  }

  const handleRemoveBlocked = async (app: string) => {
    const updated = blocked.filter((a) => a !== app)
    await updateConfig('permissions.apps.blocked', updated)
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">App Permissions</h1>
      <p className="text-sm text-muted-foreground">
        Control which desktop applications the EYAS agent can automate via OS scripting (JXA/PowerShell/D-Bus).
      </p>

      <div className="grid grid-cols-2 gap-4">
        {/* Allowed */}
        <div className="glass-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            Allowed ({allowed.length})
          </h2>
          <div className="space-y-1">
            {allowed.map((app) => (
              <div key={app} className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent">
                <div className="flex items-center gap-2">
                  <AppWindow className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm">{app}</span>
                </div>
                <button onClick={() => handleRemoveAllowed(app)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {allowed.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No apps explicitly allowed</p>
            )}
          </div>
        </div>

        {/* Blocked */}
        <div className="glass-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ShieldX className="h-4 w-4 text-red-500" />
            Blocked ({blocked.length})
          </h2>
          <div className="space-y-1">
            {blocked.map((app) => (
              <div key={app} className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent">
                <div className="flex items-center gap-2">
                  <AppWindow className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm">{app}</span>
                </div>
                <button onClick={() => handleRemoveBlocked(app)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {blocked.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No apps explicitly blocked</p>
            )}
          </div>
        </div>
      </div>

      {/* Add app */}
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold mb-3">Add App</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newApp}
            onChange={(e) => setNewApp(e.target.value)}
            placeholder="e.g. Safari, Terminal, Finder"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && handleAllow(newApp)}
          />
          <button
            onClick={() => handleAllow(newApp)}
            disabled={!newApp.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:opacity-90 transition disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            Allow
          </button>
          <button
            onClick={() => handleBlock(newApp)}
            disabled={!newApp.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            <ShieldX className="h-4 w-4" />
            Block
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create computer-use-page.tsx**

```tsx
// packages/gui/src/pages/computer-use-page.tsx
import { useConfig } from '@/hooks/use-config'
import { Monitor, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ComputerUsePage() {
  const { config, updateConfig } = useConfig(true)

  const enabled = config?.permissions.computerUse.enabled ?? false
  const safety = config?.permissions.safety

  const handleToggleComputerUse = async () => {
    await updateConfig('permissions.computer_use.enabled', !enabled)
  }

  const handleToggleSafety = async (key: string, currentValue: boolean) => {
    await updateConfig(`permissions.safety.${key}`, !currentValue)
  }

  const handleUpdateNumber = async (key: string, value: number) => {
    await updateConfig(`permissions.safety.${key}`, value)
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Computer Use</h1>
      <p className="text-sm text-muted-foreground">
        Configure screen capture, mouse, and keyboard control permissions.
      </p>

      {/* Computer Use toggle */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Computer Use</p>
              <p className="text-xs text-muted-foreground">
                Allow EYAS to take screenshots and control mouse/keyboard
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleComputerUse}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              enabled ? 'bg-primary' : 'bg-muted'
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                enabled ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
        </div>

        {enabled && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Computer Use gives the agent full screen visibility and input control.
              All actions are logged and require approval based on risk tier.
            </p>
          </div>
        )}
      </div>

      {/* Safety settings */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold mb-4">Safety Settings</h2>

        <div className="space-y-4">
          {/* Max concurrent commands */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Max Concurrent Commands</p>
              <p className="text-xs text-muted-foreground">Limit simultaneous command execution</p>
            </div>
            <input
              type="number"
              min={1}
              max={20}
              value={safety?.maxConcurrentCommands ?? 5}
              onChange={(e) => handleUpdateNumber('max_concurrent_commands', parseInt(e.target.value) || 5)}
              className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Command timeout */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Command Timeout (seconds)</p>
              <p className="text-xs text-muted-foreground">Kill commands that exceed this time</p>
            </div>
            <input
              type="number"
              min={10}
              max={3600}
              value={safety?.commandTimeoutSeconds ?? 300}
              onChange={(e) => handleUpdateNumber('command_timeout_seconds', parseInt(e.target.value) || 300)}
              className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Block destructive by default */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Block Destructive Commands</p>
              <p className="text-xs text-muted-foreground">Require approval for rm, kill, etc.</p>
            </div>
            <button
              onClick={() => handleToggleSafety('block_destructive_by_default', safety?.blockDestructiveByDefault ?? true)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                (safety?.blockDestructiveByDefault ?? true) ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                  (safety?.blockDestructiveByDefault ?? true) ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Require approval for network */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Approve Network Commands</p>
              <p className="text-xs text-muted-foreground">Require approval for curl, wget, ssh, etc.</p>
            </div>
            <button
              onClick={() => handleToggleSafety('require_approval_for_network', safety?.requireApprovalForNetwork ?? true)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                (safety?.requireApprovalForNetwork ?? true) ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                  (safety?.requireApprovalForNetwork ?? true) ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create activity-page.tsx**

```tsx
// packages/gui/src/pages/activity-page.tsx
import { useActivity } from '@/hooks/use-daemon-api'
import { Activity, Terminal, FolderOpen, ShieldAlert, Wifi, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

const typeIcons: Record<string, typeof Terminal> = {
  exec: Terminal,
  fs: FolderOpen,
  approval: ShieldAlert,
  connection: Wifi,
}

const resultColors: Record<string, string> = {
  success: 'text-green-500',
  blocked: 'text-red-500',
  denied: 'text-red-500',
  error: 'text-amber-500',
}

export function ActivityPage() {
  const { entries, total } = useActivity(true)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Activity Log</h1>
        <span className="text-xs text-muted-foreground">{total} events</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Recent commands and events processed by this Hand.
      </p>

      <div className="space-y-1">
        {entries.length === 0 && (
          <div className="glass-card flex items-center justify-center p-12 text-sm text-muted-foreground">
            <div className="text-center">
              <Activity className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p>No activity yet</p>
            </div>
          </div>
        )}
        {entries.map((entry) => {
          const Icon = typeIcons[entry.type] ?? Activity
          return (
            <div key={entry.id} className="glass-card flex items-start gap-3 p-3">
              <Icon className="mt-0.5 h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-mono">{entry.action}</p>
                  {entry.result && (
                    <span className={cn('text-xs font-medium flex-shrink-0', resultColors[entry.result] ?? 'text-muted-foreground')}>
                      {entry.result}
                    </span>
                  )}
                </div>
                {entry.detail && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.detail}</p>
                )}
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

---

## Task 6: Approval dialog

**Goal:** Real-time approval popup that appears when the daemon needs user permission to execute a command.

**Files:**
- Create: `packages/gui/src/components/approval-dialog.tsx`

- [ ] **Step 1: Create approval-dialog.tsx**

```tsx
// packages/gui/src/components/approval-dialog.tsx
import { useApprovalStream, type ApprovalRequest } from '@/hooks/use-approval-ws'
import { invoke } from '@tauri-apps/api/core'
import { ShieldAlert, Check, X, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ApprovalDialog() {
  const { pending, respond, dismiss } = useApprovalStream(true)

  // Also send native OS notification for the first pending item
  if (pending.length > 0) {
    const newest = pending[pending.length - 1]
    invoke('send_notification', {
      title: `Approval Required (${newest.riskTier})`,
      body: newest.description,
    }).catch(() => {})
  }

  if (pending.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-6 pointer-events-none">
      <div className="w-full max-w-lg space-y-2 pointer-events-auto px-4">
        {pending.map((req) => (
          <ApprovalCard key={req.approvalId} request={req} onRespond={respond} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  )
}

interface ApprovalCardProps {
  request: ApprovalRequest
  onRespond: (id: string, decision: 'allow' | 'always' | 'deny', action: string) => void
  onDismiss: (id: string) => void
}

function ApprovalCard({ request, onRespond, onDismiss }: ApprovalCardProps) {
  const isRed = request.riskTier === 'red'

  return (
    <div
      className={cn(
        'glass-card overflow-hidden border-l-4 p-4 shadow-lg animate-in slide-in-from-bottom-2 duration-200',
        isRed ? 'border-l-red-500' : 'border-l-amber-500'
      )}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className={cn('mt-0.5 h-5 w-5 flex-shrink-0', isRed ? 'text-red-500' : 'text-amber-500')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
              isRed
                ? 'bg-red-500/10 text-red-500'
                : 'bg-amber-500/10 text-amber-500'
            )}>
              {request.riskTier}
            </span>
            <span className="text-xs text-muted-foreground">Approval Required</span>
          </div>
          <p className="text-sm font-medium">{request.description}</p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{request.action}</p>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onRespond(request.approvalId, 'allow', request.action)}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition"
            >
              <Check className="h-3.5 w-3.5" />
              Allow Once
            </button>
            <button
              onClick={() => onRespond(request.approvalId, 'always', request.action)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Always Allow
            </button>
            <button
              onClick={() => onRespond(request.approvalId, 'deny', request.action)}
              className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 transition"
            >
              <X className="h-3.5 w-3.5" />
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## Task 7: System tray + native notifications (Rust integration)

**Goal:** Wire up the system tray actions to the webview and ensure native notifications work for approval requests.

This task verifies and refines the Rust code from Task 2. The tray and notifications are already scaffolded in `main.rs` and `tray.rs`.

**Files:**
- Edit: `packages/gui/src-tauri/src/main.rs` (already created in Task 2)
- Edit: `packages/gui/src-tauri/src/tray.rs` (already created in Task 2)

- [ ] **Step 1: Verify tray actions emit events to webview**

The tray menu events (`pause`, `disconnect`, `quit`) are already handled via `app.emit("tray-action", ...)` in `tray.rs`. The webview needs to listen for these:

Add to `packages/gui/src/App.tsx` inside the `useEffect`:

```tsx
// Listen for tray actions
const unlistenTray = listen<string>('tray-action', async (event) => {
  switch (event.payload) {
    case 'pause':
      // Toggle pause state (future: implement pause in daemon)
      break
    case 'disconnect':
      try {
        await daemonPost('/disconnect', {})
      } catch {}
      break
    case 'quit':
      // Tauri handles the quit via app.exit(0) in tray.rs
      break
  }
})
```

Add cleanup to the return:

```tsx
return () => {
  unlisten.then((fn) => fn())
  unlistenNav.then((fn) => fn())
  unlistenTray.then((fn) => fn())
}
```

- [ ] **Step 2: Test native notifications**

Verify that when an approval request comes in via SSE, the webview calls `invoke('send_notification', ...)` which triggers the Tauri notification plugin. This is already wired in `approval-dialog.tsx`.

- [ ] **Step 3: Verify tray tooltip updates**

The webview calls `invoke('update_status', { status })` whenever connection state changes, which triggers `tray::update_tray_status()` in Rust to update the tooltip text. Already wired in `App.tsx` useEffect.

---

## Task 8: Build + installers (DMG/MSI/deb)

**Goal:** Configure Tauri to produce platform-specific installers and set up the build pipeline.

**Files:**
- Edit: `packages/gui/src-tauri/tauri.conf.json` (already has bundle config)
- Edit: `packages/gui/package.json` (build scripts)
- Edit: root `package.json` (workspace scripts)

- [ ] **Step 1: Add build scripts to root package.json**

```json
{
  "scripts": {
    "gui:dev": "cd packages/gui && bun run tauri:dev",
    "gui:build": "cd packages/gui && bun run tauri:build"
  }
}
```

- [ ] **Step 2: Configure sidecar in Tauri**

The TS daemon runs as a Tauri sidecar. The sidecar binary must be placed in `packages/gui/src-tauri/binaries/`.

For development, the shell plugin's `sidecar` command points to a `bun` executable with args `["run", "../../src/cli.ts", "serve", "--http", "--port-stdout"]`.

For production builds, the daemon needs to be bundled as a standalone binary:

```bash
# Build standalone daemon binary using bun
cd ~/GitHub/eyas-hand
bun build src/cli.ts --compile --outfile packages/gui/src-tauri/binaries/eyas-hand-daemon
```

Update `tauri.conf.json` shell scope for the sidecar:

```json
{
  "plugins": {
    "shell": {
      "scope": [
        {
          "name": "eyas-hand-daemon",
          "cmd": "binaries/eyas-hand-daemon",
          "args": true,
          "sidecar": true
        }
      ]
    }
  }
}
```

Note: Tauri expects sidecar binaries named with the target triple suffix, e.g. `eyas-hand-daemon-aarch64-apple-darwin`. The `tauri build` command handles this via `externalBin` config.

Add to `tauri.conf.json` under `bundle`:

```json
{
  "bundle": {
    "externalBin": ["binaries/eyas-hand-daemon"]
  }
}
```

- [ ] **Step 3: Build for current platform**

```bash
cd ~/GitHub/eyas-hand/packages/gui

# Development
bun run tauri:dev

# Production build (creates DMG on macOS, MSI on Windows, deb on Linux)
bun run tauri:build
```

Build outputs:
- **macOS:** `src-tauri/target/release/bundle/dmg/EYAS Hand_0.1.0_aarch64.dmg`
- **Windows:** `src-tauri/target/release/bundle/msi/EYAS Hand_0.1.0_x64_en-US.msi`
- **Linux:** `src-tauri/target/release/bundle/deb/eyas-hand_0.1.0_amd64.deb`

- [ ] **Step 4: Configure auto-updater (placeholder)**

The updater is configured in `tauri.conf.json` under `plugins.updater`. For now, the `endpoints` and `pubkey` are empty. When releasing:

1. Generate updater keys: `tauri signer generate -w ~/.tauri/eyas-hand.key`
2. Set the `pubkey` in `tauri.conf.json`
3. Add endpoint URL where update JSON is hosted
4. On each release, generate the update artifacts with `tauri build`

- [ ] **Step 5: Run final integration test**

```bash
# 1. Start in dev mode
cd ~/GitHub/eyas-hand/packages/gui && bun run tauri:dev

# 2. Verify:
#    - Window opens with EYAS Hand UI
#    - System tray icon appears
#    - Clicking tray icon shows/hides window
#    - Tray menu items work (Open, Activity Log, Disconnect, Quit)
#    - Connection page shows daemon status
#    - Settings pages load and save correctly
#    - Approval dialog appears when triggered
#    - Native notifications fire for approvals
```

---

## Dependency License Check

All new dependencies and their licenses:

| Package | License | OK? |
|---------|---------|-----|
| `@tauri-apps/api` | MIT | Yes |
| `@tauri-apps/cli` | MIT | Yes |
| `@tauri-apps/plugin-notification` | MIT | Yes |
| `@tauri-apps/plugin-updater` | MIT | Yes |
| `@tauri-apps/plugin-shell` | MIT | Yes |
| `react` | MIT | Yes |
| `react-dom` | MIT | Yes |
| `lucide-react` | ISC | Yes |
| `clsx` | MIT | Yes |
| `tailwind-merge` | MIT | Yes |
| `@vitejs/plugin-react` | MIT | Yes |
| `tailwindcss` | MIT | Yes |
| `vite` | MIT | Yes |
| `hono` | MIT | Yes |
| `tauri` (Rust crate) | MIT/Apache-2.0 | Yes |
| `tauri-plugin-notification` (Rust) | MIT/Apache-2.0 | Yes |
| `tauri-plugin-updater` (Rust) | MIT/Apache-2.0 | Yes |
| `tauri-plugin-shell` (Rust) | MIT/Apache-2.0 | Yes |
| `serde` | MIT/Apache-2.0 | Yes |
| `serde_json` | MIT/Apache-2.0 | Yes |

All dependencies are MIT-compatible.

---

## Summary

| Task | Description | Files | Estimated LOC |
|------|-------------|-------|---------------|
| 1 | Daemon HTTP API | 3 new/edit | ~250 |
| 2 | Scaffold Tauri v2 | 8 new | ~400 (Rust) + ~80 (config) |
| 3 | React webview setup | 8 new | ~350 |
| 4 | Hooks | 3 new | ~200 |
| 5 | Settings pages | 6 new | ~650 |
| 6 | Approval dialog | 1 new | ~120 |
| 7 | Tray + notifications | 2 edit | ~30 |
| 8 | Build + installers | 3 edit | ~30 |
| **Total** | | **~34 files** | **~2,110** |
