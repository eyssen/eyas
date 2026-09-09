# eYssen EYAS Hand — Design Specification

**Date:** 2026-04-08
**Status:** Approved
**Repo:** `eyas-hand` (separate repository, alongside `eyas`)

## 1. Overview

eYssen EYAS Hand is a cross-platform companion application that extends EYAS's reach to local machines. It runs on the user's desktop or server, connects outbound to the EYAS server via WebSocket ("phone home" model), and enables EYAS agents to execute CLI commands, automate OS-level actions, and control GUI applications on the remote machine.

### Key Principles

- **Outbound-only:** Hand always initiates the connection — never listens on a port
- **Permission-first:** Hybrid whitelist + dynamic approval model
- **Cross-platform:** macOS, Windows, Linux
- **Triple interface:** GUI (Tauri v2) for desktops, TUI (Ink/React) for terminals, headless CLI daemon for servers
- **Graduated capabilities:** CLI tools → OS Automation → Computer Use (phased rollout)

## 2. Architecture

### Monorepo Structure

```
eyas-hand/
  packages/
    protocol/        @eyas/hand-protocol — shared types (used by both eyas and eyas-hand)
    core/            TypeScript (Bun/Node) — platform-independent logic
      connection/    WebSocket client (phone home, reconnect, heartbeat)
      executor/      Tool execution engine (spawn, sandbox, streaming)
      discovery/     Installed program scanner (CLI + apps)
      permissions/   Hybrid permission engine (whitelist + dynamic approval)
      os-adapter/    Platform-specific layer (interface + implementations)
      config/        YAML config management (Zod validation)
    tui/             Ink (React in terminal) — interactive TUI
    gui/             Tauri v2 shell — webview + tray icon + native notifications
```

### Deployment Diagram

```
Hand (user's machine)                    EYAS (server/cloud)
┌─────────────────────┐                  ┌──────────────────────┐
│  core daemon        │  ── WSS/TLS ──► │  hand-hub module     │
│  + tui or gui shell │  (outbound)      │  (new EYAS module)   │
└─────────────────────┘                  └──────────────────────┘
```

- One EYAS server can have multiple Hands connected (MacBook + Linux server + Windows workstation)
- Hand never accepts inbound connections

## 3. Communication Protocol

### Connection Establishment

1. Hand opens WSS connection to `wss://<eyas-host>/api/v1/hand/ws`
2. Headers: `Authorization: Bearer <pairing-token>`, `X-Hand-Id`, `X-Hand-Platform`
3. EYAS sends `auth:challenge` (nonce)
4. Hand responds with `auth:response` (HMAC)
5. EYAS confirms `hand:connected`
6. Hand sends `hand:capabilities` (platform, tools, permissions)
7. Persistent connection with ping/pong heartbeat every 30s
8. Auto-reconnect with exponential backoff on disconnect

### Pairing (First Time)

- **GUI mode:** EYAS web UI generates a 6-digit code → enter in Hand GUI
- **CLI mode:** `hand pair --url wss://eyas.example.com --code 482916`
- Result: long-lived token stored securely (macOS Keychain, Windows Credential Manager, Linux libsecret)

### Message Format

```typescript
interface HandMessage {
  id: string;           // nanoid — request/response correlation
  type: string;         // "category:action" format
  replyTo?: string;     // points to original id if response
  payload: unknown;     // type-dependent content
  timestamp: number;    // unix ms
}
```

### Message Types

