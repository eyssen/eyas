# Memory & Knowledge Module Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Modules:** `memory`, `knowledge`, shared `wikilinks`

---

## 1. Overview

Two new modules for EYAS 1.0:

- **Memory** — 5-tier hybrid AI memory system (DB + Vault markdown) with salience decay, temporal facts, implicit extraction, and Auto Dream consolidation.
- **Knowledge** — Universal wiki with Plate (shadcn/ui) editor, hierarchical pages, AI-assisted editing, and bidirectional `[[wikilink]]` support.

Both share a common wikilink graph and hybrid search infrastructure.

### Design Decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Memory ↔ Knowledge relation | Separate stores, shared graph | Each optimized for its strength; graph + search unifies them |
| Knowledge scope | Universal wiki | No restrictions — freely structured spaces |
| Content creation flow | Knowledge-initiated + Conversation-saved + Auto Dream suggestions | All three paths to maximize content capture |
| Embedding strategy | FTS-first, embedding optional via model module | Zero setup required; vector auto-activates when model can embed |
| Auto Dream timing | Hybrid: event-driven extraction + daily consolidation | Immediate facts + deep weekly analysis |
| Frontend layout | EYAS sidebar integration (collapsible group) | Consistent with existing Settings pattern |
| Editor | Plate (udecode) | MIT, shadcn/ui native, React 19, AI plugin, TypeScript, 15k+ stars |

---

## 2. Memory Module

### 2.1 Five-Tier Architecture

| Tier | Storage | Format | Purpose | Lifespan | Search |
|------|---------|--------|---------|----------|--------|
| **Working** | DB | JSON | Session context, labeled blocks (`user_context`, `current_task`, `preferences`) | 24h TTL | Direct lookup |
| **Episodic** | DB | JSON | What happened — events, facts, conversation extracts | Salience decay | FTS + vector (if available) |
| **Semantic** | Vault `.md` | Markdown + frontmatter + `[[links]]` | What I know — knowledge | Long-term | FTS + vector + graph |
| **Procedural** | Vault `.md` | Markdown recipes/templates | How I do things | Long-term | FTS + vector + graph |
| **Archive** | DB | Compressed JSON | Low salience, not deleted | Infinite | FTS |

### 2.2 Working Memory — Labeled Blocks

Inspired by Letta/MemGPT Memory Blocks. Always injected into system prompt.

```typescript
interface WorkingMemoryBlock {
  key: string          // 'user_context' | 'current_task' | 'preferences' | custom
  content: string      // Text content (always in prompt)
  maxTokens: number    // Per-block limit
  updatedAt: string
}
```

The AI reads/writes blocks via tools: `memory.getBlock(key)`, `memory.updateBlock(key, content)`.

**DB table:**

```sql
CREATE TABLE IF NOT EXISTS working_memory (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  max_tokens INTEGER DEFAULT 500,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL          -- 24h TTL, auto-cleanup
);
```

### 2.3 Episodic Memory — Temporal Facts

Inspired by Zep/Graphiti temporal knowledge. Facts have validity windows — never deleted, only invalidated.

```sql
CREATE TABLE IF NOT EXISTS episodic_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,       -- 'conversation' | 'extraction' | 'user' | 'system'
  source_id TEXT,                  -- Conversation ID or other source
  salience REAL DEFAULT 1.0,      -- Relevance score (decays over time)
  access_count INTEGER DEFAULT 0,
  valid_from TEXT NOT NULL,        -- When this fact became true
  valid_until TEXT,                -- When it stopped being true (NULL = still valid)
  tags TEXT,                       -- JSON string[]
  embedding TEXT,                  -- Vector embedding (if available)
  embedding_hash TEXT,             -- Cache key for re-embedding
  created_at TEXT NOT NULL,
  last_accessed_at TEXT
);

CREATE INDEX idx_episodic_salience ON episodic_memories(salience DESC);
CREATE INDEX idx_episodic_valid ON episodic_memories(valid_from, valid_until);
```

