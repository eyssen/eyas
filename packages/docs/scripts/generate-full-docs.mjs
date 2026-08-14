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
const LOCALES = ['en', 'hu', 'de', 'es', 'fr', 'tlh']

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
  ingress: ['admin/ingress'],
  nodes: ['admin/observability'],
  notifications: ['admin/settings'],
}

/** Docs page metadata */
const META = {
  'setup-wizard': {
    titles: { en: 'Setup wizard', hu: 'Setup varázsló', de: 'Setup-Assistent', es: 'Asistente de configuración', fr: 'Assistant de configuration', tlh: 'tagh SeHwI\'' },
    intros: {
      en: 'First-boot wizard that runs once before the main UI. It creates encryption, the owner account, primary agents, optional specialists, and at least one AI provider.',
      hu: 'Egyszer futó varázsló az első indításkor, a fő UI előtt. Titkosítást, owner fiókot, elsődleges ágenseket, opcionális specialistákat és legalább egy AI providert állít be.',
      de: 'Einmaliger Assistent vor der Haupt-UI: Verschlüsselung, Owner-Konto, Primäragenten, optionale Spezialisten und mindestens einen KI-Provider.',
      es: 'Asistente de un solo uso antes de la UI principal: cifrado, cuenta owner, agentes primarios, especialistas opcionales y al menos un proveedor de IA.',
      fr: 'Assistant unique avant l’interface principale : chiffrement, compte propriétaire, agents principaux, spécialistes facultatifs et au moins un fournisseur d’IA.',
      tlh: 'UI potlh tlhoS wa\'logh tagh SeHwI\': ngaQghach, joH lo\'wI\', potlh ghoqwI\'pu\', poQbe\' tejwI\'pu\', \'ej wa\' AI nobwI\' loQ.',
    },
  },
  'daily/dashboard': {
    titles: { en: 'Dashboard', hu: 'Irányítópult', de: 'Dashboard', es: 'Panel', fr: 'Tableau de bord', tlh: 'jIH Daq' },
    intros: {
      en: 'Home screen after login: system health, setup recommendations, autonomy nudges, and shortcuts into ongoing work.',
      hu: 'Bejelentkezés utáni kezdőképernyő: rendszerállapot, setup ajánlások, autonómia nudge-ok és gyors belépés a folyamatban lévő munkába.',
      de: 'Startbildschirm nach dem Login: Systemstatus, Setup-Empfehlungen, Autonomie-Hinweise und Shortcuts.',
      es: 'Pantalla de inicio tras el login: estado del sistema, recomendaciones de setup, avisos de autonomía y accesos directos.',
      fr: 'Écran d’accueil après connexion : état du système, recommandations de configuration, suggestions d’autonomie et raccourcis vers le travail en cours.',
      tlh: 'yI\'el \'etlh: pat Dotlh, lIng chupmey, SeH\'egh ghuHmey, \'ej vumtaHbogh HeHom.',
    },
  },
  'daily/conversations': {
    titles: { en: 'Conversations', hu: 'Beszélgetések', de: 'Gespräche', es: 'Conversaciones', fr: 'Conversations', tlh: 'ja\'chuqmey' },
    intros: {
      en: 'Primary workspace for chatting with agents. Messages stream in real time; agents may call tools, open team sessions, and use the context rail (chatter, fields, attachments).',
      hu: 'Az ágensekkel való chat fő munkahelye. Az üzenetek valós időben streamelnek; az ágens toolokat hívhat, team sessiont indíthat, és a context rail-t (chatter, mezők, csatolmányok) használja.',
      de: 'Hauptarbeitsplatz für Agenten-Chat. Nachrichten streamen live; Agenten rufen Tools auf, starten Team-Sessions und nutzen die Context-Leiste.',
      es: 'Espacio principal de chat con agentes. Los mensajes llegan en streaming; los agentes llaman tools, abren sesiones de equipo y usan el riel de contexto.',
      fr: 'Espace principal de conversation avec les agents. Les messages arrivent en flux ; les agents peuvent appeler des outils, ouvrir des sessions d’équipe et utiliser le rail de contexte (chatter, champs, pièces jointes).',
      tlh: 'ghoqwI\'pu\' ja\'chuq potlh Daq. QInmey taH stream; janmey tlhoblaH ghoqwI\'pu\', ghom poHmey poSmoH, \'ej De\' He (chatter, De\', cheltaHghachmey) lo\'.',
    },
  },
  'daily/board': {
    titles: { en: 'Board', hu: 'Tábla', de: 'Board', es: 'Tablero', fr: 'Tableau', tlh: 'Qu\' nav' },
    intros: {
      en: 'Work tracking surface: kanban, list, timeline, and graph views over cards linked to conversations and projects.',
      hu: 'Munkakövető felület: kanban, lista, idővonal és graph nézet kártyákkal, amik beszélgetésekhez és projektekhez kapcsolódnak.',
      de: 'Arbeits-Tracking: Kanban-, Listen-, Timeline- und Graph-Ansichten über Karten mit Gesprächen und Projekten.',
      es: 'Seguimiento del trabajo: vistas kanban, lista, línea de tiempo y grafo sobre tarjetas ligadas a conversaciones y proyectos.',
      fr: 'Suivi du travail : vues kanban, liste, chronologie et graphe sur des cartes liées aux conversations et aux projets.',
      tlh: 'Qu\' tlha\': kanban, tetlh, poH tlhegh, graph jIH — ja\'chuqmey Qu\'mey je rarlu\'bogh chaw\'mey.',
    },
  },
  'daily/projects': {
    titles: { en: 'Projects', hu: 'Projektek', de: 'Projekte', es: 'Proyectos', fr: 'Projets', tlh: 'Qu\'mey' },
    intros: {
      en: 'Organise work with project types, stages, and project instances. Conversations can be tracked against stages.',
      hu: 'Munka szervezése projekt típusokkal, stage-ekkel és projekt példányokkal. A beszélgetések stage-ekhez köthetők.',
      de: 'Arbeit mit Projekttypen, Stages und Projektinstanzen organisieren. Gespräche können Stages zugeordnet werden.',
      es: 'Organiza el trabajo con tipos de proyecto, etapas e instancias. Las conversaciones se pueden asociar a etapas.',
      fr: 'Organisez le travail avec des types de projet, des étapes et des instances. Les conversations peuvent être suivies par étape.',
      tlh: 'Qu\' Seghmey, mIwmey, Qu\' patmey je lo\'taHvIS Qu\' yISeH. mIwmeyvaD ja\'chuqmey rarlaH.',
    },
  },
  'daily/search': {
    titles: { en: 'Search', hu: 'Keresés', de: 'Suche', es: 'Búsqueda', fr: 'Recherche', tlh: 'nej' },
    intros: {
      en: 'Unified full-text (and vector where available) search across board, memory, documents, knowledge, and configured external sources.',
      hu: 'Egyesített full-text (és ahol van, vektor) keresés a táblán, memóriában, dokumentumokban, tudásbázisban és a beállított külső forrásokon.',
      de: 'Einheitliche Volltext- (und ggf. Vektor-)Suche über Board, Speicher, Dokumente, Wissen und externe Quellen.',
      es: 'Búsqueda unificada de texto completo (y vectorial si aplica) en tablero, memoria, documentos, conocimiento y fuentes externas.',
      fr: 'Recherche unifiée en texte intégral (et vectorielle le cas échéant) dans le tableau, la mémoire, les documents, les connaissances et les sources externes configurées.',
      tlh: 'wa\' mu\' nej (vector nej je, tu\'lu\'chugh) Qu\' nav, qawHaq, ghItlhmey, Sov, \'ej SeHlu\'bogh Hur HalmeyDaq.',
    },
  },
  'agents/overview': {
    titles: { en: 'Agents overview', hu: 'Ágensek áttekintés', de: 'Agenten-Übersicht', es: 'Resumen de agentes', fr: 'Vue d’ensemble des agents', tlh: 'ghoqwI\'pu\' jIH' },
    intros: {
      en: 'List and lifecycle of AI agents. Primary teammates stay always-on; team and specialist agents extend capacity.',
      hu: 'AI ágensek listája és életciklusa. Az elsődleges társak mindig aktívak; a team és specialist ágensek bővítik a kapacitást.',
      de: 'Liste und Lebenszyklus der KI-Agenten. Primäre Teamkollegen sind dauerhaft aktiv; Team- und Spezialagenten erweitern die Kapazität.',
      es: 'Lista y ciclo de vida de agentes de IA. Los compañeros primarios están siempre activos; los de equipo y especialistas amplían la capacidad.',
      fr: 'Liste et cycle de vie des agents d’IA. Les collègues principaux restent toujours actifs ; les agents d’équipe et spécialistes étendent la capacité.',
      tlh: 'AI ghoqwI\'pu\' tetlh yIn He je. potlh juppu\' reH Qap; ghom tejwI\' ghoqwI\'pu\' je laH chel.',
    },
  },
  'agents/configure': {
    titles: { en: 'Create & configure', hu: 'Létrehozás és beállítás', de: 'Erstellen & konfigurieren', es: 'Crear y configurar', fr: 'Créer et configurer', tlh: 'chu\' \'ej choH' },
    intros: {
      en: 'All configuration fields on an agent detail page: identity, model, effort, tools, budgets, and classification.',
      hu: 'Az ágens részletező oldal összes beállító mezője: identitás, modell, effort, toolok, budgetek és besorolás.',
      de: 'Alle Konfigurationsfelder der Agentendetailseite: Identität, Modell, Effort, Tools, Budgets und Klassifikation.',
      es: 'Todos los campos de configuración de la ficha del agente: identidad, modelo, effort, tools, presupuestos y clasificación.',
      fr: 'Tous les champs de configuration de la fiche d’un agent : identité, modèle, effort, outils, budgets et classification.',
      tlh: 'ghoqwI\' De\' ghItlh Hoch SeH De\': pong, pat, effort, janmey, Huch mebmey, \'ej Segh.',
    },
  },
  'agents/identity-workspace': {
    titles: { en: 'Identity & workspace', hu: 'Identitás és workspace', de: 'Identidad & Workspace', es: 'Identidad y workspace', fr: 'Identité et espace de travail', tlh: 'pong workspace je' },
    intros: {
      en: 'File-based workspace (IDENTITY, SOUL, rules) that shapes long-lived agent behaviour beyond the simple form fields.',
      hu: 'Fájl-alapú workspace (IDENTITY, SOUL, szabályok), ami a hosszú távú ágens-viselkedést formálja a sima űrlapmezőkön túl.',
      de: 'Dateibasierter Workspace (IDENTITY, SOUL, Regeln) für langfristiges Verhalten jenseits einfacher Formularfelder.',
      es: 'Workspace basado en archivos (IDENTITY, SOUL, reglas) que define el comportamiento a largo plazo más allá del formulario.',
      fr: 'Espace de travail basé sur des fichiers (IDENTITY, SOUL, règles) qui façonne le comportement durable de l’agent au-delà des simples champs de formulaire.',
      tlh: 'ghItlh workspace (IDENTITY, SOUL, chutmey) — nI\' ghoqwI\' tIgh choH, De\' fo\'mey tlhoS.',
    },
  },
  'agents/voice': {
    titles: { en: 'Voice profiles', hu: 'Hangprofilok', de: 'Stimmprofile', es: 'Perfiles de voz', fr: 'Profils de voix', tlh: 'wab patmey' },
    intros: {
      en: 'Internal and external speaking style: six dimensions and built-in presets. Separate profiles for how the agent talks to you vs. outsiders.',
      hu: 'Belső és külső beszédstílus: hat dimenzió és beépített presetek. Külön profil arra, ahogy veled, illetve idegenekkel beszél.',
      de: 'Interner und externer Sprechstil: sechs Dimensionen und Presets. Getrennte Profile für dich vs. Außenstehende.',
      es: 'Estilo de habla interno y externo: seis dimensiones y presets. Perfiles separados para ti frente a terceros.',
      fr: 'Style de parole interne et externe : six dimensions et préréglages intégrés. Profils distincts pour vous et pour les interlocuteurs externes.',
      tlh: 'qoD Hur ja\' tIgh: jav patmey \'ej motlh wIv. SoHvaD Hur nuvpu\'vaD je wab pat pIm.',
    },
  },
  'agents/teams': {
    titles: { en: 'Teams & delegation', hu: 'Csapatok és delegálás', de: 'Teams & Delegation', es: 'Equipos y delegación', fr: 'Équipes et délégation', tlh: 'ghommey nobHa\'ghach je' },
    intros: {
      en: 'How agents collaborate: team configuration, handoffs, and multi-agent sessions in conversations.',
      hu: 'Hogyan működnek együtt az ágensek: team konfiguráció, handoffok és többágenses sessionök a beszélgetésekben.',
      de: 'Zusammenarbeit von Agenten: Team-Konfiguration, Handoffs und Multi-Agent-Sessions in Gesprächen.',
      es: 'Cómo colaboran los agentes: configuración de equipo, handoffs y sesiones multiagente en conversaciones.',
      fr: 'Comment les agents collaborent : configuration d’équipe, passations et sessions multi-agents dans les conversations.',
      tlh: 'ghoqwI\'pu\' Qapchuq: ghom SeH, nobHa\'ghachmey, \'ej ja\'chuqDaq ghoqwI\' law\' poHmey.',
    },
  },
  'agents/runs': {
    titles: { en: 'Runs & Mission Control', hu: 'Futtatások és Mission Control', de: 'Läufe & Mission Control', es: 'Ejecuciones y Mission Control', fr: 'Exécutions et Mission Control', tlh: 'QapmeH Qu\'mey Mission Control je' },
    intros: {
      en: 'Observe live and historical agent runs, progress trees, and Mission Control cards for stop/resume style control.',
      hu: 'Élő és múltbeli ágens futtatások, progress fák és Mission Control kártyák a stop/resume jellegű vezérléshez.',
      de: 'Live- und historische Agentenläufe, Fortschrittsbäume und Mission-Control-Karten für Stop/Resume.',
      es: 'Ejecuciones en vivo e históricas, árboles de progreso y tarjetas de Mission Control para stop/resume.',
      fr: 'Observez les exécutions d’agents en direct et passées, les arbres de progression et les cartes Mission Control pour arrêter ou reprendre.',
      tlh: 'DaH qen ghoqwI\' QapmeH Qu\'mey bej, veb Sor, \'ej Mission Control chaw\'mey mev/taghqa\'vaD.',
    },
  },
  'agents/forge': {
    titles: { en: 'Forge', hu: 'Forge', de: 'Forge', es: 'Forge', fr: 'Forge', tlh: 'Forge' },
    intros: {
      en: 'Evolve agent soul/identity via proposals you review and apply — not silent self-rewrite.',
      hu: 'Ágens soul/identity fejlesztése javaslatokkal, amiket te reviewzol és alkalmazol — nem csendes önátírás.',
      de: 'Soul/Identity per Vorschläge weiterentwickeln, die du prüfst und anwendest — kein stilles Umschreiben.',
      es: 'Evolucionar soul/identidad con propuestas que revisas y aplicas — no reescritura silenciosa.',
      fr: 'Faites évoluer l’âme et l’identité de l’agent via des propositions que vous examinez et appliquez — pas de réécriture silencieuse.',
      tlh: 'ghoqwI\' SOUL/IDENTITY choH chupmey lo\'taHvIS — SoH chov \'ej lIng; tamchoHbe\'.',
    },
  },
  'agents/autonomy': {
    titles: { en: 'Autonomy', hu: 'Autonómia', de: 'Autonomie', es: 'Autonomía', fr: 'Autonomie', tlh: 'SeH\'egh' },
    intros: {
      en: 'How much agents may do without asking: feature flags, approval tiers, and dashboards.',
      hu: 'Mennyit tehetnek az ágensek megkérdezés nélkül: feature flagek, approval tier-ek és dashboardok.',
      de: 'Wie viel Agenten ohne Rückfrage tun dürfen: Feature-Flags, Approval-Tiers und Dashboards.',
      es: 'Cuánto pueden hacer los agentes sin preguntar: feature flags, tiers de aprobación y paneles.',
      fr: 'Jusqu’où les agents peuvent agir sans demander : indicateurs de fonctionnalité, niveaux d’approbation et tableaux de bord.',
      tlh: 'tlhobbe\' ghoqwI\'pu\' ta\'laHchugh \'ar: laH per, chaw\' patmey, \'ej jIH Daqmey.',
    },
  },
  'automation/skills': {
    titles: { en: 'Skills', hu: 'Skillek', de: 'Skills', es: 'Skills', fr: 'Compétences', tlh: 'laHmey' },
    intros: {
      en: 'Reusable markdown skill packs agents can load. Categories: builtin, user, evolved, and imported (own).',
      hu: 'Újrahasználható markdown skill csomagok. Kategóriák: builtin, user, evolved és importált (own).',
      de: 'Wiederverwendbare Markdown-Skill-Pakete. Kategorien: builtin, user, evolved und importiert (own).',
      es: 'Paquetes de skills en markdown reutilizables. Categorías: builtin, user, evolved e importados (own).',
      fr: 'Paquets de compétences markdown réutilisables que les agents peuvent charger. Catégories : builtin, user, evolved et importés (own).',
      tlh: 'qa\'laH markdown laH pa\'mey ghoqwI\'pu\' qenglaH. Seghmey: builtin, user, evolved, \'ej chellu\'bogh (own).',
    },
  },
  'automation/tools': {
    titles: { en: 'Tools', hu: 'Toolok', de: 'Tools', es: 'Tools', fr: 'Outils', tlh: 'janmey' },
    intros: {
      en: 'Callable capabilities (shell, browser, APIs, MCP-backed tools). Assignment and permissions are per agent.',
      hu: 'Hívható képességek (shell, böngésző, API-k, MCP toolok). Hozzárendelés és jogosultság ágensenként.',
      de: 'Aufrufbare Fähigkeiten (Shell, Browser, APIs, MCP-Tools). Zuweisung und Rechte pro Agent.',
      es: 'Capacidades invocables (shell, navegador, APIs, tools MCP). Asignación y permisos por agente.',
      fr: 'Capacités invocables (shell, navigateur, API, outils MCP). L’affectation et les permissions sont par agent.',
      tlh: 'tlhoblaH laHmey (shell, Internet nejwI\', APIs, MCP janmey). ghoqwI\' HochvaD lIng chaw\'mey je.',
    },
  },
  'automation/scheduler': {
    titles: { en: 'Scheduler', hu: 'Ütemező', de: 'Scheduler', es: 'Programador', fr: 'Planificateur', tlh: 'poH SeHwI\'' },
    intros: {
      en: 'Cron-style and calendar jobs that can trigger agents or system maintenance tasks.',
      hu: 'Cron-szerű és naptár jobok, amik ágenst vagy rendszer-karbantartást indíthatnak.',
      de: 'Cron- und Kalender-Jobs, die Agenten oder Systemwartung auslösen können.',
      es: 'Jobs tipo cron y de calendario que pueden disparar agentes o mantenimiento del sistema.',
      fr: 'Tâches de type cron et calendrier qui peuvent déclencher des agents ou des opérations de maintenance système.',
      tlh: 'cron rur \'ej HovpoH Qu\'mey — ghoqwI\'pu\' pagh pat tI\' Qu\'mey taghlaH.',
    },
  },
  'automation/pipelines': {
    titles: { en: 'Pipelines', hu: 'Pipeline-ok', de: 'Pipelines', es: 'Pipelines', fr: 'Pipelines', tlh: 'Pipelines' },
    intros: {
      en: 'Multi-step orchestrated flows (e.g. ticket-to-code) with inputs, gates, and run history.',
      hu: 'Többlépéses orkesztrált folyamatok (pl. ticket-to-code) inputokkal, gate-ekkel és futtatás-előzményekkel.',
      de: 'Mehrstufige orchestrierte Flows (z. B. Ticket-to-Code) mit Inputs, Gates und Laufhistorie.',
      es: 'Flujos orquestados de varios pasos (p. ej. ticket-to-code) con entradas, gates e historial.',
      fr: 'Flux orchestrés en plusieurs étapes (p. ex. ticket-to-code) avec entrées, portes et historique d’exécution.',
      tlh: 'mIw law\' He (ticket-to-code rur) — yI\'el, lojmItmey, \'ej QapmeH qun.',
    },
  },
  'automation/research': {
    titles: { en: 'Research', hu: 'Kutatás', de: 'Research', es: 'Investigación', fr: 'Recherche', tlh: 'tej' },
    intros: {
      en: 'Deep research jobs that gather sources and produce reports agents can reuse.',
      hu: 'Mély kutatási jobok forrásokkal és jelentésekkel, amiket az ágensek újrahasználhatnak.',
      de: 'Tiefen-Research-Jobs mit Quellen und Berichten zur Wiederverwendung durch Agenten.',
      es: 'Trabajos de investigación profunda con fuentes e informes reutilizables por agentes.',
      fr: 'Travaux de recherche approfondie qui rassemblent des sources et produisent des rapports réutilisables par les agents.',
      tlh: 'tej Qu\'mey — Halmey boS \'ej De\' ghItlhmey chenmoH ghoqwI\'pu\' qa\'laH.',
    },
  },
  'automation/proactive': {
    titles: { en: 'Proactive assistant', hu: 'Proaktív asszisztens', de: 'Proaktiver Assistent', es: 'Asistente proactivo', fr: 'Assistant proactif', tlh: 'tlha\'bogh QaHwI\'' },
    intros: {
      en: 'Heartbeat-driven suggestions and actions when the system notices something worth acting on.',
      hu: 'Heartbeat-alapú javaslatok és akciók, ha a rendszer cselekvésre érdemeset észlel.',
      de: 'Heartbeat-gesteuerte Vorschläge und Aktionen, wenn das System Handlungsbedarf erkennt.',
      es: 'Sugerencias y acciones impulsadas por heartbeat cuando el sistema detecta algo accionable.',
      fr: 'Suggestions et actions déclenchées par le rythme cardiaque lorsque le système détecte quelque chose qui mérite d’agir.',
      tlh: 'tIq mIw chupmey ta\'mey je — pat vumlaHghach tu\'DI\'.',
    },
  },
  'automation/self-learning': {
    titles: { en: 'Self-learning & skill evolution', hu: 'Öntanulás és skill evolution', de: 'Selbstlernen & Skill-Evolution', es: 'Autoaprendizaje y evolución de skills', fr: 'Auto-apprentissage et évolution des compétences', tlh: 'ghoj\'egh laH choH je' },
    intros: {
      en: 'Insights from usage and evolving skills — always reviewable before they change agent behaviour.',
      hu: 'Használatból származó insights és fejlődő skillek — mindig reviewolható, mielőtt az ágens viselkedése változna.',
      de: 'Insights aus Nutzung und evolvierende Skills — immer prüfbar, bevor sich Verhalten ändert.',
      es: 'Insights del uso y skills que evolucionan — siempre revisables antes de cambiar el comportamiento.',
      fr: 'Enseignements tirés de l’usage et compétences qui évoluent — toujours examinables avant de modifier le comportement de l’agent.',
      tlh: 'lo\'vo\' Sov \'ej choHtaHbogh laHmey — ghoqwI\' tIgh choHpa\' reH chovlaH.',
    },
  },
  'knowledge/memory': {
    titles: { en: 'Memory', hu: 'Memória', de: 'Speicher', es: 'Memoria', fr: 'Mémoire', tlh: 'qawHaq' },
    intros: {
      en: 'Five-tier memory model: working, episodic, semantic, procedural, archive — plus vault markdown for long-lived knowledge.',
      hu: 'Öt szintű memória: working, episodic, semantic, procedural, archive — plus vault markdown a hosszú távú tudáshoz.',
      de: 'Fünf-Ebenen-Speicher: working, episodic, semantic, procedural, archive — plus Vault-Markdown für langlebiges Wissen.',
      es: 'Memoria de cinco niveles: working, episodic, semantic, procedural, archive — más vault markdown para conocimiento duradero.',
      fr: 'Modèle de mémoire à cinq niveaux : working, episodic, semantic, procedural, archive — plus le markdown du coffre pour le savoir durable.',
      tlh: 'vagh pat qawHaq: working, episodic, semantic, procedural, archive — \'ej vault markdown nI\' SovvaD.',
    },
  },
  'knowledge/knowledge-base': {
    titles: { en: 'Knowledge base', hu: 'Tudásbázis', de: 'Wissensbasis', es: 'Base de conocimiento', fr: 'Base de connaissances', tlh: 'Sov pa\'' },
    intros: {
      en: 'Editable wiki-style pages for structured knowledge you maintain explicitly (vs automatic memory tiers).',
      hu: 'Szerkeszthető wiki-szerű oldalak a te általad karbantartott tudáshoz (szemben az automatikus memória szintekkel).',
      de: 'Editierbare Wiki-Seiten für explizit gepflegtes Wissen (vs. automatische Speicherebenen).',
      es: 'Páginas tipo wiki editables para conocimiento que mantienes explícitamente (frente a niveles de memoria automáticos).',
      fr: 'Pages de type wiki éditables pour le savoir que vous maintenez explicitement (par opposition aux niveaux de mémoire automatiques).',
      tlh: 'choHlaH wiki rur ghItlhmey — SoH tI\'bogh Sov (QapchoH\'egh qawHaq patmey tlhoS).',
    },
  },
  'knowledge/documents': {
    titles: { en: 'Documents', hu: 'Dokumentumok', de: 'Dokumente', es: 'Documentos', fr: 'Documents', tlh: 'ghItlhmey' },
    intros: {
      en: 'Upload and index files so agents can retrieve content in conversation.',
      hu: 'Fájlok feltöltése és indexelése, hogy az ágensek a beszélgetésben visszakereshessék a tartalmat.',
      de: 'Dateien hochladen und indexieren, damit Agenten Inhalte im Gespräch abrufen können.',
      es: 'Sube e indexa archivos para que los agentes recuperen contenido en la conversación.',
      fr: 'Téléversez et indexez des fichiers afin que les agents puissent en retrouver le contenu en conversation.',
      tlh: 'ghItlhmey yIchel \'ej yIper — ja\'chuqDaq De\' SamlaH ghoqwI\'pu\'.',
    },
  },
  'knowledge/client-wiki': {
    titles: { en: 'Client wiki', hu: 'Ügyfél wiki', de: 'Kunden-Wiki', es: 'Wiki de cliente', fr: 'Wiki client', tlh: 'jeSwI\' wiki' },
    intros: {
      en: 'Per-client collaborative documentation for client-delivery work.',
      hu: 'Ügyfél-specifikus közös dokumentáció ügyfél-projektekhez.',
      de: 'Kundenbezogene gemeinsame Dokumentation für Delivery-Arbeit.',
      es: 'Documentación colaborativa por cliente para trabajo de entrega.',
      fr: 'Documentation collaborative par client pour le travail de livraison.',
      tlh: 'jeSwI\' HochvaD Qapchuq ghItlh — nob Qu\'vaD.',
    },
  },
  'knowledge/meetings': {
    titles: { en: 'Meetings', hu: 'Meetingek', de: 'Meetings', es: 'Reuniones', fr: 'Réunions', tlh: 'ghommey' },
    intros: {
      en: 'Capture and process meetings into notes, summaries, and follow-up actions.',
      hu: 'Meetingek rögzítése és feldolgozása jegyzetekké, összefoglalókká és follow-up akciókká.',
      de: 'Meetings erfassen und in Notizen, Zusammenfassungen und Follow-ups überführen.',
      es: 'Capturar y procesar reuniones en notas, resúmenes y acciones de seguimiento.',
      fr: 'Capturer et traiter les réunions en notes, synthèses et actions de suivi.',
      tlh: 'ghommey qon \'ej choH — qawHaq, Del, \'ej tlha\' ta\'mey.',
    },
  },
  'communication/channels': {
    titles: { en: 'Channels overview', hu: 'Csatornák áttekintés', de: 'Kanäle-Übersicht', es: 'Resumen de canales', fr: 'Vue d’ensemble des canaux', tlh: 'Hemey jIH' },
    intros: {
      en: 'Communication module: channel instances, pairing, inbound queue, and binding channels to agents.',
      hu: 'Kommunikációs modul: csatorna példányok, pairing, inbound queue, és csatornák kötése ágensekhez.',
      de: 'Kommunikationsmodul: Kanalinstanzen, Pairing, Inbound-Queue und Bindung an Agenten.',
      es: 'Módulo de comunicación: instancias de canal, pairing, cola entrante y enlace a agentes.',
      fr: 'Module de communication : instances de canal, appariement, file d’entrée et liaison des canaux aux agents.',
      tlh: 'Qum pat: He patmey, rar, \'el tetlh, \'ej ghoqwI\'pu\'vaD Hemey rar.',
    },
  },
  'communication/telegram': {
    titles: { en: 'Telegram', hu: 'Telegram', de: 'Telegram', es: 'Telegram', fr: 'Telegram', tlh: 'Telegram' },
    intros: {
      en: 'Connect Telegram bot instances, pair users, and route inbound messages to agents.',
      hu: 'Telegram bot példányok, pairing, bejövő üzenetek routingja ágensekhez.',
      de: 'Telegram-Bot-Instanzen verbinden, Nutzer pairen und Nachrichten an Agenten routen.',
      es: 'Conectar bots de Telegram, emparejar usuarios y enrutar mensajes entrantes a agentes.',
      fr: 'Connectez des instances de bot Telegram, appariez les utilisateurs et routez les messages entrants vers les agents.',
      tlh: 'Telegram bot patmey rar, lo\'wI\'pu\' rar, \'ej \'el QInmey ghoqwI\'pu\'vaD He.',
    },
  },
  'communication/a2a': {
    titles: { en: 'A2A & external agents', hu: 'A2A és külső ágensek', de: 'A2A & externe Agenten', es: 'A2A y agentes externos', fr: 'A2A et agents externes', tlh: 'A2A Hur ghoqwI\'pu\' je' },
    intros: {
      en: 'Agent-to-agent protocol and well-known agent card for interoperable agent ecosystems.',
      hu: 'Ágens–ágens protokoll és well-known agent card az interoperábilis ökoszisztémákhoz.',
      de: 'Agent-zu-Agent-Protokoll und well-known Agent Card für interoperable Ökosysteme.',
      es: 'Protocolo agente–agente y agent card well-known para ecosistemas interoperables.',
      fr: 'Protocole agent-à-agent et carte d’agent well-known pour les écosystèmes interopérables.',
      tlh: 'ghoqwI\'-ghoqwI\' chut \'ej well-known ghoqwI\' chaw\' — QapchuqlaH ghommeyvaD.',
    },
  },
  'ai/providers': {
    titles: { en: 'Providers', hu: 'Providerek', de: 'Provider', es: 'Proveedores', fr: 'Fournisseurs', tlh: 'nobwI\'pu\'' },
    intros: {
      en: 'AI backends: cloud APIs (Anthropic, OpenAI, Gemini, xAI, …), host CLIs (Claude Code, Grok, Kimi), and local runtimes (Ollama, LM Studio, vLLM).',
      hu: 'AI backendek: felhő API-k (Anthropic, OpenAI, Gemini, xAI, …), host CLI-k (Claude Code, Grok, Kimi) és helyi runtime-ok (Ollama, LM Studio, vLLM).',
      de: 'KI-Backends: Cloud-APIs, Host-CLIs und lokale Runtimes (Ollama, LM Studio, vLLM).',
      es: 'Backends de IA: APIs cloud, CLIs del host y runtimes locales (Ollama, LM Studio, vLLM).',
      fr: 'Backends d’IA : API cloud (Anthropic, OpenAI, Gemini, xAI, …), CLI hôte (Claude Code, Grok, Kimi) et runtimes locaux (Ollama, LM Studio, vLLM).',
      tlh: 'AI bIng: cloud APIs (Anthropic, OpenAI, Gemini, xAI, …), juH CLIs (Claude Code, Grok, Kimi), \'ej juH runtimes (Ollama, LM Studio, vLLM).',
    },
  },
  'ai/routing-budget': {
    titles: { en: 'Routing & budget', hu: 'Routing és budget', de: 'Routing & Budget', es: 'Enrutado y presupuesto', fr: 'Routage et budget', tlh: 'He Huch meb je' },
    intros: {
      en: 'Which model handles which workload, fallbacks, model assignments, and token/cost budgets.',
      hu: 'Melyik modell milyen munkát kap, fallbackek, modell-hozzárendelések, token/költség budgetek.',
      de: 'Welches Modell welche Last trägt, Fallbacks, Zuweisungen und Token-/Kostenbudgets.',
      es: 'Qué modelo cubre cada carga, fallbacks, asignaciones y presupuestos de tokens/coste.',
      fr: 'Quel modèle traite quelle charge, les bascules, les affectations de modèles et les budgets de jetons/coût.',
      tlh: 'pat \'Iv Qu\' qeng, lIngqa\', pat lIngmey, \'ej token/Huch mebmey.',
    },
  },
  'ai/prompts': {
    titles: { en: 'Prompts system', hu: 'Prompt rendszer', de: 'Prompt-System', es: 'Sistema de prompts', fr: 'Système de prompts', tlh: 'mu\'tlhegh pat' },
    intros: {
      en: 'Layered prompts: master → project-type → project → conversation, with locked and editable sections.',
      hu: 'Réteges prompok: master → project-type → project → conversation, zárolt és szerkeszthető szekciókkal.',
      de: 'Geschichtete Prompts: Master → Projekttyp → Projekt → Gespräch, mit gesperrten und editierbaren Abschnitten.',
      es: 'Prompts en capas: master → tipo de proyecto → proyecto → conversación, con secciones bloqueadas y editables.',
      fr: 'Prompts en couches : master → type de projet → projet → conversation, avec sections verrouillées et éditables.',
      tlh: 'pat mu\'tlheghmey: master → Qu\' Segh → Qu\' → ja\'chuq, ngaQ \'ej choHlaH mIwmey.',
    },
  },
  'ai/mcp': {
    titles: { en: 'MCP servers', hu: 'MCP szerverek', de: 'MCP-Server', es: 'Servidores MCP', fr: 'Serveurs MCP', tlh: 'MCP Servers' },
    intros: {
      en: 'Model Context Protocol servers that expose external tools and data sources to agents.',
      hu: 'Model Context Protocol szerverek, amik külső toolokat és adatforrásokat adnak az ágenseknek.',
      de: 'Model Context Protocol-Server, die externe Tools und Datenquellen für Agenten freigeben.',
      es: 'Servidores Model Context Protocol que exponen tools y datos externos a los agentes.',
      fr: 'Serveurs Model Context Protocol qui exposent des outils et sources de données externes aux agents.',
      tlh: 'Model Context Protocol Servers — Hur janmey De\' Halmey je ghoqwI\'pu\'vaD \'ang.',
    },
  },
  'admin/users': {
    titles: { en: 'Users & permissions', hu: 'Felhasználók és jogosultságok', de: 'Benutzer & Rechte', es: 'Usuarios y permisos', fr: 'Utilisateurs et permissions', tlh: 'lo\'wI\'pu\' chaw\'mey je' },
    intros: {
      en: 'User accounts and CASL-based permissions for multi-user installs.',
      hu: 'Felhasználói fiókok és CASL-alapú jogosultságok többfelhasználós telepítéshez.',
      de: 'Benutzerkonten und CASL-Rechte für Mehrbenutzer-Installationen.',
      es: 'Cuentas de usuario y permisos CASL para instalaciones multiusuario.',
      fr: 'Comptes utilisateurs et permissions CASL pour les installations multi-utilisateurs.',
      tlh: 'lo\'wI\' mIwmey \'ej CASL chaw\'mey — lo\'wI\' law\' lIngvaD.',
    },
  },
  'admin/secrets': {
    titles: { en: 'Secrets & API keys', hu: 'Secrettek és API kulcsok', de: 'Secrets & API-Schlüssel', es: 'Secretos y claves API', fr: 'Secrets et clés API', tlh: 'peghmey API ngaQmey je' },
    intros: {
      en: 'Encrypted secrets store (scoped) and machine API keys for programmatic access to EYAS.',
      hu: 'Titkosított, scope-olt secret tár és gépi API kulcsok az EYAS programozott eléréséhez.',
      de: 'Verschlüsselter, gescopter Secret-Store und Maschinen-API-Keys für programmatischen Zugriff.',
      es: 'Almacén cifrado de secretos con scope y claves API de máquina para acceso programático.',
      fr: 'Magasin de secrets chiffrés (périmètre) et clés API machine pour un accès programmatique à EYAS.',
      tlh: 'ngaQlu\'bogh pegh pa\' (meb) \'ej jan API ngaQmey — EYAS lo\'meH ghItlh.',
    },
  },
  'admin/settings': {
    titles: { en: 'Settings overview', hu: 'Beállítások áttekintés', de: 'Einstellungen-Übersicht', es: 'Resumen de ajustes', fr: 'Vue d’ensemble des paramètres', tlh: 'SeHmey jIH' },
    intros: {
      en: 'System settings hub: appearance, language, model assignments, team agents, autonomy features, data port, and system update.',
      hu: 'Rendszerbeállítások központ: megjelenés, nyelv, modell-hozzárendelések, team ágensek, autonómia, data port, frissítés.',
      de: 'System-Einstellungen: Erscheinungsbild, Sprache, Modellzuweisungen, Team-Agenten, Autonomie, Data Port, Update.',
      es: 'Centro de ajustes: apariencia, idioma, asignaciones de modelo, agentes de equipo, autonomía, data port, actualización.',
      fr: 'Hub des paramètres système : apparence, langue, affectations de modèles, agents d’équipe, autonomie, port de données et mise à jour système.',
      tlh: 'pat SeHmey juH: qal\'aq, Hol, pat lIngmey, ghom ghoqwI\'pu\', SeH\'egh, De\' He, \'ej chu\'qa\'.',
    },
  },
  'admin/backup': {
    titles: { en: 'Backup & restore', hu: 'Backup és visszaállítás', de: 'Backup & Wiederherstellung', es: 'Copia y restauración', fr: 'Sauvegarde et restauration', tlh: 'qon qa\' je' },
    intros: {
      en: 'Create archives of data and config; restore onto a clean install of the same product version.',
      hu: 'Adat és config archívumok; visszaállítás tiszta installra, ugyanarra a termékverzióra.',
      de: 'Archive von Daten und Config; Restore auf saubere Installation derselben Produktversion.',
      es: 'Archivos de datos y config; restaurar en instalación limpia de la misma versión.',
      fr: 'Créez des archives de données et de configuration ; restaurez-les sur une installation propre de la même version du produit.',
      tlh: 'De\' SeH qonmey chu\'; chIm lIngDaq qa\' — wanI\'vam chovnatlh.',
    },
  },
  'admin/ingress': {
    titles: { en: 'Ingress tunnel', hu: 'Ingress alagút', de: 'Ingress-Tunnel', es: 'Túnel Ingress', fr: 'Tunnel Ingress', tlh: 'Ingress He' },
    intros: {
      en: 'Expose this EYAS instance remotely through a Cloudflare tunnel without opening inbound ports.',
      hu: 'Távoli elérés Cloudflare tunnelön, bejövő port nyitása nélkül.',
      de: 'EYAS remote über Cloudflare-Tunnel erreichbar machen, ohne eingehende Ports.',
      es: 'Exponer esta instancia EYAS en remoto con un túnel de Cloudflare sin abrir puertos de entrada.',
      fr: 'Exposez cette instance EYAS à distance via un tunnel Cloudflare sans ouvrir de ports entrants.',
      tlh: 'Cloudflare He lo\'taHvIS HopDaq EYAS patvam \'ang — \'el portmey poSmoHbe\'.',
    },
  },
  'admin/data-port': {
    titles: { en: 'Data import & export', hu: 'Adatimport és -export', de: 'Datenimport & -export', es: 'Importación y exportación', fr: 'Import et export de données', tlh: 'De\' chel nargh je' },
    intros: {
      en: 'Import memory, skills, and workspace rules from paths or uploads; apply only after explicit approve.',
      hu: 'Memória, skillek, workspace szabályok importja pathról vagy feltöltésből; alkalmazás csak explicit approve után.',
      de: 'Import von Speicher, Skills und Workspace-Regeln; Apply erst nach explizitem Approve.',
      es: 'Importar memoria, skills y reglas de workspace; aplicar solo tras approve explícito.',
      fr: 'Importez mémoire, compétences et règles d’espace de travail depuis des chemins ou des téléversements ; n’appliquez qu’après approbation explicite.',
      tlh: 'qawHaq, laHmey, workspace chutmey chel (He pagh cheltaHghach); chaw\'chu\' ret neH lIng.',
    },
  },
  'admin/security-privacy': {
    titles: { en: 'Security & privacy', hu: 'Biztonság és adatvédelem', de: 'Sicherheit & Datenschutz', es: 'Seguridad y privacidad', fr: 'Sécurité et confidentialité', tlh: 'Hub pegh je' },
    intros: {
      en: 'Security gate, audit log, privacy controls, and security events.',
      hu: 'Security gate, audit napló, privacy kontrollok és security események.',
      de: 'Security Gate, Audit-Log, Privacy-Kontrollen und Security-Events.',
      es: 'Security gate, auditoría, controles de privacidad y eventos de seguridad.',
      fr: 'Barrière de sécurité, journal d’audit, contrôles de confidentialité et événements de sécurité.',
      tlh: 'Hub lojmIt, chov ghItlh, pegh SeHmey, \'ej Hub wanI\'mey.',
    },
  },
  'admin/observability': {
    titles: { en: 'Observability & ops', hu: 'Observability és ops', de: 'Observability & Ops', es: 'Observabilidad y ops', fr: 'Observabilité et ops', tlh: 'bejlaH ops je' },
    intros: {
      en: 'Metrics, tracing, ops tooling, remote hands/nodes, ingress, and extensions.',
      hu: 'Metrikák, tracing, ops eszközök, remote hands/node-ok, ingress és extensionök.',
      de: 'Metriken, Tracing, Ops-Tools, Remote Hands/Nodes, Ingress und Extensions.',
      es: 'Métricas, tracing, herramientas ops, hands/nodos remotos, ingress y extensiones.',
      fr: 'Métriques, traçage, outils ops, mains/nœuds distants, ingress et extensions.',
      tlh: 'mI\'mey, tlha\', ops janmey, Hop ghopmey/Nodes, Ingress, \'ej cheltaHghachmey.',
    },
  },
  'deploy/native': {
    titles: { en: 'Native install', hu: 'Natív telepítés', de: 'Native Installation', es: 'Instalación nativa', fr: 'Installation native', tlh: 'native lIng' },
    intros: {
      en: 'Install EYAS with Bun on macOS/Linux (or Windows via scripts), without containers.',
      hu: 'EYAS telepítése Bunnal macOS/Linuxon (Windows scriptekkel), konténer nélkül.',
      de: 'EYAS mit Bun auf macOS/Linux (Windows per Skript), ohne Container.',
      es: 'Instalar EYAS con Bun en macOS/Linux (Windows con scripts), sin contenedores.',
      fr: 'Installez EYAS avec Bun sur macOS/Linux (ou Windows via des scripts), sans conteneurs.',
      tlh: 'Bun lo\'taHvIS macOS/LinuxDaq EYAS yIlIng (Windows scripts), pa\'mey Hutlh.',
    },
  },
  'deploy/docker': {
    titles: { en: 'Docker', hu: 'Docker', de: 'Docker', es: 'Docker', fr: 'Docker', tlh: 'Docker' },
    intros: {
      en: 'Run EYAS with Docker Compose, including optional GPU/Ollama profile.',
      hu: 'EYAS futtatása Docker Compose-zal, opcionális GPU/Ollama profillal.',
      de: 'EYAS mit Docker Compose, optional GPU/Ollama-Profil.',
      es: 'Ejecutar EYAS con Docker Compose, perfil GPU/Ollama opcional.',
      fr: 'Exécutez EYAS avec Docker Compose, y compris le profil GPU/Ollama facultatif.',
      tlh: 'Docker Compose lo\'taHvIS EYAS yIQap — poQbe\' GPU/Ollama pat je.',
    },
  },
  'deploy/kubernetes': {
    titles: { en: 'Kubernetes', hu: 'Kubernetes', de: 'Kubernetes', es: 'Kubernetes', fr: 'Kubernetes', tlh: 'Kubernetes' },
    intros: {
      en: 'Deploy with manifests and Helm chart under deploy/k8s/.',
      hu: 'Telepítés a deploy/k8s/ manifestekkel és Helm charttal.',
      de: 'Deploy mit Manifesten und Helm-Chart unter deploy/k8s/.',
      es: 'Desplegar con manifiestos y chart Helm en deploy/k8s/.',
      fr: 'Déployez avec les manifestes et le chart Helm sous deploy/k8s/.',
      tlh: 'deploy/k8s/ bIngDaq manifests Helm chart je lo\'taHvIS yIlIng.',
    },
  },
  'deploy/multi-instance': {
    titles: { en: 'Multiple instances', hu: 'Több példány', de: 'Mehrere Instanzen', es: 'Varias instancias', fr: 'Plusieurs instances', tlh: 'law\' patmey' },
    intros: {
      en: 'Run several EYAS instances on one machine via EYAS_HOME, ports, and separate data dirs.',
      hu: 'Több EYAS példány egy gépen: EYAS_HOME, portok, külön data könyvtárak.',
      de: 'Mehrere EYAS-Instanzen: EYAS_HOME, Ports, getrennte Datenverzeichnisse.',
      es: 'Varias instancias: EYAS_HOME, puertos y directorios de datos separados.',
      fr: 'Exécutez plusieurs instances EYAS sur une machine via EYAS_HOME, les ports et des répertoires de données distincts.',
      tlh: 'wa\' janDaq EYAS patmey law\' — EYAS_HOME, portmey, \'ej pIm De\' pa\'mey.',
    },
  },
  'deploy/cli': {
    titles: { en: 'CLI reference', hu: 'CLI referencia', de: 'CLI-Referenz', es: 'Referencia CLI', fr: 'Référence CLI', tlh: 'CLI De\'' },
    intros: {
      en: 'Command-line interface: lifecycle, diagnostics, config, and modules.',
      hu: 'Parancssori felület: életciklus, diagnosztika, config, modulok.',
      de: 'Kommandozeile: Lebenszyklus, Diagnose, Config, Module.',
      es: 'Interfaz de línea de comandos: ciclo de vida, diagnóstico, config y módulos.',
      fr: 'Interface en ligne de commande : cycle de vie, diagnostics, configuration et modules.',
      tlh: 'ra\' tlhegh: yIn He, chov, SeH, \'ej patHommey.',
    },
  },
  'deploy/configuration': {
    titles: { en: 'Configuration', hu: 'Konfiguráció', de: 'Konfiguration', es: 'Configuración', fr: 'Configuration', tlh: 'SeH' },
    intros: {
      en: 'YAML defaults, local overlays, and EYAS_* environment variables.',
      hu: 'YAML alapok, local overlay-ek és EYAS_* környezeti változók.',
      de: 'YAML-Defaults, lokale Overlays und EYAS_*-Umgebungsvariablen.',
      es: 'YAML por defecto, overlays locales y variables EYAS_*.',
      fr: 'Valeurs YAML par défaut, superpositions locales et variables d’environnement EYAS_*.',
      tlh: 'YAML motlh, juH overlays, \'ej EYAS_* De\' choHmey.',
    },
  },
  'reference/glossary': {
    titles: { en: 'Glossary', hu: 'Szójegyzék', de: 'Glossar', es: 'Glosario', fr: 'Glossaire', tlh: 'mu\'ghom' },
    intros: {
      en: 'Terms used across the product UI and this documentation.',
      hu: 'A termék UI-jában és ebben a dokumentációban használt fogalmak.',
      de: 'Begriffe in der Produkt-UI und dieser Dokumentation.',
      es: 'Términos usados en la UI del producto y en esta documentación.',
      fr: 'Termes utilisés dans l’interface du produit et dans cette documentation.',
      tlh: 'wanI\' UI \'ej ghItlhlIjDaq lo\'lu\'bogh mu\'mey.',
    },
  },
  'reference/faq': {
    titles: { en: 'FAQ', hu: 'GYIK', de: 'FAQ', es: 'FAQ', fr: 'FAQ', tlh: 'yI\'elbogh QInmey' },
    intros: {
      en: 'Common problems and short answers.',
      hu: 'Gyakori problémák és rövid válaszok.',
      de: 'Häufige Probleme und kurze Antworten.',
      es: 'Problemas frecuentes y respuestas cortas.',
      fr: 'Problèmes courants et réponses courtes.',
      tlh: 'motlh Qaghmey \'ej ran jangmey.',
    },
  },
  'reference/architecture': {
    titles: { en: 'Architecture (pointer)', hu: 'Architektúra (mutató)', de: 'Architektur (Verweis)', es: 'Arquitectura (enlace)', fr: 'Architecture (lien)', tlh: 'qach pat (Degh)' },
    intros: {
      en: 'Where deep technical specifications live in the repository (not duplicated here).',
      hu: 'Hol vannak a mély technikai specifikációk a repóban (itt nincsenek lemásolva).',
      de: 'Wo tiefe technische Specs im Repo liegen (hier nicht dupliziert).',
      es: 'Dónde están las specs técnicas profundas en el repo (no duplicadas aquí).',
      fr: 'Où se trouvent les spécifications techniques approfondies dans le dépôt (non dupliquées ici).',
      tlh: 'repoDaq nI\' tej Del tu\'lu\' (naDev qa\'be\'lu\').',
    },
  },
  concepts: {
    titles: { en: 'Core concepts', hu: 'Alapfogalmak', de: 'Grundkonzepte', es: 'Conceptos básicos', fr: 'Concepts de base', tlh: 'potlh qechmey' },
    intros: {
      en: 'Mental model of EYAS: agents, conversations, board, memory, skills, tools, and channels.',
      hu: 'Az EYAS mentális modellje: ágensek, beszélgetések, tábla, memória, skillek, toolok és csatornák.',
      de: 'Mentales Modell von EYAS: Agenten, Gespräche, Board, Speicher, Skills, Tools und Kanäle.',
      es: 'Modelo mental de EYAS: agentes, conversaciones, tablero, memoria, skills, tools y canales.',
      fr: 'Modèle mental d’EYAS : agents, conversations, tableau, mémoire, compétences, outils et canaux.',
      tlh: 'EYAS Qub pat: ghoqwI\'pu\', ja\'chuqmey, Qu\' nav, qawHaq, laHmey, janmey, Hemey je.',
    },
  },
  'getting-started': {
    titles: { en: 'Getting started', hu: 'Első lépések', de: 'Erste Schritte', es: 'Primeros pasos', fr: 'Premiers pas', tlh: 'wa\'DIch mIwmey' },
    intros: {
      en: 'Install EYAS, start the server, complete the wizard, and open the UI.',
      hu: 'EYAS telepítése, szerver indítása, varázsló, UI megnyitása.',
      de: 'EYAS installieren, Server starten, Assistent, UI öffnen.',
      es: 'Instalar EYAS, arrancar el servidor, asistente y abrir la UI.',
      fr: 'Installez EYAS, démarrez le serveur, terminez l’assistant et ouvrez l’interface.',
      tlh: 'EYAS yIlIng, Server yItagh, SeHwI\' yIrIn, \'ej UI yIpoSmoH.',
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
  fr: [
    [/password|masterPassword|confirmPassword/, 'Mot de passe secret. Jamais consigné dans les journaux ; les secrets sont chiffrés au repos dans le module Secrets.'],
    [/apiKey|apikey|token(?!Budget|sUsage)/i, 'Identifiant d’un fournisseur ou d’un client machine. Stocké chiffré lorsqu’il est enregistré depuis l’interface.'],
    [/monthlyTokenBudget|tokenBudget|budget/, 'Plafond d’usage (jetons ou coût). `0` signifie généralement illimité pour ce compteur.'],
    [/\.model$|modelAuto|modelCount|modelAssign/, 'Sélection du modèle LLM. **Auto** s’en remet à la politique de routage / aux affectations.'],
    [/effort/, 'Effort de raisonnement : plus élevé = réflexion plus profonde, plus lente et plus coûteuse.'],
    [/orchestrat/, 'Agressivité avec laquelle l’agent peut se déployer vers des sous-agents (Solo / Auto / Deep).'],
    [/enable|enabled|active|disabled/, 'État activé/désactivé sans supprimer l’entité.'],
    [/filter/, 'Filtre de liste uniquement — ne supprime pas les données sous-jacentes.'],
    [/tier|primary|specialist/, 'Niveau d’agent : primaire (toujours actif), équipe ou spécialiste.'],
    [/channel|bind|unbind|pairing/, 'Liaison d’une instance de canal de messagerie ou appariement avec un compte externe.'],
    [/cron|schedule|job/, 'Quand une tâche planifiée s’exécute ou comment elle est listée.'],
    [/scope/, 'Périmètre d’accès (p. ex. system / user / agent) pour les secrets ou les permissions.'],
    [/systemPrompt/, 'Instructions de base injectées pour cet agent (en plus des modèles de prompt en couches).'],
    [/goal|backstory|persona|role|description|name/, 'Texte d’identité qui façonne la présentation et les décisions de l’agent.'],
    [/tools|capabilities|constraints/, 'Ce que l’agent peut utiliser ou doit respecter (liste d’outils, étiquettes de capacité, lignes de contrainte).'],
    [/maxTurns/, 'Arrêt ferme du nombre de tours de boucle d’agent pour une exécution.'],
    [/voice|preset|dimension|address|tone|humor|emoji/, 'Contrôle du profil de voix (style d’élocution).'],
    [/workspace|IDENTITY|SOUL|fileLabel/, 'Fichier d’espace de travail dans le système d’identité basé sur des fichiers.'],
    [/memory|salience|episodic|working/, 'Entrée ou niveau de mémoire pour le rappel à long terme / de session.'],
    [/project|stage|priority|status|dueDate/, 'Champ métier sur une conversation ou une fiche du tableau.'],
    [/provider/, 'Backend d’IA (API cloud, CLI hôte ou runtime local).'],
    [/secret/, 'Entrée de secret chiffré dans le magasin de secrets de type coffre.'],
    [/backup|restore/, 'Flux de création / restauration d’archive de sauvegarde.'],
    [/import|export|dataPort/, 'Portabilité des données (proposition d’import → approbation, ou export).'],
    [/mcp/, 'Connexion à un serveur Model Context Protocol.'],
    [/prompt/, 'Couche de modèle de prompt dans la chaîne d’héritage.'],
    [/theme|template|language|lang|appearance/, 'Apparence de l’interface ou préférence de langue du produit.'],
    [/avatar/, 'Emoji ou image affiché comme avatar de l’agent.'],
  ],
  tlh: [
    [/password|masterPassword|confirmPassword/, 'pegh mu\'. ghItlhbe\'lu\'; Secrets patDaq QotDI\' ngaQlu\' peghmey.'],
    [/apiKey|apikey|token(?!Budget|sUsage)/i, 'nobwI\' pagh jan lo\'wI\' ngaQ. UI toDDI\' ngaQlu\'.'],
    [/monthlyTokenBudget|tokenBudget|budget/, 'lo\' meb (tokenmey pagh Huch). `0` motlh vuSHutlh.'],
    [/\.model$|modelAuto|modelCount|modelAssign/, 'LLM pat wIv. **Auto** He chut / lIngmeyvaD nob.'],
    [/effort/, 'Qub \'eq: law\'qu\'chugh Qubqu\', QIt \'ej Huch law\'.'],
    [/orchestrat/, 'ghoqwI\'Hompu\'vaD ghoqwI\' jaghqu\'ghach (Solo / Auto / Deep).'],
    [/enable|enabled|active|disabled/, 'chu\'/mev — Qaw\'be\' De\'.'],
    [/filter/, 'tetlh nej neH — bIng De\' Qaw\'be\'.'],
    [/tier|primary|specialist/, 'ghoqwI\' pat: potlh (reH Qap), ghom, pagh tejwI\'.'],
    [/channel|bind|unbind|pairing/, 'Qum He rar pagh Hur lo\'wI\' rar.'],
    [/cron|schedule|job/, 'poH Qu\' QapmeH poH pagh tetlh Del.'],
    [/scope/, 'lo\' meb (system / user / agent) peghmey pagh chaw\'meyvaD.'],
    [/systemPrompt/, 'ghoqwI\'vam motlh ra\'mey (mu\'tlhegh patmey chel).'],
    [/goal|backstory|persona|role|description|name/, 'pong mu\' — ghoqwI\' \'ang \'ej wuq.'],
    [/tools|capabilities|constraints/, 'ghoqwI\' lo\'laH pagh lIj nIS (janmey, laH per, chut tlheghmey).'],
    [/maxTurns/, 'wa\' QapmeH ghoqwI\' vIHtaHghach vuS.'],
    [/voice|preset|dimension|address|tone|humor|emoji/, 'wab SeH (ja\' tIgh).'],
    [/workspace|IDENTITY|SOUL|fileLabel/, 'ghoqwI\' ghItlh pong patDaq workspace ghItlh.'],
    [/memory|salience|episodic|working/, 'qawHaq De\' pagh pat — nI\' / poH qaw.'],
    [/project|stage|priority|status|dueDate/, 'ja\'chuq pagh Qu\' nav De\' malja\'.'],
    [/provider/, 'AI bIng (cloud API, juH CLI, pagh juH runtime).'],
    [/secret/, 'ngaQlu\'bogh pegh De\' Secrets pa\'Daq.'],
    [/backup|restore/, 'qon chu\' / qa\' mIw.'],
    [/import|export|dataPort/, 'De\' lIng (chel chup → chaw\', pagh nargh).'],
    [/mcp/, 'Model Context Protocol Server rar.'],
    [/prompt/, 'mu\'tlhegh pat lIng HeDaq.'],
    [/theme|template|language|lang|appearance/, 'UI qal\'aq pagh Hol wIv.'],
    [/avatar/, 'ghoqwI\' qab (emoji/ghItlhHommey).'],
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
  if (locale === 'fr') {
    return `Libellé/commande d’interface : « ${cell(label)} ». Clé i18n stable : \`${k}\`. La valeur est enregistrée via l’API associée.`
  }
  if (locale === 'tlh') {
    return `UI pong/SeH: «${cell(label)}». i18n key: \`${k}\`. API lo'taHvIS toDlu'.`
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
    fr: '| Champ / libellé | Clé | Signification |\n|---|---|---|',
    tlh: '| De\' / pong | Key | qech |\n|---|---|---|',
  }
  const lines = [headers[locale] || headers.en]
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
    fr: { overview: 'Aperçu', fields: 'Champs et commandes', how: 'Utilisation', related: 'Pages liées', notes: 'Notes' },
    tlh: { overview: 'jIH', fields: 'De\'mey SeHmey je', how: 'lo\'meH', related: 'latlh ghItlhmey', notes: 'qawHaq' },
  }
  return (map[locale] || map.en)[n]
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
      fr: `## Prérequis

- **Bun** 1.x (recommandé) ou Node.js 22+
- Facultatif : Docker / Docker Compose

## Installation (native)

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
\`\`\`

Ouvrez **http://localhost:3100** (ou le port de la configuration). Terminez l’[assistant de configuration](/docs/fr/setup-wizard/).

## Commandes de cycle de vie

| Commande | Signification |
|----------|---------------|
| \`eyas serve\` | Serveur au premier plan (journaux dans le terminal) |
| \`eyas start\` | Serveur en arrière-plan + pidfile |
| \`eyas stop\` | Arrêter le serveur en arrière-plan |
| \`eyas restart\` | stop puis start |
| \`eyas status\` | Santé + PID |
| \`eyas doctor\` | Diagnostics locaux |

Le frontend et la documentation produit se construisent automatiquement au démarrage s’ils manquent (\`build:web\`, \`docs:build\`).
`,
      tlh: `## poQlu'bogh

- **Bun** 1.x (chuplu') pagh Node.js 22+
- poQbe': Docker / Docker Compose

## lIng (native)

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
\`\`\`

**http://localhost:3100** yIpoSmoH (pagh SeH port). [tagh SeHwI'](/docs/tlh/setup-wizard/) yIrIn.

## yIn He ra'mey

| ra' | qech |
|-----|------|
| \`eyas serve\` | 'etlh Server (terminalDaq ghItlhmey) |
| \`eyas start\` | 'emDaq Server + pidfile |
| \`eyas stop\` | 'emDaq Server mev |
| \`eyas restart\` | mev ghIq tagh |
| \`eyas status\` | Dotlh + PID |
| \`eyas doctor\` | juH chov |

UI 'ej wanI' ghItlh Hutlhchugh taghDI' chenmoHlu' (\`build:web\`, \`docs:build\`).
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
      fr: `## Blocs constitutifs

| Concept | Signification |
|---------|---------------|
| **Agent** | Persona d’IA nommée avec modèle, outils, compétences, mémoire, voix et canaux |
| **Conversation** | Fil de messages avec un ou plusieurs agents ; peut déclencher des appels d’outils et des sous-exécutions |
| **Carte du tableau** | Unité de travail suivie, souvent liée à une conversation |
| **Projet / étape** | Structure pour regrouper les conversations le long d’un chemin de livraison |
| **Compétence** | Paquet de savoir procédural réutilisable (markdown) que les agents peuvent charger |
| **Outil** | Action invocable (code, navigateur, API, MCP) avec permissions |
| **Niveau de mémoire** | Working → episodic → semantic/procedural → archive (+ fichiers du coffre) |
| **Canal** | Boîte d’entrée/sortie externe (p. ex. Telegram) liée à un agent |
| **Fournisseur** | Backend LLM (API ou CLI/runtime local) |
| **Security gate** | Contrôles de politique avant les actions dangereuses |

## Flux typique

1. L’assistant de configuration crée le propriétaire + les agents principaux + un fournisseur  
2. Vous ouvrez une **conversation** ou créez une carte du **tableau**  
3. L’agent peut utiliser des **outils/compétences**, écrire en **mémoire**, ou **déléguer**  
4. Les résultats arrivent dans le chat, le tableau, les documents ou les **canaux** sortants
`,
      tlh: `## chenmoHwI' mey

| qech | Del |
|------|-----|
| **ghoqwI'** | ponglu'bogh AI nuv — pat, janmey, laHmey, qawHaq, wab, Hemey je |
| **ja'chuq** | wa' pagh law' ghoqwI'pu' QIn He; jan tlhobmey 'ej Qu'Hom Qapmey chenlaH |
| **Qu' nav chaw'** | tlha'laH Qu' Segh, motlh ja'chuq rar |
| **Qu' / mIw** | nob HeDaq ja'chuqmey ghom |
| **laH** | qa'laH mIw Sov pa' (markdown) ghoqwI'pu' qenglaH |
| **jan** | tlhoblaH ta' (ghItlh, Internet nejwI', API, MCP) chaw'mey je |
| **qawHaq pat** | working → episodic → semantic/procedural → archive (+ vault ghItlhmey) |
| **He** | Hur 'el/nargh (Telegram rur) ghoqwI' rar |
| **nobwI'** | LLM bIng (API pagh juH CLI/runtime) |
| **Hub lojmIt** | Qob ta'mey tlhoS chut chov |

## motlh He

1. tagh SeHwI' joH + potlh ghoqwI'pu' + nobwI' chu'  
2. **ja'chuq** pagh **Qu' nav** chaw' yIpoSmoH  
3. **jan/laH**, **qawHaq**, pagh **nobHa'** lo'laH ghoqwI'  
4. rIn: ja'chuq, Qu' nav, ghItlhmey, pagh nargh **Hemey**
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
      fr: `## Commandes

| Commande | Description |
|----------|-------------|
| \`eyas serve\` | Démarrer le serveur HTTP au premier plan |
| \`eyas start\` | Démarrage en arrière-plan (pidfile + journal) |
| \`eyas stop\` | Arrêter le processus en arrière-plan |
| \`eyas restart\` | Redémarrer |
| \`eyas status\` | État / santé |
| \`eyas doctor\` | Contrôles d’environnement |
| \`eyas version\` | Chaîne de version |
| \`eyas config validate\` | Valider la configuration YAML |
| \`eyas config reload\` | Rechargement à chaud lorsque pris en charge |
| \`eyas module list\` | Lister les modules |
| \`eyas module enable/disable <id>\` | Activer ou désactiver un module |

### Environnement

| Variable | Rôle |
|----------|------|
| \`EYAS_PORT\` / \`EYAS_HOST\` | Liaison d’écoute |
| \`EYAS_HOME\` | Répertoire d’instance (données, config locale, pid) |
| \`EYAS_INSTALL_ROOT\` | Chemin d’installation du code |
| \`EYAS_SKIP_WEB_BUILD\` | Ignorer la construction automatique du frontend |
| \`EYAS_SKIP_DOCS_BUILD\` | Ignorer la construction automatique de la documentation |
| \`EYAS_FORCE_WEB_BUILD\` / \`EYAS_FORCE_DOCS_BUILD\` | Forcer la reconstruction au démarrage |
`,
      tlh: `## ra'mey

| ra' | Del |
|-----|-----|
| \`eyas serve\` | HTTP Server 'etlhDaq tagh |
| \`eyas start\` | 'emDaq tagh (pidfile + ghItlh) |
| \`eyas stop\` | 'emDaq mIw mev |
| \`eyas restart\` | taghqa' |
| \`eyas status\` | QaptaH / Dotlh |
| \`eyas doctor\` | De' chov |
| \`eyas version\` | chovnatlh mu' |
| \`eyas config validate\` | YAML SeH chov |
| \`eyas config reload\` | tujqa' (chaw'lu'chugh) |
| \`eyas module list\` | patHommey tetlh |
| \`eyas module enable/disable <id>\` | patHom chu'/mev |

### De' choHmey

| choH | Qu' |
|------|-----|
| \`EYAS_PORT\` / \`EYAS_HOST\` | Qoy |
| \`EYAS_HOME\` | pat juH (De', juH SeH, pid) |
| \`EYAS_INSTALL_ROOT\` | ghItlh lIng He |
| \`EYAS_SKIP_WEB_BUILD\` | UI chenmoH nargh |
| \`EYAS_SKIP_DOCS_BUILD\` | ghItlh chenmoH nargh |
| \`EYAS_FORCE_WEB_BUILD\` / \`EYAS_FORCE_DOCS_BUILD\` | taghDI' chenmoHqa' ra' |
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
      fr: `## Démarrage rapide

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
\`\`\`

Ouvrez **http://localhost:3100**.

Profil GPU + Ollama :

\`\`\`bash
docker compose --profile gpu up -d
\`\`\`

## Contenu de l’image

- Runtime du backend
- Frontend compilé (\`src/web/dist\`)
- Documentation produit compilée (\`packages/docs/dist\` → servie sous \`/docs/\`)
- Configuration sous \`config/\` ; volume de données pour SQLite et le coffre
`,
      tlh: `## nom tagh

\`\`\`bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
\`\`\`

**http://localhost:3100** yIpoSmoH.

GPU + Ollama pat:

\`\`\`bash
docker compose --profile gpu up -d
\`\`\`

## ghItlhHommey ngaS

- bIng runtime
- chenmoHlu'bogh UI (\`src/web/dist\`)
- chenmoHlu'bogh wanI' ghItlh (\`packages/docs/dist\` → \`/docs/\`)
- \`config/\` bIngDaq SeH; SQLite vault jevaD De' volume
`,
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
      fr: `## Fichiers

| Fichier | Rôle |
|---------|------|
| \`config/default.yaml\` | Valeurs par défaut livrées (racine d’installation) |
| \`config/local.yaml\` ou \`$EYAS_HOME/config/local.yaml\` | Superpositions locales (fusionnées par-dessus) |
| \`.env\` | Secrets d’environnement facultatifs (ne jamais valider) |

## Priorité (typique)

1. Indicateurs CLI (\`--port\`, \`--host\`, \`--config\`)  
2. Environnement (\`EYAS_PORT\`, \`EYAS_HOST\`, \`EYAS_HOME\`, …)  
3. Superposition YAML locale  
4. YAML par défaut  

Voir aussi les notes multi-instances sous [Plusieurs instances](/docs/fr/deploy/multi-instance/).
`,
      tlh: `## ghItlhmey

| ghItlh | Qu' |
|--------|-----|
| \`config/default.yaml\` | noblu'bogh motlh (lIng 'o') |
| \`config/local.yaml\` pagh \`$EYAS_HOME/config/local.yaml\` | juH choH (DungDaq ghomlu') |
| \`.env\` | poQbe' De' peghmey (yIghItlhbe') |

## potlh He (motlh)

1. CLI per (\`--port\`, \`--host\`, \`--config\`)  
2. De' (\`EYAS_PORT\`, \`EYAS_HOST\`, \`EYAS_HOME\`, …)  
3. juH YAML overlay  
4. motlh YAML  

[law' patmey](/docs/tlh/deploy/multi-instance/) je yIlegh.
`,
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
      fr: `| Terme | Définition |
|-------|------------|
| Agent | Acteur d’IA configuré avec outils, compétences, mémoire, voix |
| Agent principal | Collègue toujours actif créé à la configuration (assistant + ingénieur) |
| Compétence | Paquet de savoir markdown |
| Outil | Capacité invocable avec ACL |
| Tableau | Surface de travail de type kanban |
| Conversation | Fil de discussion |
| Niveau de mémoire | Couche du système de mémoire hybride |
| Coffre | Fichiers markdown pour le savoir sémantique/procédural durable |
| Fournisseur | API LLM ou runtime local |
| MCP | Serveur Model Context Protocol |
| Canal | Connecteur de messagerie externe |
| Forge | Interface de propositions pour l’évolution âme/identité |
| Security gate | Contrôles de politique avant action |
| CASL | Bibliothèque de permissions utilisée pour l’autorisation |
`,
      tlh: `| mu' | Del |
|-----|-----|
| ghoqwI' | SeHlu'bogh AI nuv — janmey, laHmey, qawHaq, wab |
| potlh ghoqwI' | taghDI' chu'lu'bogh reH Qap jup (QaHwI' + pat tejwI') |
| laH | markdown Sov pa' |
| jan | tlhoblaH laH ACL je |
| Qu' nav | kanban rur Qu' Daq |
| ja'chuq | ja' He |
| qawHaq pat | ghom qawHaq patDaq mIw |
| vault | markdown ghItlhmey nI' SovvaD |
| nobwI' | LLM API pagh juH runtime |
| MCP | Model Context Protocol Server |
| He | Hur QIn rarwI' |
| Forge | SOUL/IDENTITY choH chup UI |
| Hub lojmIt | ta' tlhoS chut chov |
| CASL | chaw' paqvam |
`,
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
      fr: `### Port déjà utilisé
Choisissez un autre port : \`EYAS_PORT=3200 ./bin/eyas start\` ou libérez le processus qui occupe le port.

### Interface absente / vide
Assurez-vous que le frontend est compilé : \`bun run build:web\`. Le démarrage reconstruit automatiquement sauf si \`EYAS_SKIP_WEB_BUILD=1\`.

### /docs 404
Exécutez \`bun run docs:build\` ou redémarrez sans \`EYAS_SKIP_DOCS_BUILD\`. Le paquet se trouve dans \`packages/docs\`.

### Erreurs d’authentification fournisseur
Saisissez à nouveau la clé API sous Fournisseurs / Secrets ; pour les CLI, \`claude\` / \`grok\` / \`kimi\` doivent fonctionner dans le même environnement qu’EYAS.

### Où sont mes données ?
Sous le répertoire d’instance (\`EYAS_HOME\` ou le répertoire courant) : \`data/sqlite\`, \`data/vault\`, sauvegardes, journaux.
`,
      tlh: `### port lo'lu'taH
latlh port yIwIv: \`EYAS_PORT=3200 ./bin/eyas start\` pagh port HuS mIw yInargh.

### UI Hutlh / chIm
UI chenmoH yIchov: \`bun run build:web\`. taghDI' chenmoHlu' — \`EYAS_SKIP_WEB_BUILD=1\` Hutlhchugh.

### /docs 404
\`bun run docs:build\` yIQap pagh \`EYAS_SKIP_DOCS_BUILD\` Hutlh taghqa'. pa': \`packages/docs\`.

### nobwI' yI'el Qaghmey
Providers / Secrets bIngDaq API ngaQ yIghItlhqa'; CLIvaD \`claude\` / \`grok\` / \`kimi\` EYAS De'vamDaq Qap nIS.

### nuqDaq De'wIj?
pat juH (\`EYAS_HOME\` pagh cwd): \`data/sqlite\`, \`data/vault\`, qonmey, ghItlhmey.
`,
    }[locale]
  }

  if (slug === 'reference/architecture') {
    return {
      en: `Product user docs stop here. For implementers:

| Path | Content |
|------|---------|
| \`docs/eyas-architecture.md\` | Full modular architecture (56 sections) |
| \`docs/superpowers/specs/\` | Design specs |
| \`docs/superpowers/plans/\` | Implementation plans |
| \`CHANGELOG.md\` | Release history |

Do not treat architecture files as end-user manuals.
`,
      hu: `A felhasználói dokumentáció itt véget ér. Fejlesztőknek:

| Útvonal | Tartalom |
|---------|----------|
| \`docs/eyas-architecture.md\` | Moduláris architektúra |
| \`docs/superpowers/specs/\` | Design specek |
| \`docs/superpowers/plans/\` | Implementációs tervek |
| \`CHANGELOG.md\` | Release előzmények |
`,
      de: `User-Docs enden hier. Technik: \`docs/eyas-architecture.md\`, \`docs/superpowers/\`.`,
      es: `La docs de usuario termina aquí. Técnica: \`docs/eyas-architecture.md\`, \`docs/superpowers/\`.`,
      fr: `La documentation utilisateur s’arrête ici. Pour les implémenteurs :

| Chemin | Contenu |
|--------|---------|
| \`docs/eyas-architecture.md\` | Architecture modulaire complète (56 sections) |
| \`docs/superpowers/specs/\` | Spécifications de conception |
| \`docs/superpowers/plans/\` | Plans d’implémentation |
| \`CHANGELOG.md\` | Historique des versions |

Ne traitez pas les fichiers d’architecture comme des manuels utilisateur.
`,
      tlh: `lo'wI' ghItlh naDev rIn. chenmoHwI'pu'vaD:

| He | De' |
|----|-----|
| \`docs/eyas-architecture.md\` | naQ pat qach (56 mIwmey) |
| \`docs/superpowers/specs/\` | chen Del |
| \`docs/superpowers/plans/\` | chen nabmey |
| \`CHANGELOG.md\` | nob qun |

qach ghItlhmey lo'wI' paq rurQo'.
`,
    }[locale]
  }

  if (slug === 'deploy/native') {
    return {
      en: `## One-line installer

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
\`\`\`

Pinned version: \`bash -s -- --version 0.8.5-beta --yes\`

Windows: \`scripts/install.ps1\`.

After install, \`eyas start\` and open the UI. Product docs: \`/docs/\`.
`,
      hu: `## Egy-soros installer

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
\`\`\`

Verzió pin: \`--version 0.8.5-beta\`. Utána \`eyas start\`, UI + \`/docs/\`.
`,
      de: `Installer-Skript unter scripts/install.sh — danach eyas start.`,
      es: `Script en scripts/install.sh — luego eyas start.`,
      fr: `## Installateur en une ligne

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
\`\`\`

Version figée : \`bash -s -- --version 0.8.5-beta --yes\`

Windows : \`scripts/install.ps1\`.

Après l’installation, \`eyas start\` et ouvrez l’interface. Documentation produit : \`/docs/\`.
`,
      tlh: `## wa' tlhegh lIngwI'

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
\`\`\`

chovnatlh ngaQ: \`bash -s -- --version 0.8.5-beta --yes\`

Windows: \`scripts/install.ps1\`.

lIng ret, \`eyas start\` 'ej UI yIpoSmoH. wanI' ghItlh: \`/docs/\`.
`,
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
      fr: `Manifestes et chart Helm : \`deploy/k8s/\` et \`deploy/k8s/helm/eyas/\`.

Points typiques : image, \`EYAS_PORT\`, volume persistant pour \`data/\`, secrets pour les clés de fournisseur, ingress vers le Service.

Voir \`deploy/k8s/README.md\` dans le dépôt pour les valeurs actuelles du chart.
`,
      tlh: `manifests Helm chart je: \`deploy/k8s/\` 'ej \`deploy/k8s/helm/eyas/\`.

motlh qechmey: ghItlhHommey, \`EYAS_PORT\`, \`data/\`vaD taH volume, nobwI' ngaQmey peghmey, ServicevaD Ingress.

DaH chart De'vaD repoDaq \`deploy/k8s/README.md\` yIlegh.
`,
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
      fr: `## Isolation

| Levier | Rôle |
|--------|------|
| \`EYAS_HOME\` | Données, pid et configuration locale séparés |
| \`EYAS_PORT\` | Port d’écoute sans collision |
| Nom de projet Compose | Plusieurs piles sur un même hôte Docker |

Ne pointez jamais deux instances actives vers le même fichier SQLite.
`,
      tlh: `## pImghach

| jan | ngoQ |
|-----|------|
| \`EYAS_HOME\` | pIm De', pid, juH SeH |
| \`EYAS_PORT\` | qIHbe' Qoy port |
| Compose Qu' pong | wa' Docker juHDaq law' patmey |

QaptaHbogh cha' patmey wa' SQLite ghItlhvaD HeQo'.
`,
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
      fr: `## Interne vs externe

| Profil | Utilisé lorsque |
|--------|-----------------|
| **Interne** | Vous parlez avec vous et les collègues |
| **Externe** | Clients, inconnus, canaux publics |

## Dimensions

| Dimension | Contrôle |
|-----------|----------|
| Adresse | Informel / formel / honorifique / selon le contexte |
| Ton | Sérieux → enjoué |
| Détail | Bref → approfondi |
| Franchise | Direct → détourné |
| Humour | Aucun → incisif |
| Emoji | Jamais → souvent |

<h2 id="presets">Préréglages</h2>

Les préréglages intégrés comprennent \`jarvis\`, \`best-buddy\`, \`senior-ceo\`, \`pajtas-dev\`, \`standup\`, \`diplomata\`, \`coach\`, \`tutor\`. Vous pouvez choisir des préréglages différents pour la voix interne et externe.

<h2 id="dimensions">Dimensions</h2>

Voir l’onglet Voix de la fiche agent pour les commandes en direct correspondant au tableau ci-dessus.
`,
      tlh: `## qoD Hur je

| pat | lo'lu'DI' |
|-----|-----------|
| **qoD** | SoH ghom juppu' je |
| **Hur** | jeSwI'pu', novpu', Hoch He |

## patmey

| pat | SeH |
|-----|-----|
| pong | Sojbe' / potlh / quv / De' poH |
| wab | 'IQ → yon |
| De' | ran → naQ |
| ja'chuq | pep → He'egh |
| qID | pagh → jej |
| emoji | not → pIj |

<h2 id="presets">motlh wIv</h2>

motlh ngaS: \`jarvis\`, \`best-buddy\`, \`senior-ceo\`, \`pajtas-dev\`, \`standup\`, \`diplomata\`, \`coach\`, \`tutor\`. qoD Hur wabvaD wIv pIm DachoHlaH.

<h2 id="dimensions">patmey</h2>

ghoqwI' De' ghItlh **wab** per yIlegh — naDev tetlh rur SeHmey.
`,
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
        : locale === 'fr'
          ? `Tous les libellés et commandes visibles des modules UI concernés figurent ci-dessous (générés depuis les locales produit). Utilisez la colonne **Clé** pour l’aide intégrée.\n\n`
          : locale === 'tlh'
            ? `UI De'mey SeHmey je naDev tu'lu' (locale ghItlhmeyvo' chenmoHlu'). in-app QaHvaD **Key** lo'.\n\n`
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