| Direction    | Type              | Description                                    |
|-------------|-------------------|------------------------------------------------|
| EYAS → Hand | `exec:command`    | Execute CLI command                            |
| Hand → EYAS | `exec:result`     | Command result (exitCode, stdout, stderr)      |
| EYAS → Hand | `exec:stream`     | Start streaming long-running command           |
| Hand → EYAS | `exec:chunk`      | Stream output chunk                            |
| EYAS → Hand | `os:action`       | OS Automation action (Phase 2)                 |
| Hand → EYAS | `os:result`       | OS action result                               |
| EYAS → Hand | `screen:capture`  | Screenshot request (Phase 3)                   |
| Hand → EYAS | `screen:image`    | Screenshot (base64 or binary frame)            |
| EYAS → Hand | `input:mouse`     | Mouse move/click (Phase 3)                     |
| EYAS → Hand | `input:keyboard`  | Keystroke simulation (Phase 3)                 |
| EYAS → Hand | `fs:read`         | Read file                                      |
| EYAS → Hand | `fs:write`        | Write file                                     |
| EYAS → Hand | `fs:list`         | List directory                                 |
| Hand → EYAS | `fs:result`       | File operation result                          |
| EYAS → Hand | `approval:request`| Request user approval                          |
| Hand → EYAS | `approval:response`| User decision (allow/deny/always)             |
| Hand → EYAS | `hand:capabilities`| Hand capabilities report                      |
| Both        | `ping` / `pong`  | Heartbeat                                      |

### Capability Exchange

```typescript
interface HandCapabilities {
  handId: string;
  name: string;                    // "Krisztian MacBook Pro"
  platform: 'darwin' | 'win32' | 'linux';
  arch: 'x64' | 'arm64';
  osVersion: string;
  capabilities: {
    cli: boolean;                  // Phase 1 — always true
    osAutomation: boolean;         // Phase 2
    computerUse: boolean;          // Phase 3
  };
  discoveredTools: ToolInfo[];
  permissions: PermissionSummary;
}
```

## 4. Permission System

### Three Layers

1. **EYAS side (hand-hub):** Who can do what on which Hand? CASL rules, per user/agent.
2. **Hand side — static whitelist:** What is allowed AT ALL on this machine? Config-based (TUI/GUI).
3. **Hand side — dynamic approval:** Anything not on whitelist → real-time user approval.

### Static Configuration

```yaml
# ~/.eyas-hand/config.yaml
hand:
  name: "Krisztian MacBook Pro"
  eyas_url: "wss://eyas.example.com/api/v1/hand/ws"

permissions:
  directories:
    - path: "~/Projects"
      access: read-write
    - path: "~/Documents"
      access: read-only
    - path: "~/Downloads"
      access: read-write
    - path: "/tmp"
      access: read-write

  cli:
    allowed: [git, ffmpeg, docker, node, python3, brew]
    blocked: [rm, sudo, diskutil]

  apps:
    allowed:
      - "com.apple.Preview"
      - "com.apple.Mail"
    blocked:
      - "com.apple.systempreferences"

  computer_use:
    enabled: true
    require_approval_per_session: true

  safety:
    max_concurrent_commands: 5
    command_timeout_seconds: 300
    block_destructive_by_default: true
    require_approval_for_network: true
```

### Risk Tiers

| Tier      | Color  | Behavior                                                  | Examples                              |
|-----------|--------|----------------------------------------------------------|---------------------------------------|
| **green** | Green  | Whitelisted → execute, no prompt                         | `git status`, read allowed directory  |
| **yellow**| Yellow | Not whitelisted → approval request                       | `curl`, unknown CLI, new app launch   |
| **red**   | Red    | Always approval, cannot auto-learn                       | `sudo`, file deletion, Computer Use   |
| **black** | Black  | Always blocked, no approval option                       | `rm -rf /`, `format`, `dd`            |

### Dynamic Approval Flow

1. EYAS requests action not on whitelist
2. Hand permission engine classifies as yellow/red
3. Hand shows approval notification (GUI: native popup, TUI: inline prompt)
4. User decides: Allow Once / Always Allow / Deny
5. "Always Allow" → tool added to `learned` section in config (removable via TUI/GUI)
6. Red tier items cannot be "Always Allow"-ed

### Auto-Learn

```yaml
permissions:
  cli:
    learned:
      - tool: curl
        learned_at: "2026-04-08T14:32:00Z"
        context: "API research"
```

Learned rules are shown separately in TUI/GUI and can be revoked anytime.

## 5. Tool Discovery and Execution

### Discovery Engine

