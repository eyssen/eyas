#!/usr/bin/env bun
/**
 * Generate full product documentation from UI field catalog + enrichment.
 * Overwrites skeleton pages; preserves only if FORCE=0 and page marked hand-written.
 *
 * Usage: bun scripts/generate-full-docs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(join(root, 'field-catalog.json'), 'utf8'))
const contentRoot = join(root, 'src/content/docs')
const LOCALES = ['en', 'hu', 'de', 'es']

/** UI page folder → docs slug(s) that should include that catalog */
const PAGE_MAP = {
  setup: ['setup-wizard'],
  dashboard: ['daily/dashboard'],
  conversations: ['daily/conversations'],
  board: ['daily/board'],
  projects: ['daily/projects'],
  search: ['daily/search'],
  agents: [
    'agents/overview',
    'agents/configure',
    'agents/identity-workspace',
    'agents/voice',
    'agents/teams',
    'agents/runs',
    'agents/forge',
    'agents/autonomy',
  ],
  'agent-runs': ['agents/runs'],
  'mission-control': ['agents/runs'],
  forge: ['agents/forge'],
  autonomy: ['agents/autonomy'],
  skills: ['automation/skills'],
  'skill-evolution': ['automation/self-learning'],
  tools: ['automation/tools'],
  scheduler: ['automation/scheduler'],
  pipelines: ['automation/pipelines'],
  research: ['automation/research'],
  proactive: ['automation/proactive'],
  'self-learning': ['automation/self-learning'],
  memory: ['knowledge/memory'],
  knowledge: ['knowledge/knowledge-base'],
  documents: ['knowledge/documents'],
  'client-wiki': ['knowledge/client-wiki'],
  meetings: ['knowledge/meetings'],
  communication: ['communication/channels', 'communication/telegram', 'communication/a2a'],
  providers: ['ai/providers', 'ai/routing-budget'],
  mcp: ['ai/mcp'],
  settings: ['admin/settings', 'ai/prompts', 'ai/routing-budget', 'admin/data-port'],
  users: ['admin/users'],
  'api-keys': ['admin/secrets'],
  secrets: ['admin/secrets'],
  backup: ['admin/backup'],
  security: ['admin/security-privacy'],
  privacy: ['admin/security-privacy'],
  audit: ['admin/security-privacy'],
  observability: ['admin/observability'],
  ops: ['admin/observability'],
  extensions: ['admin/observability'],
  ingress: ['admin/observability'],
  nodes: ['admin/observability'],
  notifications: ['admin/settings'],
}