### 2.4 Archive Memory

```sql
CREATE TABLE IF NOT EXISTS archive_memories (
  id TEXT PRIMARY KEY,
  original_id TEXT NOT NULL,       -- Original episodic ID
  content TEXT NOT NULL,           -- Compressed/summarized
  source_type TEXT NOT NULL,
  tags TEXT,
  archived_at TEXT NOT NULL,
  original_created_at TEXT NOT NULL
);
```

### 2.5 Vault Structure (Semantic + Procedural)

```
data/vault/
├── semantic/                      # Knowledge notes
│   ├── kubernetes-networking.md
│   └── odoo-workflow-engine.md
├── procedural/                    # Recipes, how-to guides
│   ├── deploy-to-oke.md
│   └── debug-sqlite-locks.md
├── projects/                      # Project-specific knowledge
│   └── eyas/
│       └── architecture-decisions.md
└── .vault-index.json              # Link graph cache (regeneratable)
```

**Vault file format:**

```markdown
---
title: Kubernetes Networking
tags: [kubernetes, networking, infrastructure]
tier: semantic
links: [odoo-deployment, oke-cluster]
created: 2026-04-02
updated: 2026-04-02
embedding_hash: abc123
---

# Kubernetes Networking
Content with [[wikilink]] links...
```

**Vault indexing:** Files are parsed on startup and watched for changes (`fs.watch`). Metadata, text, and links are indexed into SQLite (FTS5) and optionally embedded for vector search.

```sql
CREATE TABLE IF NOT EXISTS vault_index (
  path TEXT PRIMARY KEY,           -- Relative path within data/vault/
  title TEXT NOT NULL,
  tier TEXT NOT NULL,              -- 'semantic' | 'procedural'
  tags TEXT,                       -- JSON string[]
  content_text TEXT NOT NULL,      -- Plain text for FTS
  embedding TEXT,                  -- Vector (if available)
  embedding_hash TEXT,
  file_hash TEXT NOT NULL,         -- For change detection
  indexed_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE vault_fts USING fts5(
  path, title, content_text,
  content='vault_index',
  content_rowid='rowid'
);
```

### 2.6 Salience Decay + Promotion/Demotion

```
Working (24h TTL)
    │ session end
    ▼
Episodic (salience decay)
    │ high salience + repetition     │ low salience + old
    ▼                                ▼
Semantic (vault .md)                 Archive (compressed)
    ↕ user manual editing
Procedural (vault .md)
```

**Decay formula:** `salience *= 0.95 ^ days_since_last_access`

**Promotion rule:** `salience > 0.7 AND access_count > 3` → LLM summarizes → create/update vault `.md` file in semantic tier.

**Demotion rule:** `salience < 0.2 AND age > 30 days` → compress content → move to archive.

### 2.7 Auto Dream — Hybrid Consolidation

#### Event-driven (conversation end)

1. Bus event: `conversation:completed` or after N messages
2. LLM prompt (haiku-tier model): "What new facts did you learn from this conversation?"
3. Result → episodic tier (`source_type='extraction'`, `salience=1.0`)
4. Fast, small LLM call — runs inline

#### Scheduler (daily, configurable)

1. Apply salience decay to all episodic records
2. High salience + repeated → LLM summarizes → vault `.md` file (semantic promotion)
3. Similar records → merge (LLM deduplication)
4. Low salience + old → compress → archive
5. Rebuild vault index
6. Optionally: suggest Knowledge page if a topic is rich enough
7. Log consolidation results for audit

---

## 3. Hybrid Search & Wikilink Graph

### 3.1 Search Layers

Three signal sources combined with Reciprocal Rank Fusion (RRF):

