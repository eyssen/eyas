# Enhanced Provider Management Design

> EYAS 1.0 — Full provider settings, dynamic model lists, hot-reload, Claude Code CLI provider

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Claude Code provider | `@anthropic-ai/claude-code` SDK | Uses locally installed CLI session (OAuth/Max/API key) |
| Config storage | SQLite tables | provider_config + model_config tables for enable/disable state |
| Model list | Cache in DB + Refresh button | API fetch on demand, cached for fast reads, hardcoded fallback |
| Hot-reload | Per-provider reload endpoint | `POST /api/v1/model/providers/:id/reload` — no full restart needed |
| Frontend panel | Slideout panel (50% width) | Provider detail slides from right, list stays visible |

## Backend Changes

### New Database Tables

```sql
CREATE TABLE IF NOT EXISTS provider_config (
  id TEXT PRIMARY KEY,              -- 'anthropic', 'openai', 'openrouter', 'gemini', 'claude-code'
  enabled INTEGER NOT NULL DEFAULT 1,
  settings TEXT DEFAULT '{}',       -- JSON for provider-specific settings
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_config (
  id TEXT PRIMARY KEY,              -- 'anthropic:claude-sonnet-4-5-20250514'
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  context_window INTEGER,
  max_output_tokens INTEGER,
  supports_tools INTEGER DEFAULT 1,
  supports_images INTEGER DEFAULT 1,
  supports_streaming INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES provider_config(id)
);
```

The `model_config` table serves as the cached model list. When the user clicks "Refresh", the backend fetches from the provider API and upserts rows. The `enabled` flag controls whether the model is available via the gateway.

### New Provider: Claude Code CLI

New submodule at `src/modules/model/submodules/claude-code/`:

```typescript
interface ClaudeCodeProviderConfig {
  cliPath?: string      // default: 'claude' (from PATH)
  maxTurns?: number     // default: 1 for simple completions
}
```

- Uses `@anthropic-ai/claude-code` SDK (the `claude` npm package)
- No API key needed — uses the CLI's own authenticated session
- The provider checks if `claude` is available on PATH at startup
- If not found, the provider logs a warning and doesn't register
- `listModels()` returns the models available through the CLI session
- `complete()` and `stream()` spawn a Claude Code subprocess per request

The `provider_config` row for `claude-code` has `enabled: true` by default. No secret needed — activation depends only on CLI availability.

### Dynamic Model List Fetching

Each provider gets a new method on the `AIProvider` interface:

```typescript
interface AIProvider {
  // ... existing methods ...
  fetchModels?(): Promise<ModelInfo[]>  // Optional: fetch from API (not cached)
}
```

- `listModels()` — reads from `model_config` table (cached, fast)
- `fetchModels()` — calls the provider API directly (slow, fresh data)
- If `model_config` is empty for a provider, `listModels()` falls back to hardcoded defaults

Provider-specific fetch implementations:

| Provider | API Endpoint | Notes |
|----------|-------------|-------|
| Anthropic | Not available via API | Uses hardcoded list only |
| OpenAI | `GET /v1/models` | Filters to chat completion models |
| OpenRouter | `GET /api/v1/models` | Returns 100+ models with pricing |
| Gemini | `models.list()` via SDK | Filters to generateContent-capable |
| Claude Code | CLI introspection | Lists models from CLI session |

### New/Modified API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/model/providers` | List all providers with config (enabled, has API key, model count) |
| GET | `/api/v1/model/providers/:id` | Provider detail: config + model list from DB |
| PATCH | `/api/v1/model/providers/:id` | Update provider config (enabled, settings) |
| POST | `/api/v1/model/providers/:id/reload` | Hot-reload: re-check API key, re-register |
| POST | `/api/v1/model/providers/:id/models/refresh` | Fetch models from API, upsert into model_config |
| PATCH | `/api/v1/model/providers/:id/models/:modelId` | Update model config (enabled) |

### Modified Provider List Response

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic Claude API",
      "enabled": true,
      "active": true,
      "hasApiKey": true,
      "modelCount": 4,
      "enabledModelCount": 3
    },
    {
      "id": "claude-code",
      "name": "Claude Code CLI",
      "enabled": true,
      "active": true,
      "hasApiKey": null,
      "modelCount": 2,
      "enabledModelCount": 2
    }
  ]
}
```

`active` = enabled AND (has API key OR no key needed). `hasApiKey: null` means the provider doesn't use API keys.

### Hot-Reload Flow

`POST /api/v1/model/providers/:id/reload`:

1. Unregister the provider from the gateway (if registered)
2. Check `provider_config.enabled` — if false, stop here
3. Check API key in secrets (if needed by this provider type)
4. If key exists (or not needed), create new provider instance, register on gateway
5. Return updated provider status

### Gateway Changes

The `ModelGateway` needs:
- `unregisterProvider(id: string): void` — remove a provider
- Modified `complete()`/`stream()` — check `model_config.enabled` before dispatching
- Model lookup respects enabled flags from DB

### Submodule onStart Changes

Each submodule's `onStart` now:
1. Reads `provider_config` from DB (create row if missing with defaults)
2. If `enabled: false`, skip
3. Check API key (if applicable)
4. Register provider on gateway
5. If `model_config` is empty for this provider, populate from hardcoded defaults

## Frontend Changes

### Provider List Page (`/providers`)

Shows all 5 providers as cards (existing 4 + Claude Code). Each card shows:
- Provider name + icon
- Status: Active (green) / Inactive (gray) / Disabled (muted)
- Enable/disable toggle (calls `PATCH /api/v1/model/providers/:id`)
- "Has API key" indicator (except Claude Code which shows "CLI session")
- Model count (enabled / total)
- Click anywhere on card opens slideout panel

### Provider Slideout Panel

Slides in from the right, 50% width, overlays the provider list (which stays visible behind, dimmed).

**Sections:**

1. **Header** — Provider name, close button, enable/disable toggle
2. **API Key** (hidden for Claude Code)
   - Password input field
   - "Save API Key" button → `POST /api/v1/secrets` then `POST /providers/:id/reload`
   - "Remove API Key" button → `DELETE /api/v1/secrets/...` then `POST /providers/:id/reload`
   - Status indicator: "Key saved" / "No key"
3. **Status** — Active/inactive, last reload time
4. **Models**
   - "Refresh from API" button → `POST /providers/:id/models/refresh`
   - Table/list of models:
     - Model name
     - Model ID (monospace)
     - Context window
     - Capabilities (tools, images, streaming) as small badges
     - Enable/disable toggle per model

### Route Changes

No new route needed — the slideout panel is a component within `/providers`, controlled by state (selected provider ID).

### Component Structure

```
src/web/src/pages/providers/
  providers-page.tsx              ← Provider grid + slideout state
  provider-card.tsx               ← Individual provider card
  provider-panel.tsx              ← Slideout panel container
  provider-api-key-section.tsx    ← API key management
  provider-models-section.tsx     ← Model list with toggles
```

## New Dependency

| Package | License | Purpose |
|---------|---------|---------|
| `@anthropic-ai/claude-code` | MIT | Claude Code CLI SDK |

## Not In Scope

- Provider priority/ordering for routing
- Per-model pricing display (future: budget module)
- Custom model parameters per provider (temperature defaults, etc.)
- Model aliases ("fast", "smart", etc.)
- Provider health monitoring / auto-disable on errors
- Event bus auto-reload (future: when event bus is implemented)