/** Docs page metadata */
const META = {
  'setup-wizard': {
    titles: { en: 'Setup wizard', hu: 'Setup varázsló', de: 'Setup-Assistent', es: 'Asistente de configuración' },
    intros: {
      en: 'First-boot wizard that runs once before the main UI. It creates encryption, the owner account, primary agents, optional specialists, and at least one AI provider.',
      hu: 'Egyszer futó varázsló az első indításkor, a fő UI előtt. Titkosítást, owner fiókot, elsődleges ágenseket, opcionális specialistákat és legalább egy AI providert állít be.',
      de: 'Einmaliger Assistent vor der Haupt-UI: Verschlüsselung, Owner-Konto, Primäragenten, optionale Spezialisten und mindestens einen KI-Provider.',
      es: 'Asistente de un solo uso antes de la UI principal: cifrado, cuenta owner, agentes primarios, especialistas opcionales y al menos un proveedor de IA.',
    },
  },
  'daily/dashboard': {
    titles: { en: 'Dashboard', hu: 'Irányítópult', de: 'Dashboard', es: 'Panel' },
    intros: {
      en: 'Home screen after login: system health, setup recommendations, autonomy nudges, and shortcuts into ongoing work.',
      hu: 'Bejelentkezés utáni kezdőképernyő: rendszerállapot, setup ajánlások, autonómia nudge-ok és gyors belépés a folyamatban lévő munkába.',
      de: 'Startbildschirm nach dem Login: Systemstatus, Setup-Empfehlungen, Autonomie-Hinweise und Shortcuts.',
      es: 'Pantalla de inicio tras el login: estado del sistema, recomendaciones de setup, avisos de autonomía y accesos directos.',
    },
  },
  'daily/conversations': {
    titles: { en: 'Conversations', hu: 'Beszélgetések', de: 'Gespräche', es: 'Conversaciones' },
    intros: {
      en: 'Primary workspace for chatting with agents. Messages stream in real time; agents may call tools, open team sessions, and use the context rail (chatter, fields, attachments).',
      hu: 'Az ágensekkel való chat fő munkahelye. Az üzenetek valós időben streamelnek; az ágens toolokat hívhat, team sessiont indíthat, és a context rail-t (chatter, mezők, csatolmányok) használja.',
      de: 'Hauptarbeitsplatz für Agenten-Chat. Nachrichten streamen live; Agenten rufen Tools auf, starten Team-Sessions und nutzen die Context-Leiste.',
      es: 'Espacio principal de chat con agentes. Los mensajes llegan en streaming; los agentes llaman tools, abren sesiones de equipo y usan el riel de contexto.',
    },
  },
  'daily/board': {
    titles: { en: 'Board', hu: 'Tábla', de: 'Board', es: 'Tablero' },
    intros: {
      en: 'Work tracking surface: kanban, list, timeline, and graph views over cards linked to conversations and projects.',
      hu: 'Munkakövető felület: kanban, lista, idővonal és graph nézet kártyákkal, amik beszélgetésekhez és projektekhez kapcsolódnak.',
      de: 'Arbeits-Tracking: Kanban-, Listen-, Timeline- und Graph-Ansichten über Karten mit Gesprächen und Projekten.',
      es: 'Seguimiento del trabajo: vistas kanban, lista, línea de tiempo y grafo sobre tarjetas ligadas a conversaciones y proyectos.',
    },
  },
  'daily/projects': {
    titles: { en: 'Projects', hu: 'Projektek', de: 'Projekte', es: 'Proyectos' },
    intros: {
      en: 'Organise work with project types, stages, and project instances. Conversations can be tracked against stages.',
      hu: 'Munka szervezése projekt típusokkal, stage-ekkel és projekt példányokkal. A beszélgetések stage-ekhez köthetők.',
      de: 'Arbeit mit Projekttypen, Stages und Projektinstanzen organisieren. Gespräche können Stages zugeordnet werden.',
      es: 'Organiza el trabajo con tipos de proyecto, etapas e instancias. Las conversaciones se pueden asociar a etapas.',
    },
  },
  'daily/search': {
    titles: { en: 'Search', hu: 'Keresés', de: 'Suche', es: 'Búsqueda' },
    intros: {
      en: 'Unified full-text (and vector where available) search across board, memory, documents, knowledge, and configured external sources.',
      hu: 'Egyesített full-text (és ahol van, vektor) keresés a táblán, memóriában, dokumentumokban, tudásbázisban és a beállított külső forrásokon.',
      de: 'Einheitliche Volltext- (und ggf. Vektor-)Suche über Board, Speicher, Dokumente, Wissen und externe Quellen.',
      es: 'Búsqueda unificada de texto completo (y vectorial si aplica) en tablero, memoria, documentos, conocimiento y fuentes externas.',
    },
  },
  'agents/overview': {
    titles: { en: 'Agents overview', hu: 'Ágensek áttekintés', de: 'Agenten-Übersicht', es: 'Resumen de agentes' },
    intros: {
      en: 'List and lifecycle of AI agents. Primary teammates stay always-on; team and specialist agents extend capacity.',
      hu: 'AI ágensek listája és életciklusa. Az elsődleges társak mindig aktívak; a team és specialist ágensek bővítik a kapacitást.',
      de: 'Liste und Lebenszyklus der KI-Agenten. Primäre Teamkollegen sind dauerhaft aktiv; Team- und Spezialagenten erweitern die Kapazität.',
      es: 'Lista y ciclo de vida de agentes de IA. Los compañeros primarios están siempre activos; los de equipo y especialistas amplían la capacidad.',
    },
  },
  'agents/configure': {
    titles: { en: 'Create & configure', hu: 'Létrehozás és beállítás', de: 'Erstellen & konfigurieren', es: 'Crear y configurar' },
    intros: {
      en: 'All configuration fields on an agent detail page: identity, model, effort, tools, budgets, and classification.',
      hu: 'Az ágens részletező oldal összes beállító mezője: identitás, modell, effort, toolok, budgetek és besorolás.',
      de: 'Alle Konfigurationsfelder der Agentendetailseite: Identität, Modell, Effort, Tools, Budgets und Klassifikation.',
      es: 'Todos los campos de configuración de la ficha del agente: identidad, modelo, effort, tools, presupuestos y clasificación.',
    },
  },
  'agents/identity-workspace': {
    titles: { en: 'Identity & workspace', hu: 'Identitás és workspace', de: 'Identidad & Workspace', es: 'Identidad y workspace' },
    intros: {
      en: 'File-based workspace (IDENTITY, SOUL, rules) that shapes long-lived agent behaviour beyond the simple form fields.',
      hu: 'Fájl-alapú workspace (IDENTITY, SOUL, szabályok), ami a hosszú távú ágens-viselkedést formálja a sima űrlapmezőkön túl.',
      de: 'Dateibasierter Workspace (IDENTITY, SOUL, Regeln) für langfristiges Verhalten jenseits einfacher Formularfelder.',
      es: 'Workspace basado en archivos (IDENTITY, SOUL, reglas) que define el comportamiento a largo plazo más allá del formulario.',
    },
  },
  'agents/voice': {
    titles: { en: 'Voice profiles', hu: 'Hangprofilok', de: 'Stimmprofile', es: 'Perfiles de voz' },
    intros: {
      en: 'Internal and external speaking style: six dimensions and built-in presets. Separate profiles for how the agent talks to you vs. outsiders.',
      hu: 'Belső és külső beszédstílus: hat dimenzió és beépített presetek. Külön profil arra, ahogy veled, illetve idegenekkel beszél.',
      de: 'Interner und externer Sprechstil: sechs Dimensionen und Presets. Getrennte Profile für dich vs. Außenstehende.',
      es: 'Estilo de habla interno y externo: seis dimensiones y presets. Perfiles separados para ti frente a terceros.',
    },
  },
  'agents/teams': {
    titles: { en: 'Teams & delegation', hu: 'Csapatok és delegálás', de: 'Teams & Delegation', es: 'Equipos y delegación' },
    intros: {
      en: 'How agents collaborate: team configuration, handoffs, and multi-agent sessions in conversations.',
      hu: 'Hogyan működnek együtt az ágensek: team konfiguráció, handoffok és többágenses sessionök a beszélgetésekben.',
      de: 'Zusammenarbeit von Agenten: Team-Konfiguration, Handoffs und Multi-Agent-Sessions in Gesprächen.',
      es: 'Cómo colaboran los agentes: configuración de equipo, handoffs y sesiones multiagente en conversaciones.',
    },
  },
  'agents/runs': {
    titles: { en: 'Runs & Mission Control', hu: 'Futtatások és Mission Control', de: 'Läufe & Mission Control', es: 'Ejecuciones y Mission Control' },
    intros: {
      en: 'Observe live and historical agent runs, progress trees, and Mission Control cards for stop/resume style control.',
      hu: 'Élő és múltbeli ágens futtatások, progress fák és Mission Control kártyák a stop/resume jellegű vezérléshez.',
      de: 'Live- und historische Agentenläufe, Fortschrittsbäume und Mission-Control-Karten für Stop/Resume.',
      es: 'Ejecuciones en vivo e históricas, árboles de progreso y tarjetas de Mission Control para stop/resume.',
    },
  },
  'agents/forge': {
    titles: { en: 'Forge', hu: 'Forge', de: 'Forge', es: 'Forge' },
    intros: {
      en: 'Evolve agent soul/identity via proposals you review and apply — not silent self-rewrite.',
      hu: 'Ágens soul/identity fejlesztése javaslatokkal, amiket te reviewzol és alkalmazol — nem csendes önátírás.',
      de: 'Soul/Identity per Vorschläge weiterentwickeln, die du prüfst und anwendest — kein stilles Umschreiben.',
      es: 'Evolucionar soul/identidad con propuestas que revisas y aplicas — no reescritura silenciosa.',
    },
  },
  'agents/autonomy': {
    titles: { en: 'Autonomy', hu: 'Autonómia', de: 'Autonomie', es: 'Autonomía' },
    intros: {
      en: 'How much agents may do without asking: feature flags, approval tiers, and dashboards.',
      hu: 'Mennyit tehetnek az ágensek megkérdezés nélkül: feature flagek, approval tier-ek és dashboardok.',
      de: 'Wie viel Agenten ohne Rückfrage tun dürfen: Feature-Flags, Approval-Tiers und Dashboards.',
      es: 'Cuánto pueden hacer los agentes sin preguntar: feature flags, tiers de aprobación y paneles.',
    },
  },
  'automation/skills': {
    titles: { en: 'Skills', hu: 'Skillek', de: 'Skills', es: 'Skills' },
    intros: {
      en: 'Reusable markdown skill packs agents can load. Categories: builtin, user, evolved, and imported (own).',
      hu: 'Újrahasználható markdown skill csomagok. Kategóriák: builtin, user, evolved és importált (own).',
      de: 'Wiederverwendbare Markdown-Skill-Pakete. Kategorien: builtin, user, evolved und importiert (own).',
      es: 'Paquetes de skills en markdown reutilizables. Categorías: builtin, user, evolved e importados (own).',
    },
  },
  'automation/tools': {
    titles: { en: 'Tools', hu: 'Toolok', de: 'Tools', es: 'Tools' },
    intros: {
      en: 'Callable capabilities (shell, browser, APIs, MCP-backed tools). Assignment and permissions are per agent.',
      hu: 'Hívható képességek (shell, böngésző, API-k, MCP toolok). Hozzárendelés és jogosultság ágensenként.',
      de: 'Aufrufbare Fähigkeiten (Shell, Browser, APIs, MCP-Tools). Zuweisung und Rechte pro Agent.',
      es: 'Capacidades invocables (shell, navegador, APIs, tools MCP). Asignación y permisos por agente.',
    },
  },
  'automation/scheduler': {
    titles: { en: 'Scheduler', hu: 'Ütemező', de: 'Scheduler', es: 'Programador' },
    intros: {
      en: 'Cron-style and calendar jobs that can trigger agents or system maintenance tasks.',
      hu: 'Cron-szerű és naptár jobok, amik ágenst vagy rendszer-karbantartást indíthatnak.',
      de: 'Cron- und Kalender-Jobs, die Agenten oder Systemwartung auslösen können.',
      es: 'Jobs tipo cron y de calendario que pueden disparar agentes o mantenimiento del sistema.',
    },
  },
  'automation/pipelines': {
    titles: { en: 'Pipelines', hu: 'Pipeline-ok', de: 'Pipelines', es: 'Pipelines' },
    intros: {
      en: 'Multi-step orchestrated flows (e.g. ticket-to-code) with inputs, gates, and run history.',
      hu: 'Többlépéses orkesztrált folyamatok (pl. ticket-to-code) inputokkal, gate-ekkel és futtatás-előzményekkel.',
      de: 'Mehrstufige orchestrierte Flows (z. B. Ticket-to-Code) mit Inputs, Gates und Laufhistorie.',
      es: 'Flujos orquestados de varios pasos (p. ej. ticket-to-code) con entradas, gates e historial.',
    },
  },
  'automation/research': {
    titles: { en: 'Research', hu: 'Kutatás', de: 'Research', es: 'Investigación' },
    intros: {
      en: 'Deep research jobs that gather sources and produce reports agents can reuse.',
      hu: 'Mély kutatási jobok forrásokkal és jelentésekkel, amiket az ágensek újrahasználhatnak.',
      de: 'Tiefen-Research-Jobs mit Quellen und Berichten zur Wiederverwendung durch Agenten.',
      es: 'Trabajos de investigación profunda con fuentes e informes reutilizables por agentes.',
    },
  },
  'automation/proactive': {
    titles: { en: 'Proactive assistant', hu: 'Proaktív asszisztens', de: 'Proaktiver Assistent', es: 'Asistente proactivo' },
    intros: {
      en: 'Heartbeat-driven suggestions and actions when the system notices something worth acting on.',
      hu: 'Heartbeat-alapú javaslatok és akciók, ha a rendszer cselekvésre érdemeset észlel.',
      de: 'Heartbeat-gesteuerte Vorschläge und Aktionen, wenn das System Handlungsbedarf erkennt.',
      es: 'Sugerencias y acciones impulsadas por heartbeat cuando el sistema detecta algo accionable.',
    },
  },
  'automation/self-learning': {
    titles: { en: 'Self-learning & skill evolution', hu: 'Öntanulás és skill evolution', de: 'Selbstlernen & Skill-Evolution', es: 'Autoaprendizaje y evolución de skills' },
    intros: {
      en: 'Insights from usage and evolving skills — always reviewable before they change agent behaviour.',
      hu: 'Használatból származó insights és fejlődő skillek — mindig reviewolható, mielőtt az ágens viselkedése változna.',
      de: 'Insights aus Nutzung und evolvierende Skills — immer prüfbar, bevor sich Verhalten ändert.',
      es: 'Insights del uso y skills que evolucionan — siempre revisables antes de cambiar el comportamiento.',
    },
  },
  'knowledge/memory': {
    titles: { en: 'Memory', hu: 'Memória', de: 'Speicher', es: 'Memoria' },
    intros: {
      en: 'Five-tier memory model: working, episodic, semantic, procedural, archive — plus vault markdown for long-lived knowledge.',
      hu: 'Öt szintű memória: working, episodic, semantic, procedural, archive — plus vault markdown a hosszú távú tudáshoz.',
      de: 'Fünf-Ebenen-Speicher: working, episodic, semantic, procedural, archive — plus Vault-Markdown für langlebiges Wissen.',
      es: 'Memoria de cinco niveles: working, episodic, semantic, procedural, archive — más vault markdown para conocimiento duradero.',
    },
  },
  'knowledge/knowledge-base': {
    titles: { en: 'Knowledge base', hu: 'Tudásbázis', de: 'Wissensbasis', es: 'Base de conocimiento' },
    intros: {
      en: 'Editable wiki-style pages for structured knowledge you maintain explicitly (vs automatic memory tiers).',
      hu: 'Szerkeszthető wiki-szerű oldalak a te általad karbantartott tudáshoz (szemben az automatikus memória szintekkel).',
      de: 'Editierbare Wiki-Seiten für explizit gepflegtes Wissen (vs. automatische Speicherebenen).',
      es: 'Páginas tipo wiki editables para conocimiento que mantienes explícitamente (frente a niveles de memoria automáticos).',
    },
  },
  'knowledge/documents': {
    titles: { en: 'Documents', hu: 'Dokumentumok', de: 'Dokumente', es: 'Documentos' },
    intros: {
      en: 'Upload and index files so agents can retrieve content in conversation.',
      hu: 'Fájlok feltöltése és indexelése, hogy az ágensek a beszélgetésben visszakereshessék a tartalmat.',
      de: 'Dateien hochladen und indexieren, damit Agenten Inhalte im Gespräch abrufen können.',
      es: 'Sube e indexa archivos para que los agentes recuperen contenido en la conversación.',
    },
  },
  'knowledge/client-wiki': {
    titles: { en: 'Client wiki', hu: 'Ügyfél wiki', de: 'Kunden-Wiki', es: 'Wiki de cliente' },
    intros: {
      en: 'Per-client collaborative documentation for client-delivery work.',
      hu: 'Ügyfél-specifikus közös dokumentáció ügyfél-projektekhez.',
      de: 'Kundenbezogene gemeinsame Dokumentation für Delivery-Arbeit.',
      es: 'Documentación colaborativa por cliente para trabajo de entrega.',
    },
  },
  'knowledge/meetings': {
    titles: { en: 'Meetings', hu: 'Meetingek', de: 'Meetings', es: 'Reuniones' },
    intros: {
      en: 'Capture and process meetings into notes, summaries, and follow-up actions.',
      hu: 'Meetingek rögzítése és feldolgozása jegyzetekké, összefoglalókká és follow-up akciókká.',
      de: 'Meetings erfassen und in Notizen, Zusammenfassungen und Follow-ups überführen.',
      es: 'Capturar y procesar reuniones en notas, resúmenes y acciones de seguimiento.',
    },
  },
  'communication/channels': {
    titles: { en: 'Channels overview', hu: 'Csatornák áttekintés', de: 'Kanäle-Übersicht', es: 'Resumen de canales' },
    intros: {
      en: 'Communication module: channel instances, pairing, inbound queue, and binding channels to agents.',
      hu: 'Kommunikációs modul: csatorna példányok, pairing, inbound queue, és csatornák kötése ágensekhez.',
      de: 'Kommunikationsmodul: Kanalinstanzen, Pairing, Inbound-Queue und Bindung an Agenten.',
      es: 'Módulo de comunicación: instancias de canal, pairing, cola entrante y enlace a agentes.',
    },
  },
  'communication/telegram': {
    titles: { en: 'Telegram', hu: 'Telegram', de: 'Telegram', es: 'Telegram' },
    intros: {
      en: 'Connect Telegram bot instances, pair users, and route inbound messages to agents.',
      hu: 'Telegram bot példányok, pairing, bejövő üzenetek routingja ágensekhez.',
      de: 'Telegram-Bot-Instanzen verbinden, Nutzer pairen und Nachrichten an Agenten routen.',
      es: 'Conectar bots de Telegram, emparejar usuarios y enrutar mensajes entrantes a agentes.',
    },
  },
  'communication/a2a': {
    titles: { en: 'A2A & external agents', hu: 'A2A és külső ágensek', de: 'A2A & externe Agenten', es: 'A2A y agentes externos' },
    intros: {
      en: 'Agent-to-agent protocol and well-known agent card for interoperable agent ecosystems.',
      hu: 'Ágens–ágens protokoll és well-known agent card az interoperábilis ökoszisztémákhoz.',
      de: 'Agent-zu-Agent-Protokoll und well-known Agent Card für interoperable Ökosysteme.',
      es: 'Protocolo agente–agente y agent card well-known para ecosistemas interoperables.',
    },
  },
  'ai/providers': {
    titles: { en: 'Providers', hu: 'Providerek', de: 'Provider', es: 'Proveedores' },
    intros: {
      en: 'AI backends: cloud APIs (Anthropic, OpenAI, Gemini, xAI, …), host CLIs (Claude Code, Grok, Kimi), and local runtimes (Ollama, LM Studio, vLLM).',
      hu: 'AI backendek: felhő API-k (Anthropic, OpenAI, Gemini, xAI, …), host CLI-k (Claude Code, Grok, Kimi) és helyi runtime-ok (Ollama, LM Studio, vLLM).',
      de: 'KI-Backends: Cloud-APIs, Host-CLIs und lokale Runtimes (Ollama, LM Studio, vLLM).',
      es: 'Backends de IA: APIs cloud, CLIs del host y runtimes locales (Ollama, LM Studio, vLLM).',
    },
  },
  'ai/routing-budget': {
    titles: { en: 'Routing & budget', hu: 'Routing és budget', de: 'Routing & Budget', es: 'Enrutado y presupuesto' },
    intros: {
      en: 'Which model handles which workload, fallbacks, model assignments, and token/cost budgets.',
      hu: 'Melyik modell milyen munkát kap, fallbackek, modell-hozzárendelések, token/költség budgetek.',
      de: 'Welches Modell welche Last trägt, Fallbacks, Zuweisungen und Token-/Kostenbudgets.',
      es: 'Qué modelo cubre cada carga, fallbacks, asignaciones y presupuestos de tokens/coste.',
    },
  },
  'ai/prompts': {
    titles: { en: 'Prompts system', hu: 'Prompt rendszer', de: 'Prompt-System', es: 'Sistema de prompts' },
    intros: {
      en: 'Layered prompts: master → project-type → project → conversation, with locked and editable sections.',
      hu: 'Réteges prompok: master → project-type → project → conversation, zárolt és szerkeszthető szekciókkal.',
      de: 'Geschichtete Prompts: Master → Projekttyp → Projekt → Gespräch, mit gesperrten und editierbaren Abschnitten.',
      es: 'Prompts en capas: master → tipo de proyecto → proyecto → conversación, con secciones bloqueadas y editables.',
    },
  },
  'ai/mcp': {
    titles: { en: 'MCP servers', hu: 'MCP szerverek', de: 'MCP-Server', es: 'Servidores MCP' },
    intros: {
      en: 'Model Context Protocol servers that expose external tools and data sources to agents.',
      hu: 'Model Context Protocol szerverek, amik külső toolokat és adatforrásokat adnak az ágenseknek.',
      de: 'Model Context Protocol-Server, die externe Tools und Datenquellen für Agenten freigeben.',
      es: 'Servidores Model Context Protocol que exponen tools y datos externos a los agentes.',
    },
  },
  'admin/users': {
    titles: { en: 'Users & permissions', hu: 'Felhasználók és jogosultságok', de: 'Benutzer & Rechte', es: 'Usuarios y permisos' },
    intros: {
      en: 'User accounts and CASL-based permissions for multi-user installs.',
      hu: 'Felhasználói fiókok és CASL-alapú jogosultságok többfelhasználós telepítéshez.',
      de: 'Benutzerkonten und CASL-Rechte für Mehrbenutzer-Installationen.',
      es: 'Cuentas de usuario y permisos CASL para instalaciones multiusuario.',
    },
  },
  'admin/secrets': {
    titles: { en: 'Secrets & API keys', hu: 'Secrettek és API kulcsok', de: 'Secrets & API-Schlüssel', es: 'Secretos y claves API' },
    intros: {
      en: 'Encrypted secrets store (scoped) and machine API keys for programmatic access to EYAS.',
      hu: 'Titkosított, scope-olt secret tár és gépi API kulcsok az EYAS programozott eléréséhez.',
      de: 'Verschlüsselter, gescopter Secret-Store und Maschinen-API-Keys für programmatischen Zugriff.',
      es: 'Almacén cifrado de secretos con scope y claves API de máquina para acceso programático.',
    },
  },
  'admin/settings': {
    titles: { en: 'Settings overview', hu: 'Beállítások áttekintés', de: 'Einstellungen-Übersicht', es: 'Resumen de ajustes' },
    intros: {
      en: 'System settings hub: appearance, language, model assignments, team agents, autonomy features, data port, and system update.',
      hu: 'Rendszerbeállítások központ: megjelenés, nyelv, modell-hozzárendelések, team ágensek, autonómia, data port, frissítés.',
      de: 'System-Einstellungen: Erscheinungsbild, Sprache, Modellzuweisungen, Team-Agenten, Autonomie, Data Port, Update.',
      es: 'Centro de ajustes: apariencia, idioma, asignaciones de modelo, agentes de equipo, autonomía, data port, actualización.',
    },
  },
  'admin/backup': {
    titles: { en: 'Backup & restore', hu: 'Backup és visszaállítás', de: 'Backup & Wiederherstellung', es: 'Copia y restauración' },
    intros: {
      en: 'Create archives of data and config; restore onto a clean install of the same product version.',
      hu: 'Adat és config archívumok; visszaállítás tiszta installra, ugyanarra a termékverzióra.',
      de: 'Archive von Daten und Config; Restore auf saubere Installation derselben Produktversion.',
      es: 'Archivos de datos y config; restaurar en instalación limpia de la misma versión.',
    },
  },
  'admin/data-port': {
    titles: { en: 'Data import & export', hu: 'Adatimport és -export', de: 'Datenimport & -export', es: 'Importación y exportación' },
    intros: {
      en: 'Import memory, skills, and workspace rules from paths or uploads; apply only after explicit approve.',
      hu: 'Memória, skillek, workspace szabályok importja pathról vagy feltöltésből; alkalmazás csak explicit approve után.',
      de: 'Import von Speicher, Skills und Workspace-Regeln; Apply erst nach explizitem Approve.',
      es: 'Importar memoria, skills y reglas de workspace; aplicar solo tras approve explícito.',
    },
  },
  'admin/security-privacy': {
    titles: { en: 'Security & privacy', hu: 'Biztonság és adatvédelem', de: 'Sicherheit & Datenschutz', es: 'Seguridad y privacidad' },
    intros: {
      en: 'Security gate, audit log, privacy controls, and security events.',
      hu: 'Security gate, audit napló, privacy kontrollok és security események.',
      de: 'Security Gate, Audit-Log, Privacy-Kontrollen und Security-Events.',
      es: 'Security gate, auditoría, controles de privacidad y eventos de seguridad.',
    },
  },
  'admin/observability': {
    titles: { en: 'Observability & ops', hu: 'Observability és ops', de: 'Observability & Ops', es: 'Observabilidad y ops' },
    intros: {
      en: 'Metrics, tracing, ops tooling, remote hands/nodes, ingress, and extensions.',
      hu: 'Metrikák, tracing, ops eszközök, remote hands/node-ok, ingress és extensionök.',
      de: 'Metriken, Tracing, Ops-Tools, Remote Hands/Nodes, Ingress und Extensions.',
      es: 'Métricas, tracing, herramientas ops, hands/nodos remotos, ingress y extensiones.',
    },
  },
  'deploy/native': {
    titles: { en: 'Native install', hu: 'Natív telepítés', de: 'Native Installation', es: 'Instalación nativa' },
    intros: {
      en: 'Install EYAS with Bun on macOS/Linux (or Windows via scripts), without containers.',
      hu: 'EYAS telepítése Bunnal macOS/Linuxon (Windows scriptekkel), konténer nélkül.',
      de: 'EYAS mit Bun auf macOS/Linux (Windows per Skript), ohne Container.',
      es: 'Instalar EYAS con Bun en macOS/Linux (Windows con scripts), sin contenedores.',
    },
  },
  'deploy/docker': {
    titles: { en: 'Docker', hu: 'Docker', de: 'Docker', es: 'Docker' },
    intros: {
      en: 'Run EYAS with Docker Compose, including optional GPU/Ollama profile.',
      hu: 'EYAS futtatása Docker Compose-zal, opcionális GPU/Ollama profillal.',
      de: 'EYAS mit Docker Compose, optional GPU/Ollama-Profil.',
      es: 'Ejecutar EYAS con Docker Compose, perfil GPU/Ollama opcional.',
    },
  },
  'deploy/kubernetes': {
    titles: { en: 'Kubernetes', hu: 'Kubernetes', de: 'Kubernetes', es: 'Kubernetes' },
    intros: {
      en: 'Deploy with manifests and Helm chart under deploy/k8s/.',
      hu: 'Telepítés a deploy/k8s/ manifestekkel és Helm charttal.',
      de: 'Deploy mit Manifesten und Helm-Chart unter deploy/k8s/.',
      es: 'Desplegar con manifiestos y chart Helm en deploy/k8s/.',
    },
  },
  'deploy/multi-instance': {
    titles: { en: 'Multiple instances', hu: 'Több példány', de: 'Mehrere Instanzen', es: 'Varias instancias' },
    intros: {
      en: 'Run several EYAS instances on one machine via EYAS_HOME, ports, and separate data dirs.',
      hu: 'Több EYAS példány egy gépen: EYAS_HOME, portok, külön data könyvtárak.',
      de: 'Mehrere EYAS-Instanzen: EYAS_HOME, Ports, getrennte Datenverzeichnisse.',
      es: 'Varias instancias: EYAS_HOME, puertos y directorios de datos separados.',
    },
  },
  'deploy/cli': {
    titles: { en: 'CLI reference', hu: 'CLI referencia', de: 'CLI-Referenz', es: 'Referencia CLI' },
    intros: {
      en: 'Command-line interface: lifecycle, diagnostics, config, and modules.',
      hu: 'Parancssori felület: életciklus, diagnosztika, config, modulok.',
      de: 'Kommandozeile: Lebenszyklus, Diagnose, Config, Module.',
      es: 'Interfaz de línea de comandos: ciclo de vida, diagnóstico, config y módulos.',
    },
  },
  'deploy/configuration': {
    titles: { en: 'Configuration', hu: 'Konfiguráció', de: 'Konfiguration', es: 'Configuración' },
    intros: {
      en: 'YAML defaults, local overlays, and EYAS_* environment variables.',
      hu: 'YAML alapok, local overlay-ek és EYAS_* környezeti változók.',
      de: 'YAML-Defaults, lokale Overlays und EYAS_*-Umgebungsvariablen.',
      es: 'YAML por defecto, overlays locales y variables EYAS_*.',
    },
  },
  'reference/glossary': {
    titles: { en: 'Glossary', hu: 'Szójegyzék', de: 'Glossar', es: 'Glosario' },
    intros: {
      en: 'Terms used across the product UI and this documentation.',
      hu: 'A termék UI-jában és ebben a dokumentációban használt fogalmak.',
      de: 'Begriffe in der Produkt-UI und dieser Dokumentation.',
      es: 'Términos usados en la UI del producto y en esta documentación.',
    },
  },
  'reference/faq': {
    titles: { en: 'FAQ', hu: 'GYIK', de: 'FAQ', es: 'FAQ' },
    intros: {
      en: 'Common problems and short answers.',
      hu: 'Gyakori problémák és rövid válaszok.',
      de: 'Häufige Probleme und kurze Antworten.',
      es: 'Problemas frecuentes y respuestas cortas.',
    },
  },
  'reference/architecture': {
    titles: { en: 'Architecture (pointer)', hu: 'Architektúra (mutató)', de: 'Architektur (Verweis)', es: 'Arquitectura (enlace)' },
    intros: {
      en: 'Where deep technical specifications live in the repository (not duplicated here).',
      hu: 'Hol vannak a mély technikai specifikációk a repóban (itt nincsenek lemásolva).',
      de: 'Wo tiefe technische Specs im Repo liegen (hier nicht dupliziert).',
      es: 'Dónde están las specs técnicas profundas en el repo (no duplicadas aquí).',
    },
  },
  concepts: {
    titles: { en: 'Core concepts', hu: 'Alapfogalmak', de: 'Grundkonzepte', es: 'Conceptos básicos' },
    intros: {
      en: 'Mental model of EYAS: agents, conversations, board, memory, skills, tools, and channels.',
      hu: 'Az EYAS mentális modellje: ágensek, beszélgetések, tábla, memória, skillek, toolok és csatornák.',
      de: 'Mentales Modell von EYAS: Agenten, Gespräche, Board, Speicher, Skills, Tools und Kanäle.',
      es: 'Modelo mental de EYAS: agentes, conversaciones, tablero, memoria, skills, tools y canales.',
    },
  },
  'getting-started': {
    titles: { en: 'Getting started', hu: 'Első lépések', de: 'Erste Schritte', es: 'Primeros pasos' },
    intros: {
      en: 'Install EYAS, start the server, complete the wizard, and open the UI.',
      hu: 'EYAS telepítése, szerver indítása, varázsló, UI megnyitása.',
      de: 'EYAS installieren, Server starten, Assistent, UI öffnen.',
      es: 'Instalar EYAS, arrancar el servidor, asistente y abrir la UI.',
    },
  },
}