```
Query
  ├── [1] FTS5 (SQLite) + Orama FTS → exact text match
  ├── [2] Vector search (Orama vectors) → semantic similarity (if available)
  └── [3] Wikilink graph traversal → related content (1-hop neighbors)
      │
      ▼
  RRF Score Fusion (k=60) → Top-K results
      │
      ▼
  Context Builder → ordered, deduplicated context for AI prompt
```

### 3.2 FTS-First Strategy

```typescript
interface SearchCapabilities {
  fts: true                    // Always available (Orama + SQLite FTS5)
  vector: boolean              // Auto-true when model module can embed
  graph: true                  // Always available (wikilink index)
}
```

- Default: FTS + graph (zero config)
- If model module has embedding-capable provider → vector search auto-activates
- `hybrid-search.ts` queries model module: `ctx.model.canEmbed()` — if true, vector runs too

### 3.3 Query Routing Heuristic

```typescript
// Short, exact query → prefer FTS (higher FTS weight)
// "error 0x80004005", "deploy-to-oke"
if (query.wordCount <= 3 && !query.isQuestion) → ftsWeight: 0.7, vectorWeight: 0.3

// Long, question-like → prefer vector
// "how do I debug a slow SQLite query"
if (query.isQuestion || query.wordCount > 5) → ftsWeight: 0.3, vectorWeight: 0.7

// Default → equal weight
ftsWeight: 0.5, vectorWeight: 0.5
```

### 3.4 Wikilink Graph (Shared)

Single table linking both Memory Vault files and Knowledge pages:

```sql
CREATE TABLE IF NOT EXISTS wikilinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,      -- 'vault' | 'knowledge'
  source_id TEXT NOT NULL,        -- vault: relative path, knowledge: page_id
  target_type TEXT NOT NULL,      -- 'vault' | 'knowledge'
  target_id TEXT NOT NULL,
  context TEXT,                   -- Surrounding text snippet (backlink preview)
  created_at TEXT NOT NULL
);

CREATE INDEX idx_wikilinks_source ON wikilinks(source_type, source_id);
CREATE INDEX idx_wikilinks_target ON wikilinks(target_type, target_id);
```

**Graph search:** When an FTS/vector result is relevant, its 1-hop neighbors get a bonus score in RRF fusion. Non-recursive (1 step only) to keep cost low.

### 3.5 Context Builder

Runs automatically before AI queries, injecting relevant memories/knowledge into system prompt:

```typescript
interface ContextBuildResult {
  workingBlocks: WorkingMemoryBlock[]    // Always included
  relevantMemories: RankedMemory[]       // Top-K episodic/semantic hits
  knowledgeSnippets: RankedSnippet[]     // Top-K Knowledge page excerpts
  totalTokens: number                    // Token budget tracking
  sources: ContextSource[]               // Audit: what came from where
}
```

**Token budget priority (configurable, default 4000 tokens):**
1. Working memory blocks (always)
2. Freshest / highest salience episodic memories
3. Best FTS/vector hits (vault + knowledge)
4. Graph neighbors (if space remains)

### 3.6 Embedding Bridge

```typescript
// memory/embeddings/model-bridge.ts
interface EmbeddingBridge {
  canEmbed(): boolean              // Asks model module
  embed(texts: string[]): Promise<number[][]>  // Batch embedding via model module
  dimensions(): number             // Embedding dimensions (provider-dependent)
}
```

No separate embedding config. Uses the model module's active provider — if it supports embeddings (e.g., OpenAI, Voyage, Ollama with embedding model), vector search is available.

---

## 4. Knowledge Module

### 4.1 Core Concept

Universal wiki with Plate (shadcn/ui) block editor. Freely structured spaces, hierarchical page tree. AI and user can both create and edit pages. Three content creation paths:

1. **Knowledge-initiated exploration** — "Generate page on topic X" → opens Conversation → AI researches → saves as page
2. **Conversation → Knowledge** — save conversation excerpts as structured Knowledge page
3. **Auto Dream suggestion** — when a topic appears frequently in episodic memory, suggest creating a Knowledge page

