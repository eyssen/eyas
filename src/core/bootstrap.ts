import { createLogger } from './logger.js'
import { createDatabase, closeDatabase } from './db/connection.js'
import { createLocalBus } from './bus/local-bus.js'
import { createApp } from './http/server.js'
import { initI18n, getT } from './i18n/setup.js'
import { ModuleLoader, buildModuleList } from './module-loader.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { permissionsModule } from '@modules/permissions/index'
import { homeModule } from '@modules/home/index'
import { authModule } from '@modules/auth/index'
import { createSetupRegistry } from '@modules/setup/registry'
import { setupModule } from '@modules/setup/index'
import { setupGuard } from '@modules/setup/middleware'
import { secretsModule } from '@modules/secrets/index'
import { modelModule } from '@modules/model/index'
import { privacyModule } from '@modules/privacy/index'
import { conversationsModule } from '@modules/conversations/index'
import { boardModule } from '@modules/board/index'
import { statusbarModule } from '@modules/statusbar/index'
import { searchModule } from '@modules/search/index'
import { memoryModule } from '@modules/memory/index'
import { knowledgeModule } from '@modules/knowledge/index'
import { documentsModule } from '@modules/documents/index'
import { activityModule } from '@modules/activity/index'
import { chatterModule } from '@modules/chatter/index'
import { promptWizardModule } from '@modules/prompt-wizard/index'
import { toolsModule } from '@modules/tools/index'
import { agentModule } from '@modules/agent/index'
import { securityGateModule } from '@modules/security-gate/index'
import { schedulerModule } from '@modules/scheduler/index'
import { selfLearningModule } from '@modules/self-learning/index'
import { skillEvolutionModule } from '@modules/skill-evolution/index'
import { forgeModule } from '@modules/forge/index'
import { communicationModule } from '@modules/communication/index'
import { mediaModule } from '@modules/media/index'
import { studioModule } from '@modules/studio/index'
import { browserUseModule } from '@modules/browser-use/index'
import { proactiveAssistantModule } from '@modules/proactive-assistant/index'
import { skillsModule } from '@modules/skills/index'
import { dataPortModule } from '@modules/data-port/index'
import { extensionsModule } from '@modules/extensions/index'
import { auditModule } from '@modules/audit/index'
import { researchModule } from '@modules/research/index'
import { observabilityModule } from '@modules/observability/index'
import { ingressModule } from '@modules/ingress/index'
import { remoteNodeModule } from '@modules/remote-node/index'
import { meetingModule } from '@modules/meeting/index'
import { disasterRecoveryModule } from '@modules/disaster-recovery/index'
import { systemUpdateModule } from '@modules/system-update/index'
import { handHubModule } from '@modules/hand-hub/index'
import { notificationsModule } from '@modules/notifications/index'
// Phase-3/4 inspiration-derived modules — registered so their tables, routes,
// and services become available at bootstrap. OTel + Prometheus live under
// observability as submodules and are covered by observabilityModule.
import { eventStoreModule } from '@modules/event-store/index'
import { artifactsModule } from '@modules/artifacts/index'
import { designModule } from '@modules/design/index'
import { missionControlModule } from '@modules/mission-control/index'
import { opsModule } from '@modules/ops/index'
import { clientWikiModule } from '@modules/client-wiki/index'
import { skillGenerationModule } from '@modules/skill-generation/index'
import { ticketToCodePipelineModule } from '@modules/pipelines/ticket-to-code/index'
import { voiceModule } from '@modules/voice/index'
import { intelModule } from '@modules/intel/index'
import { ideaboxModule } from '@modules/ideabox/index'
import { costopsModule } from '@modules/costops/index'
import { odooModule } from '@modules/odoo/index'
import { connectionsModule } from '@modules/connections/index'
import { createModelGateway } from '@modules/model/gateway'
import { createConfigWatcher, type ConfigWatcher } from './config/watcher.js'
import { createTopicAcl } from './http/ws-acl.js'
import type { ModuleContext } from './types.js'
import type { SecretsRegistry } from '@modules/secrets/types'
import type { ModelGateway } from '@modules/model/types'