// Skip pure chrome keys that add noise without being "fields"
const SKIP_RE =
  /\.(loading|pleaseWait|error|loadError|loadFailed|saveFailed|retry|saved|saving|emptyHint|toOpenClose|toDismiss|ph|placeholder)$/i

const SKIP_KEY_RE =
  /\.(loading|empty|emptyTitle|emptyHint|notFound|loadError|saveError|saveFailed|executing|scheduling|pleaseWait|placeholder|ph)$/i

function cell(s) {
  return String(s || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

/** Domain knowledge keyed by substring of i18n key (first match wins). */
const DOMAIN = {
  en: [
    [/password|masterPassword|confirmPassword/, 'Secret password. Never logged; secrets are encrypted at rest under the Secrets module.'],
    [/apiKey|apikey|token(?!Budget|sUsage)/i, 'Credential for a provider or machine client. Stored encrypted when saved from the UI.'],
    [/monthlyTokenBudget|tokenBudget|budget/, 'Usage cap (tokens or cost). `0` usually means unlimited for that counter.'],
    [/\.model$|modelAuto|modelCount|modelAssign/, 'LLM model selection. **Auto** defers to routing policy / assignments.'],
    [/effort/, 'Reasoning effort: higher = deeper thinking, slower and more expensive.'],
    [/orchestrat/, 'How aggressively the agent may fan out to sub-agents (Solo / Auto / Deep).'],
    [/enable|enabled|active|disabled/, 'On/off state without deleting the entity.'],
    [/filter/, 'List filter only — does not delete underlying data.'],
    [/tier|primary|specialist/, 'Agent tier: primary (always-on), team, or specialist.'],
    [/channel|bind|unbind|pairing/, 'Messaging channel instance binding or pairing with an external account.'],
    [/cron|schedule|job/, 'When a scheduled job runs or how it is listed.'],
    [/scope/, 'Access boundary (e.g. system / user / agent) for secrets or permissions.'],
    [/systemPrompt/, 'Base instructions injected for this agent (in addition to layered prompt templates).'],
    [/goal|backstory|persona|role|description|name/, 'Identity text that shapes how the agent presents and decides.'],
    [/tools|capabilities|constraints/, 'What the agent may use or must respect (tools list, capability tags, constraint lines).'],
    [/maxTurns/, 'Hard stop on agent loop turns for a single run.'],
    [/voice|preset|dimension|address|tone|humor|emoji/, 'Voice profile control (speaking style).'],
    [/workspace|IDENTITY|SOUL|fileLabel/, 'Workspace file in the agent file-based identity system.'],
    [/memory|salience|episodic|working/, 'Memory entry or tier used for long-term / session recall.'],
    [/project|stage|priority|status|dueDate/, 'Business field on a conversation or board record.'],
    [/provider/, 'AI backend (cloud API, host CLI, or local runtime).'],
    [/secret/, 'Encrypted secret entry in the vault-like secrets store.'],
    [/backup|restore/, 'Backup archive create/restore workflow.'],
    [/import|export|dataPort/, 'Data portability (import proposal → approve, or export).'],
    [/mcp/, 'Model Context Protocol server connection.'],
    [/prompt/, 'Prompt template layer in the inheritance chain.'],
    [/theme|template|language|lang|appearance/, 'UI appearance or product language preference.'],
    [/avatar/, 'Emoji or image shown as the agent avatar.'],
  ],
  hu: [
    [/password|masterPassword|confirmPassword/, 'Jelszó. Nem logolódik; mentéskor a Secrets modul titkosítja.'],
    [/apiKey|apikey|token(?!Budget|sUsage)/i, 'Provider vagy gépi hitelesítő. UI mentéskor titkosítva a Secrets alatt.'],
    [/monthlyTokenBudget|tokenBudget|budget/, 'Használati plafon (token/költség). A `0` általában korlátlan.'],
    [/\.model$|modelAuto|modelCount|modelAssign/, 'LLM modell választás. **Auto** = routing / assignment dönt.'],
    [/effort/, 'Gondolkodási effort: magasabb = mélyebb, lassabb, drágább.'],
    [/orchestrat/, 'Sub-agent fan-out agresszivitás (Solo / Auto / Deep).'],
    [/enable|enabled|active|disabled/, 'Ki/be kapcsolás törlés nélkül.'],
    [/filter/, 'Csak listaszűrő — nem töröl adatot.'],
    [/tier|primary|specialist/, 'Ágens szint: primary, team vagy specialist.'],
    [/channel|bind|unbind|pairing/, 'Csatorna példány kötése vagy pairing külső fiókkal.'],
    [/cron|schedule|job/, 'Ütemezett job futása / listázása.'],
    [/scope/, 'Hozzáférési határ (system / user / agent).'],
    [/systemPrompt/, 'Ágens alap utasításai (a réteges prompt lánc mellett).'],
    [/goal|backstory|persona|role|description|name/, 'Identitás szöveg — megjelenés és döntési keret.'],
    [/tools|capabilities|constraints/, 'Mit használhat / mit tilos (toolok, capability tag-ek, constraint sorok).'],
    [/maxTurns/, 'Max forduló egy futtatásban.'],
    [/voice|preset|dimension|address|tone|humor|emoji/, 'Hangprofil (beszédstílus) vezérlő.'],
    [/workspace|IDENTITY|SOUL|fileLabel/, 'Workspace fájl az ágens fájl-alapú identity rendszerében.'],
    [/memory|salience|episodic|working/, 'Memória bejegyzés vagy szint.'],
    [/project|stage|priority|status|dueDate/, 'Üzleti mező beszélgetésen / tábla rekordon.'],
    [/provider/, 'AI backend (felhő API, host CLI vagy helyi runtime).'],
    [/secret/, 'Titkosított secret a Secrets tárban.'],
    [/backup|restore/, 'Backup készítés / visszaállítás.'],
    [/import|export|dataPort/, 'Adatportálás (import javaslat → approve, vagy export).'],
    [/mcp/, 'Model Context Protocol szerver.'],
    [/prompt/, 'Prompt sablon a láncban.'],
    [/theme|template|language|lang|appearance/, 'Megjelenés vagy terméknyelv.'],
    [/avatar/, 'Ágens avatar (emoji/kép).'],
  ],
}

function enrichExplanation(key, field, locale, allFields) {
  const label = field[locale] || field.en || key
  const k = key

  // Prefer sibling hint/desc in the same catalog group
  const base = k.replace(/\.(label|title|heading|name)$/i, '')
  const hintKeys = [`${base}.hint`, `${base}.desc`, `${base}.description`, `${base}.subtitle`]
  for (const hk of hintKeys) {
    const h = allFields.find((x) => x.key === hk)
    if (h && (h[locale] || h.en)) {
      return cell(h[locale] || h.en)
    }
  }

  // If the string itself is already instructional, use the localized label as explanation
  if (/hint|desc|subtitle|description|placeholder/i.test(k) || label.length > 48) {
    return cell(label)
  }

  const rules = DOMAIN[locale] || DOMAIN.en
  for (const [re, text] of rules) {
    if (re.test(k) || re.test(label)) return text
  }

  // Fallbacks by locale
  if (locale === 'hu') {
    return `Felirat/vezérlő a UI-n: „${cell(label)}”. A stabil azonosító: \`${k}\` (i18n kulcs). Az érték a képernyő mentésekor a kapcsolódó API-n keresztül íródik.`
  }
  if (locale === 'de') {
    return `UI-Text/Steuerung: „${cell(label)}“. Stabiler Key: \`${k}\`. Wert wird über die zugehörige API gespeichert.`
  }
  if (locale === 'es') {
    return `Texto/control de UI: «${cell(label)}». Clave estable: \`${k}\`. El valor se guarda vía la API correspondiente.`
  }
  return `UI label/control shown as “${cell(label)}”. Stable i18n key: \`${k}\`. Values are validated and persisted by the related API module when you save.`
}

/** Optional key include/exclude filters so one UI page can feed multiple docs without dumping everything everywhere */
const FIELD_FILTERS = {
  'agents/overview': (k) =>
    /agents\.(list|badge|tier|agentType)\./.test(k),
  'agents/configure': (k) =>
    /agents\.detail\./.test(k) && !/agents\.detail\.tab\.(voice|workspace|channels|memories)/.test(k),
  'agents/identity-workspace': (k) => /agents\.workspaceTab\.|agents\.detail\.tab\.workspace/.test(k),
  'agents/voice': (k) => /agents\.voiceTab\.|agents\.detail\.tab\.voice/.test(k),
  'agents/teams': (k) => /team|delegat|handoff/i.test(k),
  'agents/runs': (k) => true, // agent-runs + mission-control catalogs
  'agents/forge': (k) => true,
  'agents/autonomy': (k) => true,
  'communication/telegram': (k) => /telegram|pairing|bot/i.test(k) || /communication\./.test(k),
  'communication/a2a': (k) => /a2a|agent.?card/i.test(k) || /communication\./.test(k),
  'communication/channels': (k) => /communication\.|channel/i.test(k),
  'ai/routing-budget': (k) => /budget|routing|assignment|modelAssign|tier/i.test(k) || /settings\.|providers\./.test(k),
  'ai/prompts': (k) => /prompt/i.test(k),
  'admin/data-port': (k) => /dataPort|data-port|import|export/i.test(k),
  'admin/settings': (k) => /settings\./.test(k),
}

function fieldsForSlug(slug) {
  const pages = Object.entries(PAGE_MAP)
    .filter(([, slugs]) => slugs.includes(slug))
    .map(([page]) => page)
  const filter = FIELD_FILTERS[slug]
  const seen = new Set()
  const out = []
  for (const page of pages) {
    for (const f of catalog[page] || []) {
      if (seen.has(f.key)) continue
      if (SKIP_RE.test(f.key)) continue
      if (filter && !filter(f.key)) continue
      seen.add(f.key)
      out.push(f)
    }
  }
  return out
}

function fieldTable(fields, locale) {
  if (fields.length === 0) return ''
  const headers = {
    en: '| Field / label | Key | What it means |\n|---|---|---|',
    hu: '| Mező / felirat | Kulcs | Mit jelent |\n|---|---|---|',
    de: '| Feld / Label | Key | Bedeutung |\n|---|---|---|',
    es: '| Campo / etiqueta | Clave | Significado |\n|---|---|---|',
  }
  const lines = [headers[locale]]
  for (const f of fields) {
    if (SKIP_KEY_RE.test(f.key)) continue
    const label = cell(f[locale] || f.en || f.key)
    if (!label) continue
    const expl = enrichExplanation(f.key, f, locale, fields)
    lines.push(`| ${label} | \`${f.key}\` | ${expl} |`)
  }
  return lines.join('\n')
}

function sectionHeading(locale, n) {
  const map = {
    en: { overview: 'Overview', fields: 'Fields and controls', how: 'How to use', related: 'Related pages', notes: 'Notes' },
    hu: { overview: 'Áttekintés', fields: 'Mezők és vezérlők', how: 'Használat', related: 'Kapcsolódó oldalak', notes: 'Megjegyzések' },
    de: { overview: 'Überblick', fields: 'Felder und Steuerung', how: 'Verwendung', related: 'Verwandte Seiten', notes: 'Hinweise' },
    es: { overview: 'Resumen', fields: 'Campos y controles', how: 'Cómo usarlo', related: 'Páginas relacionadas', notes: 'Notas' },
  }
  return map[locale][n]
}

/** Extra hand-crafted blocks for pages without enough locale fields */
function extraBlocks(slug, locale) {
  if (slug === 'getting-started') {
    const blocks = {
      en: `## Prerequisites

- **Bun** 1.x (recommended) or Node.js 22+
- Optional: Docker / Docker Compose

## Install (native)

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
\`\`\`

Open **http://localhost:3100** (or the port from config). Complete the [setup wizard](/docs/en/setup-wizard/).

## Lifecycle commands

| Command | Meaning |
|---------|---------|
| \`eyas serve\` | Foreground server (logs in terminal) |
| \`eyas start\` | Background server + pidfile |
| \`eyas stop\` | Stop background server |
| \`eyas restart\` | stop then start |
| \`eyas status\` | Health + PID |
| \`eyas doctor\` | Local diagnostics |

Frontend and product docs auto-build on start when missing (\`build:web\`, \`docs:build\`).
`,
      hu: `## Előfeltételek

- **Bun** 1.x (ajánlott) vagy Node.js 22+
- Opcionális: Docker / Docker Compose

## Telepítés (natív)

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
\`\`\`

Nyisd meg: **http://localhost:3100**. Végezd el a [setup varázslót](/docs/hu/setup-wizard/).

## Életciklus parancsok

| Parancs | Jelentés |
|---------|----------|
| \`eyas serve\` | Előtérben (log a terminálban) |
| \`eyas start\` | Háttér + pidfile |
| \`eyas stop\` | Leállítás |
| \`eyas restart\` | stop majd start |
| \`eyas status\` | Health + PID |
| \`eyas doctor\` | Helyi diagnosztika |

A frontend és a termékdokumentáció hiány/elavultság esetén automatikusan buildel indításkor.
`,
      de: `## Voraussetzungen

- **Bun** 1.x oder Node.js 22+
- Optional: Docker Compose

## Installation

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
\`\`\`

**http://localhost:3100** öffnen und den [Setup-Assistenten](/docs/de/setup-wizard/) abschließen.
`,
      es: `## Requisitos

- **Bun** 1.x o Node.js 22+
- Opcional: Docker Compose

## Instalación

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
\`\`\`

Abre **http://localhost:3100** y completa el [asistente](/docs/es/setup-wizard/).
`,
    }
    return blocks[locale] || blocks.en
  }

  if (slug === 'concepts') {
    const blocks = {
      en: `## Building blocks

| Concept | Meaning |
|---------|---------|
| **Agent** | Named AI persona with model, tools, skills, memory, voice, and channels |
| **Conversation** | Thread of messages with one or more agents; may spawn tool calls and sub-runs |
| **Board card** | Trackable unit of work, often linked to a conversation |
| **Project / stage** | Structure for grouping conversations along a delivery path |
| **Skill** | Reusable procedural knowledge pack (markdown) agents can load |
| **Tool** | Callable action (code, browser, API, MCP) with permissions |
| **Memory tier** | Working → episodic → semantic/procedural → archive (+ vault files) |
| **Channel** | External inbox/outbox (e.g. Telegram) bound to an agent |
| **Provider** | LLM backend (API or local CLI/runtime) |
| **Security gate** | Policy checks before dangerous actions |

## Typical flow

1. Setup wizard creates owner + primary agents + provider  
2. You open a **conversation** or create a **board** card  
3. Agent may use **tools/skills**, write **memory**, or **delegate**  
4. Results land in chat, board, documents, or outbound **channels**
`,
      hu: `## Építőelemek

| Fogalom | Jelentés |
|---------|----------|
| **Ágens** | Elnevezett AI persona: modell, toolok, skillek, memória, hang, csatornák |
| **Beszélgetés** | Üzenetfolyam egy vagy több ágenssel; tool hívások és sub-runok |
| **Tábla kártya** | Követhető munkaegység, gyakran beszélgetéshez kötve |
| **Projekt / stage** | Beszélgetések csoportosítása szállítási útvonal mentén |
| **Skill** | Újrahasználható eljárási tudáscsomag (markdown) |
| **Tool** | Hívható akció jogosultságokkal |
| **Memória szint** | Working → episodic → semantic/procedural → archive (+ vault) |
| **Csatorna** | Külső be/kimenet (pl. Telegram) ágenshez kötve |
| **Provider** | LLM backend (API vagy helyi CLI/runtime) |
| **Security gate** | Szabályellenőrzés veszélyes műveletek előtt |

## Tipikus folyamat

1. Setup: owner + primary ágensek + provider  
2. **Beszélgetés** vagy **tábla** kártya  
3. Ágens **tool/skill**, **memória**, **delegálás**  
4. Eredmény: chat, tábla, dokumentumok vagy **csatorna**
`,
      de: `## Bausteine

| Konzept | Bedeutung |
|---------|-----------|
| **Agent** | KI-Persona mit Modell, Tools, Skills, Speicher, Stimme, Kanälen |
| **Gespräch** | Nachrichten-Thread; Tools und Sub-Runs möglich |
| **Board-Karte** | Nachverfolgbare Arbeitseinheit |
| **Projekt / Stage** | Struktur für Conversations entlang eines Delivery-Pfads |
| **Skill** | Wiederverwendbares Wissenspaket |
| **Tool** | Aufrufbare Aktion mit Rechten |
| **Speicher-Ebene** | Working → episodic → semantic/procedural → archive |
| **Kanal** | Externer Ein-/Ausgang an einen Agenten gebunden |
| **Provider** | LLM-Backend |
| **Security Gate** | Policy vor riskanten Aktionen |
`,
      es: `## Bloques

| Concepto | Significado |
|----------|-------------|
| **Agente** | Persona de IA con modelo, tools, skills, memoria, voz y canales |
| **Conversación** | Hilo de mensajes; puede usar tools y sub-runs |
| **Tarjeta del tablero** | Unidad de trabajo rastreable |
| **Proyecto / etapa** | Estructura de entrega |
| **Skill** | Paquete de conocimiento reutilizable |
| **Tool** | Acción invocable con permisos |
| **Nivel de memoria** | Working → episodic → semantic/procedural → archive |
| **Canal** | Entrada/salida externa ligada a un agente |
| **Proveedor** | Backend LLM |
| **Security gate** | Política antes de acciones peligrosas |
`,
    }
    return blocks[locale] || blocks.en
  }

  if (slug === 'deploy/cli') {
    const blocks = {
      en: `## Commands

| Command | Description |
|---------|-------------|
| \`eyas serve\` | Start HTTP server in foreground |
| \`eyas start\` | Background start (pidfile + log) |
| \`eyas stop\` | Stop background process |
| \`eyas restart\` | Restart |
| \`eyas status\` | Running status / health |
| \`eyas doctor\` | Environment checks |
| \`eyas version\` | Version string |
| \`eyas config validate\` | Validate YAML config |
| \`eyas config reload\` | Hot-reload config where supported |
| \`eyas module list\` | List modules |
| \`eyas module enable/disable <id>\` | Toggle module |

### Environment

| Variable | Role |
|----------|------|
| \`EYAS_PORT\` / \`EYAS_HOST\` | Listen bind |
| \`EYAS_HOME\` | Instance home (data, local config, pid) |
| \`EYAS_INSTALL_ROOT\` | Code install path |
| \`EYAS_SKIP_WEB_BUILD\` | Skip auto frontend build |
| \`EYAS_SKIP_DOCS_BUILD\` | Skip auto docs build |
| \`EYAS_FORCE_WEB_BUILD\` / \`EYAS_FORCE_DOCS_BUILD\` | Force rebuild on start |
`,
      hu: `## Parancsok

| Parancs | Leírás |
|---------|--------|
| \`eyas serve\` | HTTP szerver előtérben |
| \`eyas start\` | Háttér (pidfile + log) |
| \`eyas stop\` | Leállítás |
| \`eyas restart\` | Újraindítás |
| \`eyas status\` | Státusz / health |
| \`eyas doctor\` | Környezet ellenőrzés |
| \`eyas version\` | Verzió |
| \`eyas config validate\` | YAML validálás |
| \`eyas config reload\` | Hot-reload (ahol támogatott) |
| \`eyas module list\` | Modulok listája |
| \`eyas module enable/disable <id>\` | Modul ki/be |

### Környezeti változók

| Változó | Szerep |
|---------|--------|
| \`EYAS_PORT\` / \`EYAS_HOST\` | Listen |
| \`EYAS_HOME\` | Példány home (data, local config, pid) |
| \`EYAS_INSTALL_ROOT\` | Kód install path |
| \`EYAS_SKIP_WEB_BUILD\` | Frontend auto-build kihagyása |
| \`EYAS_SKIP_DOCS_BUILD\` | Docs auto-build kihagyása |
| \`EYAS_FORCE_WEB_BUILD\` / \`EYAS_FORCE_DOCS_BUILD\` | Kényszerített rebuild |
`,
      de: `## Befehle

Siehe englische Tabelle — dieselben CLI-Namen: \`serve\`, \`start\`, \`stop\`, \`doctor\`, \`module\`, \`config\`.
`,
      es: `## Comandos

Misma CLI en todos los idiomas: \`serve\`, \`start\`, \`stop\`, \`doctor\`, \`module\`, \`config\`.
`,
    }
    return blocks[locale] || blocks.en
  }

  if (slug === 'deploy/docker') {
    return {
      en: `## Quick start

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
\`\`\`

Open **http://localhost:3100**.

GPU + Ollama profile:

\`\`\`bash
docker compose --profile gpu up -d
\`\`\`

## What the image contains

- Backend runtime
- Built frontend (\`src/web/dist\`)
- Built product docs (\`packages/docs/dist\` → served at \`/docs/\`)
- Config under \`config/\`; data volume for SQLite and vault
`,
      hu: `## Gyors start

\`\`\`bash
docker compose up -d
\`\`\`

**http://localhost:3100** — a termékdokumentáció: **/docs/**.

GPU + Ollama: \`docker compose --profile gpu up -d\`.
`,
      de: `## Quick start\n\n\`docker compose up -d\` → http://localhost:3100 , Docs unter \`/docs/\`.\n`,
      es: `## Inicio rápido\n\n\`docker compose up -d\` → http://localhost:3100 , docs en \`/docs/\`.\n`,
    }[locale]
  }

  if (slug === 'deploy/configuration') {
    return {
      en: `## Files

| File | Role |
|------|------|
| \`config/default.yaml\` | Shipped defaults (install root) |
| \`config/local.yaml\` or \`$EYAS_HOME/config/local.yaml\` | Local overrides (merged on top) |
| \`.env\` | Optional env secrets (never commit) |

## Precedence (typical)

1. CLI flags (\`--port\`, \`--host\`, \`--config\`)  
2. Environment (\`EYAS_PORT\`, \`EYAS_HOST\`, \`EYAS_HOME\`, …)  
3. Local YAML overlay  
4. Default YAML  

See also multi-instance notes under [Multiple instances](/docs/en/deploy/multi-instance/).
`,
      hu: `## Fájlok

| Fájl | Szerep |
|------|--------|
| \`config/default.yaml\` | Szállított alapértelmezések |
| \`local.yaml\` | Helyi felülírások (merge) |
| \`.env\` | Opcionális secrettek (ne commitold) |

## Precedencia

CLI → env (\`EYAS_*\`) → local YAML → default YAML.
`,
      de: `## Dateien\n\ndefault.yaml → local.yaml Overlay → EYAS_* Env → CLI Flags.\n`,
      es: `## Archivos\n\ndefault.yaml → overlay local → env EYAS_* → flags CLI.\n`,
    }[locale]
  }

  if (slug === 'reference/glossary') {
    return {
      en: `| Term | Definition |
|------|------------|
| Agent | Configured AI actor with tools, skills, memory, voice |
| Primary agent | Always-on teammate created at setup (assistant + engineer) |
| Skill | Markdown knowledge pack |
| Tool | Invokable capability with ACL |
| Board | Kanban-style work surface |
| Conversation | Chat thread |
| Memory tier | Layer in the hybrid memory system |
| Vault | Markdown files for semantic/procedural long-term knowledge |
| Provider | LLM API or local runtime |
| MCP | Model Context Protocol server |
| Channel | External messaging connector |
| Forge | Proposal UI for soul/identity evolution |
| Security gate | Pre-action policy checks |
| CASL | Permission library used for authorization |
`,
      hu: `| Fogalom | Definíció |
|---------|-----------|
| Ágens | Konfigurált AI szereplő toolokkal, skillekkel, memóriával |
| Primary ágens | Setupkor létrejövő always-on társ |
| Skill | Markdown tudáscsomag |
| Tool | Hívható képesség ACL-lel |
| Tábla | Kanban-szerű munkafelület |
| Beszélgetés | Chat szál |
| Memória szint | A hibrid memória egyik rétege |
| Vault | Markdown hosszú távú tudáshoz |
| Provider | LLM API vagy helyi runtime |
| MCP | Model Context Protocol szerver |
| Csatorna | Külső üzenetcsatlakozó |
| Forge | Soul/identity javaslat UI |
| Security gate | Művelet előtti policy |
| CASL | Jogosultsági könyvtár |
`,
      de: `Siehe englische Glossar-Tabelle (gleiche Begriffe im Produkt).`,
      es: `Véase la tabla en inglés (mismos términos del producto).`,
    }[locale]
  }

  if (slug === 'reference/faq') {
    return {
      en: `### Port already in use
Pick another port: \`EYAS_PORT=3200 ./bin/eyas start\` or free the process holding the port.

### UI missing / blank
Ensure frontend build exists: \`bun run build:web\`. Start auto-builds unless \`EYAS_SKIP_WEB_BUILD=1\`.

### /docs 404
Run \`bun run docs:build\` or restart without \`EYAS_SKIP_DOCS_BUILD\`. Package lives at \`packages/docs\`.

### Provider auth errors
Re-enter API key under Providers / Secrets; for CLIs ensure \`claude\` / \`grok\` / \`kimi\` works in the same environment as EYAS.

### Where is my data?
Under instance home (\`EYAS_HOME\` or cwd): \`data/sqlite\`, \`data/vault\`, backups, logs.
`,
      hu: `### Port foglalt
\`EYAS_PORT=3200 ./bin/eyas start\` vagy szabadítsd fel a portot.

### Nincs UI
\`bun run build:web\` — indításkor auto-build, ha nincs \`EYAS_SKIP_WEB_BUILD\`.

### /docs 404
\`bun run docs:build\` vagy indítsd újra skip nélkül. Csomag: \`packages/docs\`.

### Provider hiba
API kulcs újra Providers/Secrets alatt; CLI-knél a \`claude\`/\`grok\`/\`kimi\` ugyanabban a környezetben fusson.

### Hol az adat?
Példány home (\`EYAS_HOME\` vagy cwd): \`data/sqlite\`, \`data/vault\`, backupok, logok.
`,
      de: `Port belegt → EYAS_PORT setzen. Keine UI → build:web. /docs 404 → docs:build. Daten unter data/.`,
      es: `Puerto ocupado → EYAS_PORT. Sin UI → build:web. /docs 404 → docs:build. Datos en data/.`,
    }[locale]
  }

  if (slug === 'reference/architecture') {
    return {
      en: `Product user docs stop here. For implementers:

| Path | Content |
|------|---------|
| \`CHANGELOG.md\` | Full modular architecture (56 sections) |
| \`the source tree specs/\` | Design specs |
| \`the source tree plans/\` | Implementation plans |
| \`CHANGELOG.md\` | Release history |

Do not treat architecture files as end-user manuals.
`,
      hu: `A felhasználói dokumentáció itt véget ér. Fejlesztőknek:

| Útvonal | Tartalom |
|---------|----------|
| \`CHANGELOG.md\` | Moduláris architektúra |
| \`the source tree specs/\` | Design specek |
| \`the source tree plans/\` | Implementációs tervek |
| \`CHANGELOG.md\` | Release előzmények |
`,
      de: `User-Docs enden hier. Technik: \`CHANGELOG.md\`, \`the source tree \`.`,
      es: `La docs de usuario termina aquí. Técnica: \`CHANGELOG.md\`, \`the source tree \`.`,
    }[locale]
  }

  if (slug === 'deploy/native') {
    return {
      en: `## One-line installer

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
\`\`\`

Pinned version: \`bash -s -- --version 0.8.3-beta --yes\`

Windows: \`scripts/install.ps1\`.

After install, \`eyas start\` and open the UI. Product docs: \`/docs/\`.
`,
      hu: `## Egy-soros installer

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
\`\`\`

Verzió pin: \`--version 0.8.3-beta\`. Utána \`eyas start\`, UI + \`/docs/\`.
`,
      de: `Installer-Skript unter scripts/install.sh — danach eyas start.`,
      es: `Script en scripts/install.sh — luego eyas start.`,
    }[locale]
  }

  if (slug === 'deploy/kubernetes') {
    return {
      en: `Manifests and Helm chart: \`deploy/k8s/\` and \`deploy/k8s/helm/eyas/\`.

Typical concerns: image, \`EYAS_PORT\`, persistent volume for \`data/\`, secrets for provider keys, ingress to the Service.

See \`deploy/k8s/README.md\` in the repo for current chart values.
`,
      hu: `Manifestek és Helm: \`deploy/k8s/\`. Image, port, PVC a \`data/\`-hoz, secrettek, ingress — lásd a chart README-t.`,
      de: `Siehe deploy/k8s/ im Repo.`,
      es: `Ver deploy/k8s/ en el repo.`,
    }[locale]
  }

  if (slug === 'deploy/multi-instance') {
    return {
      en: `## Isolation

| Lever | Purpose |
|-------|---------|
| \`EYAS_HOME\` | Separate data, pid, local config |
| \`EYAS_PORT\` | Non-colliding listen port |
| Compose project name | Multiple stacks on one Docker host |

Never point two live instances at the same SQLite file.
`,
      hu: `## Izoláció

\`EYAS_HOME\` + \`EYAS_PORT\` (és compose project név). Két élő példány ne ugyanazt az SQLite fájlt használja.
`,
      de: `EYAS_HOME + EYAS_PORT. Nie dieselbe SQLite-Datei teilen.`,
      es: `EYAS_HOME + EYAS_PORT. Nunca la misma SQLite en dos instancias vivas.`,
    }[locale]
  }

  // agents/voice rich content
  if (slug === 'agents/voice') {
    return {
      en: `## Internal vs external

| Profile | Used when |
|---------|-----------|
| **Internal** | Talking to you and teammates |
| **External** | Clients, strangers, public channels |

## Dimensions

| Dimension | Controls |
|-----------|----------|
| Address | Informal / formal / honorific / context-sensitive |
| Tone | Serious → playful |
| Detail | Brief → thorough |
| Directness | Blunt → roundabout |
| Humor | None → sharp |
| Emoji | Never → often |

<h2 id="presets">Presets</h2>

Built-ins include \`jarvis\`, \`best-buddy\`, \`senior-ceo\`, \`pajtas-dev\`, \`standup\`, \`diplomata\`, \`coach\`, \`tutor\`. You can set different presets for internal and external voice.

<h2 id="dimensions">Dimensions</h2>

See the Voice tab on the agent detail page for live controls corresponding to the table above.
`,
      hu: `## Belső vs külső

| Profil | Mikor |
|--------|-------|
| **Belső** | Veled és a csapattal |
| **Külső** | Ügyfelek, idegenek, nyilvános csatornák |

<h2 id="dimensions">Dimenziók</h2>

Megszólítás, hang, részletesség, direktség, humor, emoji — lásd az ágens **Voice** tabját.

<h2 id="presets">Presetek</h2>

Többek között: \`jarvis\`, \`best-buddy\`, \`senior-ceo\`, \`pajtas-dev\`, \`standup\`, \`diplomata\`, \`coach\`, \`tutor\`.
`,
      de: `Interne vs externe Stimme; sechs Dimensionen; Presets auf dem Voice-Tab des Agenten.`,
      es: `Voz interna vs externa; seis dimensiones; presets en la pestaña Voice del agente.`,
    }[locale]
  }

  return ''
}

function relatedLinks(slug, locale) {
  // simple static related map
  const base = `/docs/${locale}/`
  const rel = {
    'setup-wizard': ['getting-started', 'ai/providers', 'agents/overview'],
    'daily/conversations': ['agents/overview', 'daily/board', 'knowledge/memory'],
    'agents/configure': ['agents/overview', 'agents/voice', 'agents/identity-workspace', 'ai/providers'],
    'ai/providers': ['ai/routing-budget', 'admin/secrets', 'setup-wizard'],
    'admin/settings': ['admin/users', 'ai/providers', 'admin/backup'],
  }
  const list = rel[slug]
  if (!list) return ''
  const title = sectionHeading(locale, 'related')
  return `\n## ${title}\n\n` + list.map((s) => `- [${s}](${base}${s}/)`).join('\n') + '\n'
}

function writeDoc(slug, locale) {
  const meta = META[slug]
  if (!meta) return false
  const title = meta.titles[locale] || meta.titles.en
  const intro = meta.intros[locale] || meta.intros.en
  const fields = fieldsForSlug(slug)
  const table = fieldTable(fields, locale)
  const extra = extraBlocks(slug, locale) || ''
  const fieldsTitle = sectionHeading(locale, 'fields')
  const overviewTitle = sectionHeading(locale, 'overview')

  let body = `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(intro.slice(0, 160))}
---

## ${overviewTitle}

${intro}

${extra}
`

  if (table) {
    body += `\n## ${fieldsTitle}\n\n`
    body += locale === 'en'
      ? `Every user-visible string/control from the related UI modules is listed below (generated from product locales). Use the **Key** column when wiring in-app help.\n\n`
      : locale === 'hu'
        ? `Az alábbi táblázat a kapcsolódó UI modulok összes felhasználói feliratát/vezérlőjét tartalmazza (a termék locale fájljaiból generálva). A **Kulcs** oszlop az in-app súgó bekötéséhez stabil.\n\n`
        : `\n`
    body += table + '\n'
  } else if (!extra) {
    body += `\n:::note\nNo dedicated UI locale catalog is mapped to this page yet; see related screens in the product sidebar.\n:::\n`
  }

  body += relatedLinks(slug, locale)

  const relPath = slug === 'index' ? 'index.md' : `${slug}.md`
  const path = join(contentRoot, locale, relPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  return true
}

// Preserve hand-crafted welcome pages if present — only rewrite mapped META slugs
let n = 0
for (const slug of Object.keys(META)) {
  for (const locale of LOCALES) {
    if (writeDoc(slug, locale)) n++
  }
}
console.log(`Wrote ${n} locale pages covering ${Object.keys(META).length} docs slugs`)
console.log(`Field catalog pages used: ${Object.keys(PAGE_MAP).length}, total catalog fields: ${Object.values(catalog).reduce((a, b) => a + b.length, 0)}`)