### 4.2 DB Schema

```sql
CREATE TABLE IF NOT EXISTS knowledge_spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,                       -- Emoji or icon name
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_pages (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES knowledge_spaces(id),
  parent_id TEXT REFERENCES knowledge_pages(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content_json TEXT NOT NULL,       -- Plate/Slate document model (JSON)
  content_text TEXT NOT NULL,       -- Plain text extract (for FTS index)
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  is_template BOOLEAN DEFAULT FALSE,
  source_conversation_id TEXT,     -- If created from conversation
  created_by TEXT REFERENCES users(id),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT                   -- Soft delete
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES knowledge_pages(id),
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  content_text TEXT NOT NULL,
  changed_by TEXT,                  -- User ID or 'system' (AI)
  change_summary TEXT,             -- What changed (AI-generated)
  created_at TEXT NOT NULL
);

-- External content FTS: manually synced on page insert/update/delete
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title, content_text,
  content='',                      -- External content mode (no auto-sync)
  content_rowid='rowid'
);
```

### 4.3 Wikilink Integration

`[[wikilink]]` syntax in Knowledge pages, rendered as custom Plate inline element:

```typescript
interface WikilinkElement {
  type: 'wikilink'
  targetType: 'knowledge' | 'vault'
  targetId: string
  displayText: string
  children: [{ text: '' }]         // Slate leaf requirement
}
```

On save, wikilinks are synced to the shared `wikilinks` table. Backlink panel shows which other pages/vault files reference the current page.

### 4.4 AI Operations

Slash commands in the Plate editor, routed through the EYAS model module:

| Command | Description |
|---------|-------------|
| `/ai-generate` | Generate page content for a given topic |
| `/ai-expand` | Expand a selected section with more detail |
| `/ai-summarize` | Summarize content |
| `/ai-translate` | Translate (Hungarian ↔ English) |
| `/ai-update` | Update content based on new information |
| `/ai-explore` | Start exploration → open Conversation |

### 4.5 Exploration Flow

```
User: "Document our K8s cluster" (from Knowledge UI or command)
  │
  ▼
Knowledge module → create Conversation (source_type='exploration')
  │
  ▼
AI in Conversation: asks questions, researches, uses tools
  │
  ▼
On Conversation close:
  ├── Result → Knowledge page (content_json, Plate format)
  ├── source_conversation_id set → traceable
  └── Page is further editable (AI or user)
```

### 4.6 Conversation → Knowledge Save

From any conversation:
1. User selects relevant messages (or entire conversation)
2. "Save as Knowledge page" action
3. AI structures and formats into Plate JSON
4. New page in chosen space, `source_conversation_id` set

### 4.7 API Endpoints

```
GET    /api/v1/knowledge/spaces              — List spaces
POST   /api/v1/knowledge/spaces              — Create space
PATCH  /api/v1/knowledge/spaces/:id          — Update space
DELETE /api/v1/knowledge/spaces/:id          — Delete space

GET    /api/v1/knowledge/pages               — List pages (tree or flat)
GET    /api/v1/knowledge/pages/:id           — Get page
POST   /api/v1/knowledge/pages               — Create page
PATCH  /api/v1/knowledge/pages/:id           — Update page
DELETE /api/v1/knowledge/pages/:id           — Soft delete

GET    /api/v1/knowledge/pages/:id/versions  — Version history
GET    /api/v1/knowledge/pages/:id/backlinks — Backlinks
POST   /api/v1/knowledge/pages/:id/ai        — AI operation (generate/expand/summarize/translate)
POST   /api/v1/knowledge/explore             — Start exploration
POST   /api/v1/knowledge/from-conversation   — Conversation → Knowledge save
```

---

## 5. Frontend

### 5.1 Knowledge Sidebar Integration

Knowledge integrates as a collapsible group in the existing EYAS sidebar, between Navigation and Settings (following the same ChevronUp pattern).