1. **CLI Scanner:** Walk PATH, `which`/`where` for known tools, version detection (`--version`)
2. **App Scanner:** Platform-specific — macOS: `/Applications` + `mdfind`, Windows: Registry + Program Files, Linux: `.desktop` files + package managers
3. **Capability Mapper:** Three sources (priority order):
   - Built-in `tool-catalog.yaml` (~100 common tools with descriptions)
   - Tool self-description (`--help` → AI summary, cached)
   - User annotation via TUI/GUI

### Discovered Tool Model

```typescript
interface DiscoveredTool {
  id: string;              // "ffmpeg", "com.apple.Preview"
  name: string;            // "FFmpeg"
  type: 'cli' | 'app';
  path: string;            // "/opt/homebrew/bin/ffmpeg"
  version?: string;
  platform: string;
  capabilities: string[];  // ["video-convert", "audio-extract"]
  permissionTier: 'green' | 'yellow' | 'red' | 'black';
}
```

### Execution Engine

```
EYAS request arrives
    → Permission Check (whitelist / blacklist / approval)
    → Sandbox (allowed working directory, timeout, filtered env)
    → Execute:
        Phase 1: child_process.spawn()
        Phase 2: os-adapter (JXA / PowerShell / D-Bus)
        Phase 3: screenshot → AI → input events
    → Result back to EYAS (stream or buffer)
```

### OS Adapter Interface (Phase 2)

```typescript
interface OsAdapter {
  launchApp(bundleId: string, args?: string[]): Promise<void>;
  listRunningApps(): Promise<AppInfo[]>;
  focusApp(bundleId: string): Promise<void>;
  listWindows(): Promise<WindowInfo[]>;
  moveWindow(windowId: number, rect: Rect): Promise<void>;
  setVolume(percent: number): Promise<void>;
  getClipboard(): Promise<string>;
  setClipboard(text: string): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  openFileWith(path: string, appId: string): Promise<void>;
}

// Implementations:
// darwin:  JXA (JavaScript for Automation) + osascript
// win32:   PowerShell + COM / UI Automation API
// linux:   D-Bus + xdg-open + xdotool/ydotool
```

### Computer Use Adapter Interface (Phase 3)

```typescript
interface ComputerUseAdapter {
  captureScreen(region?: Rect): Promise<Buffer>;
  captureWindow(windowId: number): Promise<Buffer>;
  moveMouse(x: number, y: number): Promise<void>;
  click(button: 'left' | 'right' | 'middle'): Promise<void>;
  doubleClick(): Promise<void>;
  drag(from: Point, to: Point): Promise<void>;
  scroll(deltaX: number, deltaY: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string, modifiers?: string[]): Promise<void>;
  getScreenSize(): Promise<{ width: number; height: number }>;
  getCursorPosition(): Promise<Point>;
}
```

### Execution Priority

The Hand always prefers the fastest and most reliable method:

1. CLI command available? → Phase 1 (fastest, most secure)
2. OS Automation API available? → Phase 2 (fast, reliable)
3. Neither? → Phase 3 Computer Use (slow but universal)

## 6. User Interfaces

### TUI (Ink/React — `hand --tui`)

Interactive terminal UI with arrow-key navigation:

- **Main menu:** Connection, Permissions, Discovery, Activity, Settings, Quit
- **Permissions:** Sub-menus for Directories, CLI Tools, Apps — add/remove/toggle
- **Discovery:** View discovered tools with version and capability info
- **Activity:** Recent commands log with status
- **Approval popups:** Inline terminal notification with [A]llow / [M]always / [D]eny

### GUI (Tauri v2)

- System tray icon with status indicator (connected/disconnected/paused)
- Tray menu: Open Settings, Activity Log, Pause/Disconnect, Quit
- Settings window: shadcn/ui, following EYAS design language
  - Tabs: Connection, Directories, CLI Tools, Apps, Computer Use, Activity
  - Learned rules section with remove buttons
- Native OS notifications for approval requests with action buttons

### Headless CLI (servers)