export interface BootstrapOptions {
  configPath?: string
  /** Skip mkdir for instance dirs (tests). Default false. */
  skipEnsureDirs?: boolean
}

let currentContext: ModuleContext | null = null
let configWatcher: ConfigWatcher | null = null
const moduleLoader = new ModuleLoader()

export async function bootstrap(options: BootstrapOptions = {}): Promise<ModuleContext> {
  const { resolveInstance } = await import('./instance.js')
  const { loadResolvedConfig } = await import('./config/loader.js')

  const instance = resolveInstance({
    configPath: options.configPath,
    ensureDirs: !options.skipEnsureDirs,
  })

  // Multi-instance: when EYAS_HOME points outside cwd, chdir so relative
  // data paths (master.key, documents, vault, …) land under the instance home.
  // Install root stays available via EYAS_INSTALL_ROOT for frontend assets.
  if (!process.env.EYAS_INSTALL_ROOT) {
    process.env.EYAS_INSTALL_ROOT = instance.installRoot
  }
  if (instance.home !== process.cwd()) {
    process.chdir(instance.home)
  }

  const config = loadResolvedConfig({
    configPath: instance.configPath,
    localConfigPath: instance.localConfigPath,
    instance,
  })
  const logger = createLogger({ level: config.log.level, pretty: config.log.pretty })
  logger.info({
    home: instance.home,
    installRoot: instance.installRoot,
    configPath: instance.configPath,
    localConfig: instance.localConfigPath,
    port: config.server.port,
    database: config.database.path,
  }, 'EYAS bootstrap starting...')

  await initI18n(config.i18n.defaultLanguage)
  const t = getT() as (key: string) => string

  const db = createDatabase(config.database.path)
  logger.info(t('db.connected'))

  const bus = createLocalBus()
  const app = createApp(config.server.allowedOrigins)
  const permissions = createPermissionRegistry()
  const setupReg = createSetupRegistry(db)
  app.use('*', setupGuard(setupReg))

  const secretsPlaceholder: SecretsRegistry = {
    get: async () => null,
    set: async () => { throw new Error('Secrets not initialized — complete setup first') },
    delete: async () => false,
    list: async () => [],
    has: async () => false,
  }

  const modelPlaceholder: ModelGateway = {
    registerProvider: () => { throw new Error('Model not initialized') },
    unregisterProvider: () => { throw new Error('Model not initialized') },
    getProvider: () => undefined,
    listProviders: () => [],
    listAllModels: async () => [],
    complete: async () => { throw new Error('Model not initialized') },
    stream: async function* () { throw new Error('Model not initialized') },
    embed: async () => { throw new Error('Model not initialized') },
  }

  // Module-specific fields (providerConfig, conversations, board, search) are
  // populated by modules during onStart — safe to cast here since modules run
  // immediately after this via moduleLoader.startAll().
  //
  // wsAcl (D14) is the one exception that must exist BEFORE startAll: the
  // auth/agent/conversations modules register their role lookup + ownership
  // resolvers on it during their own onRegister/onStart, but main.ts/serve.ts
  // only create the actual WS registry (and wire this ACL into it) AFTER
  // bootstrap() returns — so unlike ctx.wsRegistry, this can't be a
  // post-bootstrap addition or those registrations would have nothing to
  // attach to.
  const ctx = {
    config,
    db,
    bus,
    http: app,
    logger,
    i18n: { t },
    permissions,
    setup: setupReg,
    secrets: secretsPlaceholder,
    model: modelPlaceholder,
    providerReload: new Map<string, () => Promise<void>>(),
    wsAcl: createTopicAcl(),
    hasModule: (id: string) => moduleLoader.hasModule(id),
    getModule: <T>(id: string) => moduleLoader.getModule(id) as T,
    listModules: () => buildModuleList(moduleLoader, config.modules.disabled),
  } as unknown as ModuleContext

  if (!moduleLoader.hasModule(setupModule.id)) {
    moduleLoader.register(setupModule)
  }
  if (!moduleLoader.hasModule(secretsModule.id)) {
    moduleLoader.register(secretsModule)
  }
  if (!moduleLoader.hasModule(modelModule.id)) {
    moduleLoader.register(modelModule)
  }
  // Position is load-bearing: registration order drives onStart order, so
  // privacy wraps ctx.model before every model-consumer's onStart runs, and
  // observability's tracing wrapper (registered later) stays outermost.
  if (!moduleLoader.hasModule(privacyModule.id)) {
    moduleLoader.register(privacyModule)
  }
  if (!moduleLoader.hasModule(permissionsModule.id)) {
    moduleLoader.register(permissionsModule)
  }
  if (!moduleLoader.hasModule(homeModule.id)) {
    moduleLoader.register(homeModule)
  }
  if (!moduleLoader.hasModule(authModule.id)) {
    moduleLoader.register(authModule)
  }
  if (!moduleLoader.hasModule(conversationsModule.id)) {
    moduleLoader.register(conversationsModule)
  }
  if (!moduleLoader.hasModule(boardModule.id)) {
    moduleLoader.register(boardModule)
  }
  if (!moduleLoader.hasModule(statusbarModule.id)) {
    moduleLoader.register(statusbarModule)
  }
  if (!moduleLoader.hasModule(searchModule.id)) {
    moduleLoader.register(searchModule)
  }
  if (!moduleLoader.hasModule(memoryModule.id)) {
    moduleLoader.register(memoryModule)
  }
  if (!moduleLoader.hasModule(knowledgeModule.id)) {
    moduleLoader.register(knowledgeModule)
  }
  if (!moduleLoader.hasModule(activityModule.id)) {
    moduleLoader.register(activityModule)
  }
  if (!moduleLoader.hasModule(chatterModule.id)) {
    moduleLoader.register(chatterModule)
  }
  if (!moduleLoader.hasModule(documentsModule.id)) {
    moduleLoader.register(documentsModule)
  }
  if (!moduleLoader.hasModule(promptWizardModule.id)) {
    moduleLoader.register(promptWizardModule)
  }
  if (!moduleLoader.hasModule(toolsModule.id)) {
    moduleLoader.register(toolsModule)
  }
  if (!moduleLoader.hasModule(agentModule.id)) {
    moduleLoader.register(agentModule)
  }
  if (!moduleLoader.hasModule(securityGateModule.id)) {
    moduleLoader.register(securityGateModule)
  }
  if (!moduleLoader.hasModule(schedulerModule.id)) {
    moduleLoader.register(schedulerModule)
  }
  if (!moduleLoader.hasModule(selfLearningModule.id)) {
    moduleLoader.register(selfLearningModule)
  }
  if (!moduleLoader.hasModule(skillEvolutionModule.id)) {
    moduleLoader.register(skillEvolutionModule)
  }
  if (!moduleLoader.hasModule(forgeModule.id)) {
    moduleLoader.register(forgeModule)
  }
  if (!moduleLoader.hasModule(communicationModule.id)) {
    moduleLoader.register(communicationModule)
  }
  if (!moduleLoader.hasModule(mediaModule.id)) {
    moduleLoader.register(mediaModule)
  }
  if (!moduleLoader.hasModule(studioModule.id)) {
    moduleLoader.register(studioModule)
  }
  if (!moduleLoader.hasModule(browserUseModule.id)) {
    moduleLoader.register(browserUseModule)
  }
  if (!moduleLoader.hasModule(skillsModule.id)) {
    moduleLoader.register(skillsModule)
  }
  if (!moduleLoader.hasModule(dataPortModule.id)) {
    moduleLoader.register(dataPortModule)
  }
  if (!moduleLoader.hasModule(extensionsModule.id)) {
    moduleLoader.register(extensionsModule)
  }
  if (!moduleLoader.hasModule(proactiveAssistantModule.id)) {
    moduleLoader.register(proactiveAssistantModule)
  }
  if (!moduleLoader.hasModule(auditModule.id)) {
    moduleLoader.register(auditModule)
  }
  if (!moduleLoader.hasModule(researchModule.id)) {
    moduleLoader.register(researchModule)
  }
  if (!moduleLoader.hasModule(observabilityModule.id)) {
    moduleLoader.register(observabilityModule)
  }
  if (!moduleLoader.hasModule(ingressModule.id)) {
    moduleLoader.register(ingressModule)
  }
  if (!moduleLoader.hasModule(remoteNodeModule.id)) {
    moduleLoader.register(remoteNodeModule)
  }
  if (!moduleLoader.hasModule(meetingModule.id)) {
    moduleLoader.register(meetingModule)
  }
  if (!moduleLoader.hasModule(disasterRecoveryModule.id)) {
    moduleLoader.register(disasterRecoveryModule)
  }
  // After disaster-recovery so ctx.backup is available for pre-update backups.
  if (!moduleLoader.hasModule(systemUpdateModule.id)) {
    moduleLoader.register(systemUpdateModule)
  }
  if (!moduleLoader.hasModule(handHubModule.id)) {
    moduleLoader.register(handHubModule)
  }
  if (!moduleLoader.hasModule(notificationsModule.id)) {
    moduleLoader.register(notificationsModule)
  }

  // Phase-3/4 modules. Order is not critical — ModuleLoader.resolveDependencies
  // produces a correct topo order at startAll() time. event-store and artifacts
  // have no hard deps and become available early; mission-control depends on
  // event-store; ticket-to-code depends on artifacts.
  if (!moduleLoader.hasModule(eventStoreModule.id)) {
    moduleLoader.register(eventStoreModule)
  }
  if (!moduleLoader.hasModule(artifactsModule.id)) {
    moduleLoader.register(artifactsModule)
  }
  if (!moduleLoader.hasModule(designModule.id)) {
    moduleLoader.register(designModule)
  }
  if (!moduleLoader.hasModule(missionControlModule.id)) {
    moduleLoader.register(missionControlModule)
  }
  if (!moduleLoader.hasModule(opsModule.id)) {
    moduleLoader.register(opsModule)
  }
  if (!moduleLoader.hasModule(clientWikiModule.id)) {
    moduleLoader.register(clientWikiModule)
  }
  if (!moduleLoader.hasModule(skillGenerationModule.id)) {
    moduleLoader.register(skillGenerationModule)
  }
  if (!moduleLoader.hasModule(voiceModule.id)) {
    moduleLoader.register(voiceModule)
  }
  if (!moduleLoader.hasModule(intelModule.id)) {
    moduleLoader.register(intelModule)
  }
  if (!moduleLoader.hasModule(ideaboxModule.id)) {
    moduleLoader.register(ideaboxModule)
  }
  if (!moduleLoader.hasModule(costopsModule.id)) {
    moduleLoader.register(costopsModule)
  }
  if (!moduleLoader.hasModule(ticketToCodePipelineModule.id)) {
    moduleLoader.register(ticketToCodePipelineModule)
  }
  if (!moduleLoader.hasModule(odooModule.id)) {
    moduleLoader.register(odooModule)
  }
  if (!moduleLoader.hasModule(connectionsModule.id)) {
    moduleLoader.register(connectionsModule)
  }

  await moduleLoader.startAll(ctx, config.modules.disabled)

  if ((ctx as any)._secretsRegistry) {
    ctx.secrets = (ctx as any)._secretsRegistry
    delete (ctx as any)._secretsRegistry
  }

  // Start config hot-reload watcher on personality directory
  configWatcher = createConfigWatcher({
    configDir: 'config/personality',
    bus,
    logger,
  })

  logger.info('EYAS bootstrap complete.')
  currentContext = ctx
  return ctx
}

export async function shutdown(): Promise<void> {
  if (currentContext) {
    currentContext.logger.info('EYAS shutting down...')
    configWatcher?.close()
    configWatcher = null
    await moduleLoader.stopAll(currentContext)
    closeDatabase()
    currentContext = null
  }
}