**Sidebar structure:**
```
Navigation
  Dashboard
  Board
  New Conversation
  Conversations
Knowledge (collapsible)           ← NEW
  [Tree] [Recent] [Search] tabs
  Space: Infrastructure
    ▾ K8s Cluster
      Networking
      → Ingress Setup (active)
      Storage
    ▸ Odoo Deployment
  Space: Projects
    ▸ EYAS
  [+ New page]
Settings (collapsible)
  System, Projects, Providers...
```

### 5.2 Knowledge Page View

Main area when a Knowledge page is selected:
- **Breadcrumb:** Space › Parent › Page
- **Title row:** Page title + version badge + AI-edited indicator
- **Plate editor:** Full block editor with `[[wikilink]]` support, slash commands
- **Bottom panels:** Backlinks panel (knowledge + vault refs) + Version history panel

### 5.3 Editor: Plate (udecode)

**Why Plate:**
- MIT license (all plugins)
- Native shadcn/ui + Tailwind + Radix UI integration — exact EYAS stack match
- React 19 + React Compiler support
- AI plugin (MIT) with MCP support
- 50+ headless plugins, TypeScript native
- 15k+ GitHub stars, daily commits

**Plate plugins needed:**
- Core: heading, paragraph, list, blockquote, code-block, image, table
- Interaction: slash-command, mention (for `[[wikilink]]`)
- AI: plate-ai (for `/ai-*` commands)
- Custom: wikilink inline element

### 5.4 Memory Frontend

Memory does not need a dedicated page in Phase 1. Relevant surfaces:
- **Context Builder output** visible in Conversation debug panel
- **Memory stats** in Dashboard widget (tier sizes, embedding coverage)
- **Vault browser** as a tab in Knowledge sidebar (optional, future)

### 5.5 New Routes

```
/knowledge                        — Knowledge space/page browser (redirects to last page)
/knowledge/:spaceSlug/:pageSlug   — Specific page in editor
```

---

## 6. File Structure

```
src/modules/memory/
├── index.ts                       # EyasModule (id: 'memory')
├── types.ts                       # WorkingMemoryBlock, EpisodicMemory, VaultEntry
├── schema.ts                      # DB tables
├── memory-service.ts              # Unified API: save, retrieve, search
├── tiers/
│   ├── working-memory.ts          # Labeled blocks (24h TTL)
│   ├── episodic-memory.ts         # Facts + salience + temporal fields
│   └── archive-memory.ts          # Compressed, low relevance
├── vault/
│   ├── vault-service.ts           # Vault CRUD (read/write/delete .md files)
│   ├── vault-indexer.ts           # Markdown → DB index (FTS + metadata + links)
│   ├── vault-watcher.ts           # fs.watch — file change → reindex
│   ├── wikilink-parser.ts         # [[wikilink]] recognition
│   └── frontmatter.ts             # YAML frontmatter parse/serialize
├── search/
│   ├── hybrid-search.ts           # FTS + vector + graph combination (RRF)
│   ├── graph-search.ts            # [[wikilink]] graph traversal
│   └── context-builder.ts         # Inject relevant memories into AI prompt
├── embeddings/
│   ├── types.ts                   # EmbeddingProvider interface
│   └── model-bridge.ts            # Model module embedding request
├── consolidation/
│   ├── implicit-extractor.ts      # Conversation-end fact extraction (event-driven)
│   ├── auto-dream.ts              # Daily consolidation (scheduler)
│   └── decay.ts                   # Salience decay + promotion/demotion rules
├── routes.ts                      # API endpoints
└── tests/

src/modules/knowledge/
├── index.ts                       # EyasModule (id: 'knowledge')
├── types.ts                       # Space, Page, Version, WikilinkElement
├── schema.ts                      # DB tables
├── knowledge-service.ts           # CRUD, versioning
├── page-tree-service.ts           # Hierarchical tree operations
├── exploration-service.ts         # AI exploration → Conversation → Page
├── routes.ts                      # API endpoints
└── tests/

src/shared/
└── wikilinks.ts                   # Shared wikilink table + graph operations
```