```bash
hand pair --url wss://eyas.example.com --code 482916
hand serve [--daemon]
hand status
hand config set permissions.cli.allowed --add kubectl
hand config set permissions.approval_mode fallback_deny|fallback_allow
```

## 7. EYAS-Side Integration (hand-hub Module)

### Module: `src/modules/hand-hub/`

```typescript
{
  id: 'hand-hub',
  name: 'Hand Hub',
  type: 'core',
  dependencies: ['http', 'websocket', 'auth', 'permissions'],
  capabilities: ['hand-management', 'remote-execution'],
}
```

### Components

| File                | Responsibility                                              |
|---------------------|-------------------------------------------------------------|
| `hand-registry.ts`  | Connected Hands registry, capability cache                  |
| `hand-router.ts`    | Route requests to correct Hand (capability/path/preference) |
| `hand-ws-handler.ts`| WebSocket endpoint `/api/v1/hand/ws`, auth, heartbeat       |
| `hand-pairing.ts`   | Pairing code generation, token issuance                     |
| `hand-tools.ts`     | Convert Hand capabilities to EYAS tool registry entries     |

### Routing Logic

When an EYAS agent requests an action:

1. **Explicit target:** Agent or user specifies which Hand
2. **Path-based:** Which Hand has the requested directory?
3. **Capability-based:** Which Hand has the required tool installed?
4. **Fallback:** Ask the user which Hand to use

### EYAS Frontend

Settings > Hands page:
- List connected Hands with status, platform, tool count
- Generate pairing code button
- Per-Hand detail view (capabilities, permissions, activity)
- Disconnect / Revoke actions

### Shared Protocol Package

`@eyas/hand-protocol` — npm package or git submodule, used by both repos:
- `messages.ts` — all message type definitions
- `capabilities.ts` — capability interfaces
- `permissions.ts` — permission types
- `constants.ts` — protocol version, timeouts, defaults

## 8. Implementation Phases

| Phase | Scope                  | Deliverables                                                                     |
|-------|------------------------|----------------------------------------------------------------------------------|
| **1** | Core + CLI execution   | `core` package, `tui`, `hand serve` daemon, CLI discovery + execution, `hand-hub` EYAS module, pairing flow, EYAS frontend Hands page |
| **2** | OS Automation          | `os-adapter` implementations (macOS JXA, Windows PowerShell, Linux D-Bus), app discovery, app control (launch, focus, window management, clipboard) |
| **3** | Computer Use           | Screenshot capture, mouse/keyboard input simulation, AI-driven screen interaction loop, Computer Use permission layer |
| **4** | GUI app (Tauri v2)     | Tauri shell, system tray, native approval notifications, settings webview, auto-updater, platform installers (DMG, MSI, deb) |

Phase 1 is independently usable. Phases 2-4 can be developed in parallel after Phase 1.

## 9. Security Considerations

- **Token storage:** Platform secure storage (Keychain, Credential Manager, libsecret)
- **Transport:** WSS/TLS only — no plaintext WebSocket
- **Auth:** Challenge-response on every connection, not just token presentation
- **Sandbox:** Commands run in allowed directories only, with timeout and env filtering
- **No inbound ports:** Hand never listens — only outbound connections
- **Black tier:** Destructive commands permanently blocked, no override
- **Audit:** Every executed command logged with timestamp, user, result
- **Rate limiting:** Max concurrent commands configurable
- **Environment filtering:** API keys, tokens stripped from child process env by default

## 10. Tech Stack Summary

| Component     | Technology                          |
|---------------|-------------------------------------|
| Core daemon   | TypeScript, Bun (primary) / Node.js |
| TUI           | Ink (React in terminal)             |
| GUI           | Tauri v2 (Rust shell + webview)     |
| GUI frontend  | React + shadcn/ui + Tailwind        |
| Config        | YAML + Zod validation               |
| Protocol      | WebSocket (JSON messages)            |
| EYAS module   | TypeScript (hand-hub)               |
| Shared types  | @eyas/hand-protocol (npm package)   |
