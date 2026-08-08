// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createChannelRouter } from './channel-router.js'
import { createChannelConfigService } from './channel-config-service.js'
import { createCommunicationRoutes } from './routes.js'
import { mcpServerManifest } from './submodules/mcp-server/manifest.js'
import { mcpClientManifest } from './submodules/mcp-client/manifest.js'
import { telegramManifest } from './submodules/telegram/manifest.js'
import { a2aManifest } from './submodules/a2a/manifest.js'
import { discordManifest } from './submodules/discord/manifest.js'
import { slackManifest } from './submodules/slack/manifest.js'
import { emailManifest } from './submodules/email/manifest.js'
import { whatsappManifest } from './submodules/whatsapp/manifest.js'
import { signalManifest } from './submodules/signal/manifest.js'
import { createMcpServer } from './submodules/mcp-server/server.js'
import { createMcpClient } from './submodules/mcp-client/client.js'
import { createTelegramBot } from './submodules/telegram/bot.js'
import { createDiscordBot } from './submodules/discord/bot.js'
import { createSlackBot } from './submodules/slack/bot.js'
import { createEmailAdapter } from './submodules/email/adapter.js'
import { createEmailChannelFromProvider } from './submodules/email/provider-bridge.js'
import { createWhatsAppAdapter } from './submodules/whatsapp/adapter.js'
import { createSignalAdapter } from './submodules/signal/adapter.js'
import { createA2ATaskStore, registerA2ARoutes } from './submodules/a2a/server.js'
import { generateAgentCard, DEFAULT_SKILLS } from './submodules/a2a/agent-card.js'
import { createInternalContactsRegistry } from './internal-contacts-registry.js'
import { createEphemeralOverrideStore } from './voice-scope-overrides.js'
import { resolveScope } from './channel-resolver.js'
import { createActiveVoiceResolver } from './active-voice-resolver.js'
import { createInboundTables, createInboundCoordinator, type InboundMessage } from './inbound-coordinator.js'
import { createChannelRunAgent } from './channel-run-agent.js'
import { createInboundRoutes } from './inbound-routes.js'
import { createPairingTables, createPairingService } from './pairing-service.js'
import { createPairingRoutes } from './pairing-routes.js'
import { createChannelHealth } from './channel-health.js'
import { createProgressTracker } from './progress-tracker.js'
import { ensureChannelReply } from './reply-guard.js'
import { createPeerTables, createPeerRegistry } from './submodules/a2a/peers.js'
import { createPeerRoutes } from './submodules/a2a/peer-routes.js'
import { googlechatManifest } from './submodules/googlechat/manifest.js'
import { createGoogleChatBot } from './submodules/googlechat/bot.js'
import { teamsManifest } from './submodules/teams/manifest.js'
import { createTeamsBot } from './submodules/teams/bot.js'
import { CHANNEL_CATALOG, listCatalogTypes } from './channel-catalog.js'
import { createChannelSetupService } from './channel-setup-service.js'
import { reconnectChannelInstance } from './channel-reconnect.js'
import { vaultSecretName } from './channel-secret-keys.js'