---

## 7. Module Dependencies

```
memory:
  dependencies: ['model']           # Embedding bridge
  optional: ['conversations']       # Implicit fact extraction on conversation end
  optional: ['scheduler']           # Auto Dream cron

knowledge:
  dependencies: ['memory']          # Shared wikilink graph, hybrid search
  optional: ['conversations']       # Exploration flow, conversation → page save
  optional: ['model']               # AI slash commands
```

---

## 8. Configuration

```yaml
# config/personality/memory.yaml
memory:
  working:
    ttl_hours: 24
    default_blocks: ['user_context', 'current_task', 'preferences']
    max_tokens_per_block: 500
  episodic:
    decay_rate: 0.95
    promotion_threshold: 0.7
    promotion_min_access: 3
    demotion_threshold: 0.2
    demotion_age_days: 30
  vault:
    path: data/vault
    watch: true
  consolidation:
    implicit_extraction: true
    auto_dream_cron: '0 3 * * *'
    auto_dream_model: 'haiku'
  search:
    context_budget_tokens: 4000
    rrf_k: 60
    fts_weight_default: 0.5
    vector_weight_default: 0.5

# config/personality/knowledge.yaml
knowledge:
  default_space: 'general'
  max_page_versions: 50
  ai_commands:
    enabled: true
    model: 'default'
```

---

## 9. New Dependencies

```
@udecode/plate              — Plate editor core (MIT)
@udecode/plate-heading       — Heading plugin (MIT)
@udecode/plate-list          — List plugin (MIT)
@udecode/plate-table         — Table plugin (MIT)
@udecode/plate-code-block    — Code block plugin (MIT)
@udecode/plate-image         — Image plugin (MIT)
@udecode/plate-slash-command — Slash command plugin (MIT)
@udecode/plate-ai            — AI plugin (MIT)
unified                      — Markdown processing (MIT)
remark-parse                 — Markdown parser (MIT)
remark-stringify             — Markdown serializer (MIT)
gray-matter                  — YAML frontmatter (MIT)
```

Already in project: `@orama/orama`, `drizzle-orm`, `zod`.

---

## 10. Memory API Endpoints

```
GET    /api/v1/memory/search           — Hybrid search (FTS + vector + graph)
GET    /api/v1/memory/working          — Working memory blocks
PATCH  /api/v1/memory/working/:key     — Update working memory block
GET    /api/v1/memory/episodic         — List episodic memories
POST   /api/v1/memory/episodic         — Save new episodic memory
GET    /api/v1/memory/vault            — List vault files
GET    /api/v1/memory/vault/:path      — Read vault file
PUT    /api/v1/memory/vault/:path      — Write/update vault file
GET    /api/v1/memory/stats            — Tier sizes, embedding coverage
POST   /api/v1/memory/consolidate      — Manual consolidation trigger
```

---

## 11. Research References

Design informed by analysis of:

- **Letta/MemGPT** — Memory Blocks concept (labeled, always-in-prompt working memory)
- **Zep/Graphiti** — Temporal facts with validity windows (`valid_from`/`valid_until`)
- **Mem0** — Implicit fact extraction, hierarchical scope, memory consolidation
- **Anthropic Claude Memory** — File-based memory (MEMORY.md + topic files), Auto Dream consolidation
- **OpenAI ChatGPT** — Implicit vs explicit memory, Active Context injection

Technology choices validated against:
- Plate editor (MIT, shadcn/ui native, React 19, AI plugin) — preferred over BlockNote (GPL), Novel (stale), Lexical (high effort)
- Orama (Apache 2.0, TypeScript native, hybrid search) — already in project
- SQLite FTS5 + wikilink graph — zero-cost semantic alternative to embeddings