export const communicationModule: EyasModule = {
  id: 'communication',
  name: 'Communication',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Unified channel router — MCP server/client, Telegram, extensible',
  dependencies: [],
  optional: ['tools', 'secrets'],

  submodules: [
    mcpServerManifest, mcpClientManifest, telegramManifest, a2aManifest,
    discordManifest, slackManifest, emailManifest, whatsappManifest, signalManifest,
    googlechatManifest, teamsManifest,
  ],

  async onRegister(ctx: ModuleContext) {
    // MCP servers table
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      transport TEXT NOT NULL DEFAULT 'stdio',
      url TEXT,
      command TEXT,
      args TEXT,
      env TEXT,
      api_key TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_start INTEGER NOT NULL DEFAULT 1,
      discovered_tools TEXT,
      discovered_resources TEXT,
      discovered_prompts TEXT,
      status TEXT NOT NULL DEFAULT 'disconnected',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    // Channel configs table — binds channels to agents
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS channel_configs (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      agent_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    // Per-channel forced voice scope ('internal' | 'external' | NULL).
    // Read by the active-voice resolver; must exist on a fresh production DB.
    try { ctx.db.run(sql.raw(`ALTER TABLE channel_configs ADD COLUMN force_voice_scope TEXT`)) } catch { /* already exists */ }

    // Per-channel autonomy mode: 'managed' (default — security gate governs each
    // tool call) | 'autonomous' (unattended, gated by the graduated-autonomy ladder).
    try { ctx.db.run(sql.raw(`ALTER TABLE channel_configs ADD COLUMN mode TEXT NOT NULL DEFAULT 'managed'`)) } catch { /* already exists */ }

    // Internal contacts table — tracks known-internal participants for voice scope resolution
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS internal_contacts (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'internal',
      notes TEXT,
      added_at TEXT NOT NULL,
      added_by TEXT NOT NULL
    )`)
    ctx.db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS internal_contacts_ident_channel
      ON internal_contacts (identifier, channel_type)`)

    // Durable inbound queue (Cap 1) — at-least-once channel ingestion.
    createInboundTables(ctx.db)
    createPairingTables(ctx.db)
    try {
      ;(ctx as any).permissions?.registerSubject?.('Communication', {
        actions: ['read', 'retry', 'approve', 'manage'],
        defaults: { owner: ['manage'], admin: ['manage'], user: ['read'], agent: [], guest: [] },
      })
    } catch { /* already registered */ }

    const channelConfigService = createChannelConfigService(ctx.db)
    const router = createChannelRouter(ctx.logger, channelConfigService)
    ;(ctx as any).communication = { router, channelConfigService }
    ctx.logger.info('Communication module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { router } = (ctx as any).communication
    // Persistent channel pairing (Cap 1 PR2) — survives restarts.
    const pairingService = createPairingService(ctx.db)
    ;(ctx as any).communication.pairingService = pairingService

    // Channel health watchdog (Cap 2) — fatal poller failures (bad token / 409
    // conflict) alert once and surface on the /channels response.
    const channelHealth = createChannelHealth({
      onAlert: (channelId, state) =>
        ctx.bus.emit('eyas.communication.channel.fatal', {
          channelId,
          reason: state.fatalReason,
          lastError: state.lastError,
        }),
    })
    ;(ctx as any).communication.channelHealth = channelHealth
    const toolsModule = ctx.hasModule('tools') ? ctx.getModule<any>('tools') : null
    const mcpClient = createMcpClient({
      db: ctx.db,
      logger: ctx.logger,
      toolRegistry: toolsModule?.registry,
    })
    ;(ctx as any).communication.mcpClient = mcpClient

    // Load MCP servers from config file (config/mcp.yaml)
    try {
      const fs = await import('fs')
      const path = await import('path')
      // @ts-expect-error js-yaml has no type declarations
      const yaml = await import('js-yaml')
      const configPath = path.resolve(process.cwd(), 'config', 'mcp.yaml')
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8')
        const parsed = yaml.load(raw) as { servers?: import('./submodules/mcp-client/types.js').McpConfigEntry[] } | null
        if (parsed?.servers?.length) {
          await mcpClient.loadFromConfig(parsed.servers)
          ctx.logger.info({ count: parsed.servers.length }, 'MCP: loaded servers from config/mcp.yaml')
        }
      }
    } catch (err: any) {
      ctx.logger.warn({ err: err.message }, 'MCP: failed to load config/mcp.yaml')
    }

    // Auto-connect enabled MCP servers
    await mcpClient.autoConnect()

    // Register MCP management routes
    const { createMcpRoutes } = await import('./submodules/mcp-client/routes.js')
    createMcpRoutes(ctx.http, mcpClient)

    // MCP Server — exposes EYAS tools to external clients, so it only comes up
    // when the tools module is fully present. Registering it with a missing
    // registry/executor would serve routes that crash on every call.
    if (mcpServerManifest.enabled) {
      if (toolsModule?.registry && toolsModule?.executor) {
        const mcpServer = createMcpServer({
          toolRegistry: toolsModule.registry,
          toolExecutor: toolsModule.executor,
          logger: ctx.logger,
          http: ctx.http,
        })
        await mcpServer.connect()
        router.register(mcpServer)
        ;(ctx as any).communication.mcpServer = mcpServer
      } else {
        ctx.logger.warn('MCP Server: tools module unavailable — server not registered')
      }
    }

    // Progress placeholders + channel reply-guard state
    const progressTracker = createProgressTracker()
    ;(ctx as any).communication.progressTracker = progressTracker

    // Telegram — register if token is configured
    if (telegramManifest.enabled) {
      const botToken = ctx.hasModule('secrets') ? await ctx.secrets.get('telegram-bot-token', 'system') : undefined
      const telegram = createTelegramBot({
        botToken: botToken ?? undefined,
        logger: ctx.logger,
        // Only the scheduler leader runs the long-polling loop (no 409 conflict).
        shouldPoll: () => (ctx as any).scheduler?.isLeader ?? true,
        onError: (err) => channelHealth.record('telegram', err),
        onActivity: () => channelHealth.recordOk('telegram'),
        // Lazy voice resolution — voice module may start after communication.
        voiceWorkDir: 'data/voice',
        transcribeVoice: async (path) => {
          const voiceSvc = (ctx as any).voice
          if (!voiceSvc?.config?.enabled) {
            throw new Error('Voice STT disabled (set voice.enabled: true)')
          }
          return (await voiceSvc.transcribe(path)).text
        },
        pairing: {
          isApproved: (id) => pairingService.isApproved('telegram', id),
          requestPairing: ({ channelId, senderName }) => {
            const r = pairingService.requestPairing({ source: 'telegram', channelId, senderName })
            if (r.status === 'pending') ctx.bus.emit('eyas.communication.pairing.requested', { source: 'telegram', channelId })
            return r
          },
          approveByChannel: (id) => pairingService.approveByChannel('telegram', id),
          getPending: () =>
            pairingService
              .listPending('telegram')
              .map((r) => ({ chatId: r.channel_id, code: r.code ?? '', senderName: r.sender_name ?? 'Unknown' })),
        },
      })
      await telegram.connect()
      if (telegram.connected) {
        router.register(telegram)
      }
      ;(ctx as any).communication.telegram = telegram
    }

    // Google Chat — webhook ingest; configured via project id secret
    if (googlechatManifest.enabled) {
      const projectId = ctx.hasModule('secrets') ? await ctx.secrets.get('googlechat-project-id', 'system') : undefined
      const accessToken = ctx.hasModule('secrets') ? await ctx.secrets.get('googlechat-access-token', 'system') : undefined
      const defaultSpace = ctx.hasModule('secrets') ? await ctx.secrets.get('googlechat-default-space', 'system') : undefined
      const googlechat = createGoogleChatBot({
        projectId: projectId ?? undefined,
        accessToken: accessToken ?? undefined,
        defaultSpace: defaultSpace ?? undefined,
        logger: ctx.logger,
        onError: (err) => channelHealth.record('googlechat', err),
        onActivity: () => channelHealth.recordOk('googlechat'),
      })
      await googlechat.connect()
      if (googlechat.connected) router.register(googlechat)
      ;(ctx as any).communication.googlechat = googlechat

      // Webhook endpoint for Chat events
      ctx.http.post('/api/v1/channels/googlechat/webhook', async (c) => {
        const event = await c.req.json().catch(() => null)
        if (event) await googlechat.ingestEvent(event)
        return c.json({ ok: true })
      })
    }

    // Microsoft Teams — Bot Framework activity webhook
    if (teamsManifest.enabled) {
      const appId = ctx.hasModule('secrets') ? await ctx.secrets.get('teams-bot-app-id', 'system') : undefined
      const appPassword = ctx.hasModule('secrets') ? await ctx.secrets.get('teams-bot-app-password', 'system') : undefined
      const tenantId = ctx.hasModule('secrets') ? await ctx.secrets.get('teams-bot-tenant-id', 'system') : undefined
      const teams = createTeamsBot({
        appId: appId ?? undefined,
        appPassword: appPassword ?? undefined,
        tenantId: tenantId ?? undefined,
        logger: ctx.logger,
        onError: (err) => channelHealth.record('teams', err),
        onActivity: () => channelHealth.recordOk('teams'),
      })
      await teams.connect()
      if (teams.connected) router.register(teams)
      ;(ctx as any).communication.teams = teams

      ctx.http.post('/api/v1/channels/teams/webhook', async (c) => {
        const activity = await c.req.json().catch(() => null)
        if (activity) await teams.ingestActivity(activity)
        return c.json({ ok: true })
      })
    }

    // Discord — register if token is configured
    if (discordManifest.enabled) {
      const botToken = ctx.hasModule('secrets') ? await ctx.secrets.get('discord-bot-token', 'system') : undefined
      const discord = createDiscordBot({ botToken: botToken ?? undefined, logger: ctx.logger })
      await discord.connect()
      if (discord.connected) router.register(discord)
      ;(ctx as any).communication.discord = discord
    }

    // Slack — register if tokens are configured
    if (slackManifest.enabled) {
      const botToken = ctx.hasModule('secrets') ? await ctx.secrets.get('slack-bot-token', 'system') : undefined
      const appToken = ctx.hasModule('secrets') ? await ctx.secrets.get('slack-app-token', 'system') : undefined
      const slack = createSlackBot({ botToken: botToken ?? undefined, appToken: appToken ?? undefined, logger: ctx.logger })
      await slack.connect()
      if (slack.connected) router.register(slack)
      ;(ctx as any).communication.slack = slack
    }

    // Email — three provider tiers:
    //   1. Microsoft 365 (Graph API, OAuth2)       — if `email-m365-*` secrets present
    //   2. Gmail (Gmail API, OAuth2)               — if `email-gmail-*` secrets present
    //   3. Generic SMTP/IMAP                       — legacy adapter, hardcoded defaults
    //
    // Any combination can run simultaneously; each becomes its own channel with
    // a distinct channelId (the account address), so the router can dispatch
    // per-inbox. Selection is lazy: a provider block is only instantiated if
    // its required secrets exist.
    //
    // TODO(phase-5): move this to a config-file-driven account list so
    // multiple accounts per provider are easy to add without adding more
    // secret keys here.
    if (emailManifest.enabled) {
      const emailChannels: Array<{ id: string; channel: Awaited<ReturnType<typeof createEmailChannelFromProvider>> | ReturnType<typeof createEmailAdapter> }> = []

      // --- Microsoft 365 ---
      const m365TenantId = ctx.hasModule('secrets') ? await ctx.secrets.get('email-m365-tenant-id', 'system') : undefined
      const m365ClientId = ctx.hasModule('secrets') ? await ctx.secrets.get('email-m365-client-id', 'system') : undefined
      const m365ClientSecret = ctx.hasModule('secrets') ? await ctx.secrets.get('email-m365-client-secret', 'system') : undefined
      const m365Mailbox = ctx.hasModule('secrets') ? await ctx.secrets.get('email-m365-mailbox', 'system') : undefined
      if (m365TenantId && m365ClientId && m365ClientSecret && m365Mailbox) {
        try {
          const { createM365EmailProvider } = await import('./providers/m365/index.js')
          const provider = createM365EmailProvider({
            tenantId: m365TenantId,
            clientId: m365ClientId,
            clientSecret: m365ClientSecret,
            mailbox: m365Mailbox,
          } as any)
          const channel = createEmailChannelFromProvider(provider, {
            channelId: m365Mailbox,
            displayName: `M365 (${m365Mailbox})`,
            logger: ctx.logger,
          })
          await channel.connect()
          if (channel.connected) {
            router.register(channel)
            emailChannels.push({ id: channel.id, channel })
          }
        } catch (err) {
          ctx.logger.warn({ err }, 'Email: Microsoft 365 provider failed to initialise')
        }
      }

      // --- Gmail ---
      const gmailClientId = ctx.hasModule('secrets') ? await ctx.secrets.get('email-gmail-client-id', 'system') : undefined
      const gmailClientSecret = ctx.hasModule('secrets') ? await ctx.secrets.get('email-gmail-client-secret', 'system') : undefined
      const gmailRefreshToken = ctx.hasModule('secrets') ? await ctx.secrets.get('email-gmail-refresh-token', 'system') : undefined
      const gmailMailbox = ctx.hasModule('secrets') ? await ctx.secrets.get('email-gmail-mailbox', 'system') : undefined
      if (gmailClientId && gmailClientSecret && gmailRefreshToken && gmailMailbox) {
        try {
          const { createGmailProvider } = await import('./providers/gmail/index.js')
          const provider = createGmailProvider({
            clientId: gmailClientId,
            clientSecret: gmailClientSecret,
            refreshToken: gmailRefreshToken,
            mailbox: gmailMailbox,
          } as any)
          const channel = createEmailChannelFromProvider(provider, {
            channelId: gmailMailbox,
            displayName: `Gmail (${gmailMailbox})`,
            logger: ctx.logger,
          })
          await channel.connect()
          if (channel.connected) {
            router.register(channel)
            emailChannels.push({ id: channel.id, channel })
          }
        } catch (err) {
          ctx.logger.warn({ err }, 'Email: Gmail provider failed to initialise')
        }
      }

      // --- Generic SMTP/IMAP (legacy adapter — unchanged behavior) ---
      const smtpHost = ctx.hasModule('secrets') ? await ctx.secrets.get('email-smtp-host', 'system') : undefined
      const smtpUser = ctx.hasModule('secrets') ? await ctx.secrets.get('email-smtp-user', 'system') : undefined
      const smtpPass = ctx.hasModule('secrets') ? await ctx.secrets.get('email-smtp-pass', 'system') : undefined
      const imapHost = ctx.hasModule('secrets') ? await ctx.secrets.get('email-imap-host', 'system') : undefined
      const imapUser = ctx.hasModule('secrets') ? await ctx.secrets.get('email-imap-user', 'system') : undefined
      const imapPass = ctx.hasModule('secrets') ? await ctx.secrets.get('email-imap-pass', 'system') : undefined
      if (smtpHost || imapHost) {
        const email = createEmailAdapter({
          smtpHost: smtpHost ?? undefined, smtpUser: smtpUser ?? undefined, smtpPass: smtpPass ?? undefined,
          imapHost: imapHost ?? undefined, imapUser: imapUser ?? undefined, imapPass: imapPass ?? undefined,
          logger: ctx.logger,
        })
        await email.connect()
        if (email.connected) {
          router.register(email)
          emailChannels.push({ id: email.id, channel: email })
        }
      }

      // Expose a map so routes / tools can find a specific email channel by id.
      // Keeps backward compat with the old `communication.email` single reference
      // by also assigning the first registered channel to it.
      ;(ctx as any).communication.emailChannels = new Map(emailChannels.map(e => [e.id, e.channel]))
      if (emailChannels[0]) {
        ;(ctx as any).communication.email = emailChannels[0].channel
      }

      if (emailChannels.length === 0) {
        ctx.logger.debug('Email: no providers configured (no m365/gmail/SMTP secrets present)')
      } else {
        ctx.logger.info(
          { count: emailChannels.length, channels: emailChannels.map(e => e.id) },
          'Email: providers registered',
        )
      }
    }

    // WhatsApp — register if Business API credentials are configured
    if (whatsappManifest.enabled) {
      const phoneNumberId = ctx.hasModule('secrets') ? await ctx.secrets.get('whatsapp-phone-number-id', 'system') : undefined
      const accessToken = ctx.hasModule('secrets') ? await ctx.secrets.get('whatsapp-access-token', 'system') : undefined
      const verifyToken = ctx.hasModule('secrets') ? await ctx.secrets.get('whatsapp-verify-token', 'system') : undefined
      // App secret keys the X-Hub-Signature-256 HMAC on inbound webhooks. Without
      // it the adapter fails closed and rejects every POST (see adapter.ts).
      const appSecret = ctx.hasModule('secrets') ? await ctx.secrets.get('whatsapp-app-secret', 'system') : undefined
      const whatsapp = createWhatsAppAdapter({
        phoneNumberId: phoneNumberId ?? undefined,
        accessToken: accessToken ?? undefined,
        verifyToken: verifyToken ?? undefined,
        appSecret: appSecret ?? undefined,
        logger: ctx.logger,
        http: ctx.http,
      })
      await whatsapp.connect()
      if (whatsapp.connected) router.register(whatsapp)
      ;(ctx as any).communication.whatsapp = whatsapp
    }

    // Signal — register if signal-cli bridge is configured
    if (signalManifest.enabled) {
      const signalCliUrl = ctx.hasModule('secrets') ? await ctx.secrets.get('signal-cli-url', 'system') : undefined
      const accountNumber = ctx.hasModule('secrets') ? await ctx.secrets.get('signal-account-number', 'system') : undefined
      const signal = createSignalAdapter({
        signalCliUrl: signalCliUrl ?? undefined,
        accountNumber: accountNumber ?? undefined,
        logger: ctx.logger,
      })
      await signal.connect()
      if (signal.connected) router.register(signal)
      ;(ctx as any).communication.signal = signal
    }

    // A2A Protocol — agent card + JSON-RPC task server
    if (a2aManifest.enabled) {
      const taskStore = createA2ATaskStore(ctx.db)
      const baseUrl =
        (ctx.config as any)?.baseUrl
        ?? `http://127.0.0.1:${ctx.config.server.port}`
      const cardGenerator = () => generateAgentCard(DEFAULT_SKILLS, { url: baseUrl })
      ;(ctx.http as any)._agentCardGenerator = cardGenerator

      // Wave 3 — wire real agent execution when the agent module is present.
      // Communication onStart may run before agents; resolve lazily per task.
      // executeAgent(conversationId, agentId, task) — requires a conversation row.
      const a2aExecutor = async (task: { id: string; description: string; skill?: string }) => {
        const agents = (ctx as any).agents
        if (!agents?.executeAgent) {
          throw new Error('A2A executor: agent module not available')
        }
        const registry = agents.registry
        const list = registry?.list?.() ?? []
        const primary =
          list.find((a: any) => a.agentType === 'assistant' || a.id?.includes?.('primary')) ??
          list[0]
        if (!primary?.id) throw new Error('A2A executor: no agent registered')

        const convService = (ctx as any).conversations
        if (!convService?.create) {
          throw new Error('A2A executor: conversations module not available')
        }
        const conv = convService.create({
          title: `A2A: ${task.description.slice(0, 80)}`,
          agentId: primary.id,
          goalDescription: task.description,
          origin: 'a2a',
          metadata: { a2aTaskId: task.id, skill: task.skill },
        })
        const conversationId = conv?.id ?? conv
        if (!conversationId || typeof conversationId !== 'string') {
          throw new Error('A2A executor: failed to create conversation')
        }

        const result = await agents.executeAgent(
          conversationId,
          primary.id,
          task.description,
          { origin: 'delegation' },
        )
        if (result.status === 'failed') {
          taskStore.updateStatus(task.id, 'failed', {
            error: result.text?.slice(0, 2000) || 'agent run failed',
          })
          return
        }
        taskStore.updateStatus(task.id, 'completed', {
          result: String(result.text ?? '').slice(0, 50_000),
        })
      }

      registerA2ARoutes({
        app: ctx.http,
        taskStore,
        logger: ctx.logger,
        executor: a2aExecutor,
      })
      ;(ctx as any).communication.a2aTaskStore = taskStore
      ;(ctx as any).communication.a2aMailbox = {
        list: () => taskStore.list(),
        get: (id: string) => taskStore.get(id),
      }

      // Multi-instance peer federation (EYAS↔EYAS) built on A2A
      createPeerTables(ctx.db)
      const systemName = ((ctx.config as any).baseUrl
        ? new URL((ctx.config as any).baseUrl).hostname
        : 'eyas').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'eyas'
      const peers = createPeerRegistry(ctx.db, { systemName })
      ;(ctx as any).communication.peers = peers
      createPeerRoutes(ctx.http, peers)
      ctx.logger.info('A2A protocol + federation peers + task executor enabled')
    }

    // v2 voice scope wiring
    const internalContactsRegistry = createInternalContactsRegistry(ctx.db)
    const ephemeralOverrideStore = createEphemeralOverrideStore()

    const activeVoiceResolver = createActiveVoiceResolver({
      workspaceLoader: (ctx as any).workspaceLoader,
      ephemeralStore: ephemeralOverrideStore,
      loadConversationOverride: async (conversationId) => {
        // db.get returns a POSITIONAL row in bun-sqlite (not a named object), so
        // reading row.voice_scope_override off it is always undefined. Use db.all
        // + [0], matching internal-contacts-registry.ts / channel-config-service.ts.
        const rows = ctx.db.all<{ voice_scope_override: 'internal' | 'external' | null }>(
          sql`SELECT voice_scope_override FROM conversations WHERE id = ${conversationId} LIMIT 1`,
        )
        return rows[0]?.voice_scope_override ?? null
      },
      loadChannelForceScope: async (channelId) => {
        // Same bun-sqlite db.get footgun — use db.all + [0].
        const rows = ctx.db.all<{ force_voice_scope: 'internal' | 'external' | null }>(
          sql`SELECT force_voice_scope FROM channel_configs WHERE channel_id = ${channelId} LIMIT 1`,
        )
        return rows[0]?.force_voice_scope ?? null
      },
    })

    ;(ctx as any).internalContactsRegistry = internalContactsRegistry
    ;(ctx as any).ephemeralOverrideStore = ephemeralOverrideStore
    ;(ctx as any).channelResolver = resolveScope
    ;(ctx as any).activeVoiceResolver = activeVoiceResolver

    // ── Durable inbound coordinator (Cap 1) ────────────────────────────────
    // The persisted channel_inbound_events row — not this bus emit — is the
    // at-least-once guarantee. Collaborators are resolved lazily so module load
    // order doesn't matter (conversations/agent/tools may start after us).
    const { channelConfigService } = (ctx as any).communication
    const runAgent = createChannelRunAgent({
      get agentRegistry() { return (ctx as any).agents?.registry },
      get agentRunner() { return (ctx as any).agents?.runner },
      get conversations() { return (ctx as any).conversations },
      get toolRegistry() { return (ctx as any).tools?.registry },
      get budgetEngine() { return (ctx as any).agents?.budgetEngine },
      logger: ctx.logger,
    } as any)

    const inboundCoordinator = createInboundCoordinator({
      db: ctx.db,
      logger: ctx.logger,
      resolveBinding: ({ source, channelId, connectorId }) => {
        // Multi-instance: bind by connector id first (e.g. signal-work), then
        // per-peer override, then first live channel of that type (legacy).
        const cfg =
          (connectorId ? channelConfigService.getByChannelId(connectorId) : null) ??
          channelConfigService.getByChannelId(channelId) ??
          (() => {
            const channel = router.listChannels().find((ch: any) => ch.type === source)
            return channel ? channelConfigService.getByChannelId(channel.id) : null
          })()
        return { agentId: cfg?.agentId ?? null, mode: cfg?.mode ?? 'managed' }
      },
      createConversation: ({ source, channelId, senderId, senderName, agentId, mode, connectorId }) => {
        const label = connectorId && connectorId !== source ? `${connectorId}` : source
        const conv = (ctx as any).conversations.create({
          userId: 'system',
          title: `${label}: ${senderName ?? senderId}`,
        })
        ;(ctx as any).conversations.update(conv.id, { agentId, mode })
        return conv.id
      },
      addMessage: (conversationId, role, content) => {
        ;(ctx as any).conversations.addMessage(conversationId, { role, content })
      },
      runAgent: async (input) => {
        // Progress placeholder on Telegram while the agent works
        const conv = (ctx as any).conversations?.get?.(input.conversationId)
        // We don't have channelId here directly; progress is posted at enqueue time below.
        const result = await runAgent(input)
        // Reply-guard: never return silent null for channel turns
        const guarded = ensureChannelReply(result.replyText)
        return { replyText: guarded?.text ?? result.replyText }
      },
      reply: async (msg, text) => {
        const channel = (
          (msg.connectorId ? router.getChannel(msg.connectorId) : undefined) ??
          router.listChannels().find((ch: any) => ch.type === msg.source)
        ) as any
        if (!channel) return

        // Clear progress placeholder if any
        const placeholder = progressTracker.take(msg.source, msg.channelId, msg.providerMessageId)
        if (placeholder && channel.clearProgress) {
          await channel.clearProgress(msg.channelId, placeholder.placeholderMessageId)
        }

        // Optional TTS when inbound was voice and voice module is enabled
        const voiceSvc = (ctx as any).voice
        const inboundWasVoice = Array.isArray(msg.attachments)
          && (msg.attachments as any[]).some((a) => String(a?.url ?? '').startsWith('voice://') || String(a?.mimeType ?? '').startsWith('audio/'))
        let voicePath: string | undefined
        if (voiceSvc?.config?.enabled && channel.type === 'telegram') {
          const mode = voiceSvc.resolveMode?.(null, inboundWasVoice) ?? 'text'
          if (mode === 'voice') {
            try {
              const synth = await voiceSvc.synthesize(text)
              voicePath = synth.audioPath
            } catch (err) {
              ctx.logger.warn({ err }, 'Voice TTS failed; sending text')
            }
          }
        }

        await channel.send(msg.channelId, {
          text,
          voicePath,
          preferVoice: !!voicePath,
        })
      },
    })
    ;(ctx as any).communication.inboundCoordinator = inboundCoordinator

    // Incoming channel messages → durable queue → deliver now (the reconcile
    // tick below re-drains anything left behind by a crash). The legacy
    // communication:message emit is kept for observability/back-compat.
    router.onMessage(async (msg: import('./types.js').ChannelMessage) => {
      ctx.bus.emit('communication:message', msg)

      // Post progress placeholder (Telegram) before agent work
      try {
        const ch = (
          (msg.connectorId ? router.getChannel(msg.connectorId) : undefined) ??
          router.listChannels().find((c: any) => c.type === msg.channelType)
        ) as any
        if (ch?.postProgress && pairingService.isApproved(msg.channelType, msg.channelId)) {
          const mid = await ch.postProgress(msg.channelId)
          if (mid) {
            progressTracker.track({
              channelType: msg.channelType,
              channelId: msg.channelId,
              placeholderMessageId: mid,
              inboundMessageId: msg.id,
              createdAt: Date.now(),
            })
          }
        }
      } catch (err) {
        ctx.logger.debug({ err }, 'progress placeholder skipped')
      }

      const inbound: InboundMessage = {
        source: msg.channelType,
        providerMessageId: msg.id,
        channelId: msg.channelId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
        attachments: msg.attachments,
        replyToId: msg.replyToId,
        receivedAt: msg.timestamp ?? new Date().toISOString(),
        connectorId: msg.connectorId,
      }
      const { accepted } = inboundCoordinator.enqueue(inbound)
      if (accepted) ctx.bus.emit('eyas.communication.inbound.received', { source: msg.channelType })
      try {
        const processed = await inboundCoordinator.deliverPending()
        if (processed) ctx.bus.emit('eyas.communication.inbound.updated', {})
      } catch (err) {
        ctx.logger.error({ err }, 'Inbound deliver failed')
        // Progress watchdog: rewrite placeholders to explicit error
        const orphans = progressTracker.listOrphans({ maxAgeMs: 0 })
        for (const o of orphans) {
          if (o.channelId === msg.channelId && o.channelType === msg.channelType) {
            const ch = router.listChannels().find((c: any) => c.type === o.channelType) as any
            await ch?.clearProgress?.(o.channelId, o.placeholderMessageId, 'Processing failed — please try again.')
            progressTracker.take(o.channelType, o.channelId, o.inboundMessageId)
          }
        }
      }
    })

    // Leader-gated reconcile tick — durability backstop for at-least-once.
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      scheduler.registerHandler('communication.inbound.reconcile', async () => {
        const processed = await inboundCoordinator.deliverPending()
        if (processed) ctx.bus.emit('eyas.communication.inbound.updated', {})
        // The tick only runs on the leader → ensure the (leader-only) telegram
        // poller is started once this instance acquires leadership. Idempotent.
        await (ctx as any).communication.telegram?.connect?.().catch(() => {})
      })
      if (!scheduler.list().some((j: any) => j.handler === 'communication.inbound.reconcile')) {
        scheduler.create({
          name: 'Channel Inbound Reconcile',
          description: 'Re-drain undelivered inbound channel events (at-least-once)',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '* * * * *' }),
          handler: 'communication.inbound.reconcile',
        })
      }
    }

    // Ensure a binding row exists for every registered channel (keyed by the
    // connector id) so the bindings UI lists them and PATCH /channels/:id can
    // set their agent/mode. Never clobbers an existing binding.
    for (const ch of router.listChannels()) {
      try {
        channelConfigService.ensureChannel({ channelType: (ch as any).type, channelId: (ch as any).id, name: (ch as any).name ?? (ch as any).id })
      } catch (err) {
        ctx.logger.debug({ err: String(err), channel: (ch as any).id }, 'ensureChannel skipped')
      }
    }

    // Also ensure catalog rows for channels that are not yet connected so the
    // setup UI can bind agents before the first successful connect.
    for (const entry of CHANNEL_CATALOG) {
      try {
        channelConfigService.ensureChannel({
          channelType: entry.type,
          channelId: entry.id,
          name: entry.name,
        })
      } catch (err) {
        ctx.logger.debug({ err: String(err), channel: entry.id }, 'catalog ensureChannel skipped')
      }
    }

    // Setup service: multi-instance secrets + reconnect without process restart
    const baseReconnectDeps = {
      router,
      logger: ctx.logger,
      store: (ctx as any).communication as Record<string, unknown>,
      shouldPoll: () => (ctx as any).scheduler?.isLeader ?? true,
      onError: (channelId: string, err: unknown) => channelHealth.record(channelId, err),
      onActivity: (channelId: string) => channelHealth.recordOk(channelId),
      pairing: {
        isApproved: (id: string) => pairingService.isApproved('telegram', id),
        requestPairing: ({ channelId, senderName }: { channelId: string; senderName: string }) => {
          const r = pairingService.requestPairing({ source: 'telegram', channelId, senderName })
          if (r.status === 'pending') {
            ctx.bus.emit('eyas.communication.pairing.requested', { source: 'telegram', channelId })
          }
          return r
        },
        approveByChannel: (id: string) => pairingService.approveByChannel('telegram', id),
        getPending: () =>
          pairingService
            .listPending('telegram')
            .map((r: any) => ({ chatId: r.channel_id, code: r.code ?? '', senderName: r.sender_name ?? 'Unknown' })),
      },
      voiceWorkDir: 'data/voice',
      transcribeVoice: async (path: string) => {
        const voiceSvc = (ctx as any).voice
        if (!voiceSvc?.config?.enabled) {
          throw new Error('Voice STT disabled (set voice.enabled: true)')
        }
        return (await voiceSvc.transcribe(path)).text
      },
      http: ctx.http,
    }

    const setupService = createChannelSetupService({
      router,
      channelConfigService,
      getSecret: async (name) =>
        ctx.hasModule('secrets') ? (await ctx.secrets.get(name, 'system')) ?? undefined : undefined,
      setSecret: async (name, value) => {
        if (!ctx.hasModule('secrets')) throw new Error('Secrets module unavailable')
        await ctx.secrets.set(name, 'system', value, 'communication')
      },
      deleteSecret: async (name) => {
        if (!ctx.hasModule('secrets')) return
        try {
          await ctx.secrets.delete(name, 'system')
        } catch {
          /* missing ok */
        }
      },
      getHealth: (channelId) => channelHealth.get(channelId),
      reconnect: async (input) =>
        reconnectChannelInstance(input, {
          ...baseReconnectDeps,
          getSecret: async (field) => {
            const key = vaultSecretName(input.instanceId, field)
            return ctx.hasModule('secrets')
              ? (await ctx.secrets.get(key, 'system')) ?? undefined
              : undefined
          },
        }),
      resolvePrimaryAgentId: () => {
        try {
          const agents = (ctx as any).agents?.registry?.list?.() ?? []
          const primary = agents.find((a: any) => a.tier === 'primary' && a.enabled !== false)
          return primary?.id ?? agents.find((a: any) => a.enabled !== false)?.id ?? null
        } catch {
          return null
        }
      },
    })
    ;(ctx as any).communication.setup = setupService

    // Connect any extra instances that already have credentials (defaults are
    // still started above by the legacy onStart blocks).
    for (const cfg of channelConfigService.list()) {
      if (CHANNEL_CATALOG.some((e) => e.id === cfg.channelId)) continue
      if (!listCatalogTypes().includes(cfg.channelType as any)) continue
      try {
        await reconnectChannelInstance(
          {
            instanceId: cfg.channelId,
            type: cfg.channelType,
            name: cfg.name,
            config: cfg.config,
          },
          {
            ...baseReconnectDeps,
            getSecret: async (field) => {
              const key = vaultSecretName(cfg.channelId, field)
              return ctx.hasModule('secrets')
                ? (await ctx.secrets.get(key, 'system')) ?? undefined
                : undefined
            },
          },
        )
      } catch (err) {
        ctx.logger.debug({ err, id: cfg.channelId }, 'extra channel instance reconnect skipped')
      }
    }

    // Register HTTP routes
    createCommunicationRoutes(ctx.http, router, undefined, channelConfigService, channelHealth, setupService)
    createInboundRoutes(ctx.http, inboundCoordinator)
    createPairingRoutes(ctx.http, pairingService)

    const channelCount = router.listChannels().length
    ctx.logger.info({ channelCount, catalogSize: CHANNEL_CATALOG.length }, 'Communication module started')
  },

  async onStop(ctx: ModuleContext) {
    const comm = (ctx as any).communication
    if (comm?.mcpClient) {
      await comm.mcpClient.disconnectAll()
    }
    if (comm?.router) {
      for (const ch of comm.router.listChannels()) {
        await ch.disconnect().catch(() => {})
      }
    }
  },
}
