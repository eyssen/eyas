#!/usr/bin/env bun
/**
 * Generate docs skeleton pages from the outline definition.
 * Idempotent for files that only contain the skeleton marker.
 *
 * Usage: bun scripts/generate-skeleton.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const contentRoot = join(root, 'src/content/docs')
const MARKER = '<!-- eyas-docs-skeleton -->'

/** @typedef {{ slug: string, titles: Record<string,string>, descriptions: Record<string,string>, bullets: Record<string,string[]> }} Page */

/** @type {{ id: string, labels: Record<string,string>, pages: Page[] }[]} */
const SECTIONS = [
  {
    id: 'start',
    labels: { en: 'Start', hu: 'Kezdés', de: 'Start', es: 'Inicio' },
    pages: [
      {
        slug: 'index',
        titles: {
          en: 'Welcome',
          hu: 'Üdvözlet',
          de: 'Willkommen',
          es: 'Bienvenida',
        },
        descriptions: {
          en: 'EYAS user documentation — self-hosted personal AI.',
          hu: 'EYAS felhasználói dokumentáció — self-hosted személyes AI.',
          de: 'EYAS Dokumentation — selbst gehostete persönliche KI.',
          es: 'Manual de EYAS — IA personal autoalojada.',
        },
        bullets: {
          en: [
            'What EYAS is (and is not)',
            'Who this docs is for',
            'How docs are organised',
            'Languages and in-app help',
          ],
          hu: [
            'Mi az EYAS (és mi nem)',
            'Kinek szól a dokumentáció',
            'Hogyan van felépítve a dokumentáció',
            'Nyelvek és in-app súgó',
          ],
          de: [
            'Was EYAS ist (und was nicht)',
            'Für wen dieses Dokumentation ist',
            'Aufbau der Dokumentation',
            'Sprachen und In-App-Hilfe',
          ],
          es: [
            'Qué es EYAS (y qué no)',
            'A quién va dirigido este manual',
            'Cómo está organizada la documentación',
            'Idiomas y ayuda en la app',
          ],
        },
      },
      {
        slug: 'getting-started',
        titles: {
          en: 'Getting started',
          hu: 'Első lépések',
          de: 'Erste Schritte',
          es: 'Primeros pasos',
        },
        descriptions: {
          en: 'Install, first run, and open the UI.',
          hu: 'Telepítés, első indítás, UI megnyitása.',
          de: 'Installation, erster Start und UI öffnen.',
          es: 'Instalación, primer arranque y abrir la UI.',
        },
        bullets: {
          en: ['Prerequisites', 'Native install', 'Docker', 'Lifecycle commands', 'Open the UI'],
          hu: ['Előfeltételek', 'Natív telepítés', 'Docker', 'Életciklus-parancsok', 'UI megnyitása'],
          de: ['Voraussetzungen', 'Native Installation', 'Docker', 'Lebenszyklus-Befehle', 'UI öffnen'],
          es: ['Requisitos', 'Instalación nativa', 'Docker', 'Comandos de ciclo de vida', 'Abrir la UI'],
        },
      },
      {
        slug: 'setup-wizard',
        titles: {
          en: 'Setup wizard',
          hu: 'Setup varázsló',
          de: 'Setup-Assistent',
          es: 'Asistente de configuración',
        },
        descriptions: {
          en: 'First-boot wizard: admin, providers, seed agents.',
          hu: 'Első indítás: admin, providerek, seed ágensek.',
          de: 'Erster Start: Admin, Provider, Seed-Agenten.',
          es: 'Primer arranque: admin, proveedores, agentes semilla.',
        },
        bullets: {
          en: ['Language & appearance', 'Admin account', 'AI provider keys', 'Naming your agents', 'Optional specialists'],
          hu: ['Nyelv és megjelenés', 'Admin fiók', 'AI provider kulcsok', 'Ágensek elnevezése', 'Opcionális specialisták'],
          de: ['Sprache & Erscheinungsbild', 'Admin-Konto', 'KI-Provider-Schlüssel', 'Agenten benennen', 'Optionale Spezialisten'],
          es: ['Idioma y apariencia', 'Cuenta de admin', 'Claves de proveedor de IA', 'Nombrar agentes', 'Especialistas opcionales'],
        },
      },
      {
        slug: 'concepts',
        titles: {
          en: 'Core concepts',
          hu: 'Alapfogalmak',
          de: 'Grundkonzepte',
          es: 'Conceptos básicos',
        },
        descriptions: {
          en: 'Mental model: agents, conversations, board, memory, skills.',
          hu: 'Mentális modell: ágensek, beszélgetések, tábla, memória, skillek.',
          de: 'Mentales Modell: Agenten, Gespräche, Board, Speicher, Skills.',
          es: 'Modelo mental: agentes, conversaciones, tablero, memoria, skills.',
        },
        bullets: {
          en: [
            'Agent vs conversation vs task',
            'Board & projects',
            'Five-tier memory + vault',
            'Skills and tools',
            'Channels (UI, Telegram, …)',
          ],
          hu: [
            'Ágens vs beszélgetés vs feladat',
            'Tábla és projektek',
            'Öt szintű memória + vault',
            'Skillek és toolok',
            'Csatornák (UI, Telegram, …)',
          ],
          de: [
            'Agent vs Gespräch vs Aufgabe',
            'Board & Projekte',
            'Fünf-Ebenen-Speicher + Vault',
            'Skills und Tools',
            'Kanäle (UI, Telegram, …)',
          ],
          es: [
            'Agente vs conversación vs tarea',
            'Tablero y proyectos',
            'Memoria de cinco niveles + vault',
            'Skills y tools',
            'Canales (UI, Telegram, …)',
          ],
        },
      },
    ],
  },
  {
    id: 'daily',
    labels: { en: 'Daily work', hu: 'Napi munka', de: 'Tägliche Arbeit', es: 'Trabajo diario' },
    pages: [
      {
        slug: 'daily/dashboard',
        titles: { en: 'Dashboard', hu: 'Irányítópult', de: 'Dashboard', es: 'Panel' },
        descriptions: {
          en: 'Home view: status, nudges, setup tips.',
          hu: 'Kezdőnézet: státusz, nudge-ok, setup tippek.',
          de: 'Startansicht: Status, Hinweise, Setup-Tipps.',
          es: 'Vista de inicio: estado, avisos, consejos de setup.',
        },
        bullets: {
          en: ['Status overview', 'Autonomy nudges', 'Setup recommendations', 'Jump into work'],
          hu: ['Státusz áttekintés', 'Autonómia nudge-ok', 'Setup ajánlások', 'Gyors belépés a munkába'],
          de: ['Statusübersicht', 'Autonomie-Hinweise', 'Setup-Empfehlungen', 'Schnell in die Arbeit'],
          es: ['Resumen de estado', 'Avisos de autonomía', 'Recomendaciones de setup', 'Entrar al trabajo'],
        },
      },
      {
        slug: 'daily/conversations',
        titles: {
          en: 'Conversations',
          hu: 'Beszélgetések',
          de: 'Gespräche',
          es: 'Conversaciones',
        },
        descriptions: {
          en: 'Chat with agents: streaming, tools, context rail.',
          hu: 'Chat ágensekkel: streaming, toolok, context rail.',
          de: 'Chat mit Agenten: Streaming, Tools, Context Rail.',
          es: 'Chat con agentes: streaming, tools, context rail.',
        },
        bullets: {
          en: ['Start a conversation', 'Messages & streaming', 'Tool calls', 'Context / chatter rail', 'Team sessions'],
          hu: ['Beszélgetés indítása', 'Üzenetek és streaming', 'Tool hívások', 'Context / chatter sáv', 'Team sessionök'],
          de: ['Gespräch starten', 'Nachrichten & Streaming', 'Tool-Aufrufe', 'Context-/Chatter-Leiste', 'Team-Sessions'],
          es: ['Iniciar conversación', 'Mensajes y streaming', 'Llamadas a tools', 'Barra de contexto', 'Sesiones de equipo'],
        },
      },
      {
        slug: 'daily/board',
        titles: { en: 'Board', hu: 'Tábla', de: 'Board', es: 'Tablero' },
        descriptions: {
          en: 'Kanban, list, timeline, and graph views for work.',
          hu: 'Kanban, lista, idővonal és graph nézetek.',
          de: 'Kanban-, Listen-, Timeline- und Graph-Ansichten.',
          es: 'Vistas kanban, lista, línea de tiempo y grafo.',
        },
        bullets: {
          en: ['Cards & columns', 'Views (kanban / list / timeline / graph)', 'Filters & pins', 'Linking to conversations'],
          hu: ['Kártyák és oszlopok', 'Nézetek (kanban / lista / timeline / graph)', 'Szűrők és pinek', 'Kapcsolat beszélgetésekhez'],
          de: ['Karten & Spalten', 'Ansichten (Kanban / Liste / Timeline / Graph)', 'Filter & Pins', 'Verknüpfung mit Gesprächen'],
          es: ['Tarjetas y columnas', 'Vistas (kanban / lista / timeline / grafo)', 'Filtros y pines', 'Enlace a conversaciones'],
        },
      },
      {
        slug: 'daily/projects',
        titles: { en: 'Projects', hu: 'Projektek', de: 'Projekte', es: 'Proyectos' },
        descriptions: {
          en: 'Project types, stages, and work organisation.',
          hu: 'Projekt típusok, stage-ek, munka szervezése.',
          de: 'Projekttypen, Stages und Arbeitsorganisation.',
          es: 'Tipos de proyecto, etapas y organización del trabajo.',
        },
        bullets: {
          en: ['Project types', 'Stages', 'Conversation tracking', 'Templates'],
          hu: ['Projekt típusok', 'Stage-ek', 'Beszélgetés-követés', 'Sablonok'],
          de: ['Projekttypen', 'Stages', 'Gesprächsverfolgung', 'Vorlagen'],
          es: ['Tipos de proyecto', 'Etapas', 'Seguimiento de conversaciones', 'Plantillas'],
        },
      },
      {
        slug: 'daily/search',
        titles: { en: 'Search', hu: 'Keresés', de: 'Suche', es: 'Búsqueda' },
        descriptions: {
          en: 'Unified search across memory, board, docs, and sources.',
          hu: 'Egyesített keresés memóriában, táblán, doksikban, forrásokban.',
          de: 'Einheitliche Suche in Speicher, Board, Docs und Quellen.',
          es: 'Búsqueda unificada en memoria, tablero, docs y fuentes.',
        },
        bullets: {
          en: ['Query tips', 'Result types', 'Search sources', 'Filters'],
          hu: ['Lekérdezési tippek', 'Találat-típusok', 'Keresési források', 'Szűrők'],
          de: ['Abfrage-Tipps', 'Ergebnistypen', 'Suchquellen', 'Filter'],
          es: ['Consejos de consulta', 'Tipos de resultado', 'Fuentes de búsqueda', 'Filtros'],
        },
      },
    ],
  },
  {
    id: 'agents',
    labels: { en: 'Agents', hu: 'Ágensek', de: 'Agenten', es: 'Agentes' },
    pages: [
      {
        slug: 'agents/overview',
        titles: {
          en: 'Agents overview',
          hu: 'Ágensek áttekintés',
          de: 'Agenten-Übersicht',
          es: 'Resumen de agentes',
        },
        descriptions: {
          en: 'Personas that act: seed agents, specialists, lifecycle.',
          hu: 'Cselekvő personák: seed ágensek, specialisták, életciklus.',
          de: 'Handelnde Personas: Seed-Agenten, Spezialisten, Lebenszyklus.',
          es: 'Personas que actúan: agentes semilla, especialistas, ciclo de vida.',
        },
        bullets: {
          en: ['Primary teammates', 'Specialists', 'List & detail UI', 'When to add a new agent'],
          hu: ['Elsődleges társak', 'Specialisták', 'Lista és részletek UI', 'Mikor érdemes új ágenst felvenni'],
          de: ['Primäre Teamkollegen', 'Spezialisten', 'Listen- & Detail-UI', 'Wann einen neuen Agenten anlegen'],
          es: ['Compañeros principales', 'Especialistas', 'UI de lista y detalle', 'Cuándo añadir un agente'],
        },
      },
      {
        slug: 'agents/configure',
        titles: {
          en: 'Create & configure',
          hu: 'Létrehozás és beállítás',
          de: 'Erstellen & konfigurieren',
          es: 'Crear y configurar',
        },
        descriptions: {
          en: 'Agent settings, model assignment, budgets, channels.',
          hu: 'Ágens beállítások, modell, budget, csatornák.',
          de: 'Agenteneinstellungen, Modell, Budget, Kanäle.',
          es: 'Ajustes del agente, modelo, presupuesto, canales.',
        },
        bullets: {
          en: ['Create from template', 'Model & budget', 'Channels', 'Permissions & tools'],
          hu: ['Létrehozás sablonból', 'Modell és budget', 'Csatornák', 'Jogosultságok és toolok'],
          de: ['Aus Vorlage erstellen', 'Modell & Budget', 'Kanäle', 'Rechte & Tools'],
          es: ['Crear desde plantilla', 'Modelo y presupuesto', 'Canales', 'Permisos y tools'],
        },
      },
      {
        slug: 'agents/identity-workspace',
        titles: {
          en: 'Identity & workspace',
          hu: 'Identitás és workspace',
          de: 'Identität & Workspace',
          es: 'Identidad y workspace',
        },
        descriptions: {
          en: 'IDENTITY, SOUL, and workspace files that shape behaviour.',
          hu: 'IDENTITY, SOUL és workspace fájlok, amik a viselkedést alakítják.',
          de: 'IDENTITY, SOUL und Workspace-Dateien, die Verhalten prägen.',
          es: 'IDENTITY, SOUL y archivos de workspace que definen el comportamiento.',
        },
        bullets: {
          en: ['IDENTITY.md', 'SOUL / voice link', 'Workspace files', 'History & proposals'],
          hu: ['IDENTITY.md', 'SOUL / hang kapcsolat', 'Workspace fájlok', 'Előzmények és javaslatok'],
          de: ['IDENTITY.md', 'SOUL / Stimme', 'Workspace-Dateien', 'Historie & Vorschläge'],
          es: ['IDENTITY.md', 'SOUL / voz', 'Archivos de workspace', 'Historial y propuestas'],
        },
      },
      {
        slug: 'agents/voice',
        titles: {
          en: 'Voice profiles',
          hu: 'Hangprofilok',
          de: 'Stimmprofile',
          es: 'Perfiles de voz',
        },
        descriptions: {
          en: 'Internal/external voice, six dimensions, presets.',
          hu: 'Belső/külső hang, hat dimenzió, presetek.',
          de: 'Interne/externe Stimme, sechs Dimensionen, Presets.',
          es: 'Voz interna/externa, seis dimensiones, presets.',
        },
        bullets: {
          en: ['Internal vs external', 'Six dimensions', 'Presets', 'Overrides'],
          hu: ['Belső vs külső', 'Hat dimenzió', 'Presetek', 'Felülírások'],
          de: ['Intern vs extern', 'Sechs Dimensionen', 'Presets', 'Überschreibungen'],
          es: ['Interna vs externa', 'Seis dimensiones', 'Presets', 'Sobrescrituras'],
        },
      },
      {
        slug: 'agents/teams',
        titles: {
          en: 'Teams & delegation',
          hu: 'Csapatok és delegálás',
          de: 'Teams & Delegation',
          es: 'Equipos y delegación',
        },
        descriptions: {
          en: 'Multi-agent collaboration, handoffs, team sessions.',
          hu: 'Többágenses együttműködés, handoffok, team sessionök.',
          de: 'Multi-Agent-Zusammenarbeit, Handoffs, Team-Sessions.',
          es: 'Colaboración multiagente, handoffs, sesiones de equipo.',
        },
        bullets: {
          en: ['Team configuration', 'Delegation patterns', 'Handoffs & artifacts', 'Team sessions UI'],
          hu: ['Team konfiguráció', 'Delegálási minták', 'Handoffok és artifactok', 'Team session UI'],
          de: ['Team-Konfiguration', 'Delegationsmuster', 'Handoffs & Artefakte', 'Team-Session-UI'],
          es: ['Configuración de equipo', 'Patrones de delegación', 'Handoffs y artefactos', 'UI de sesiones'],
        },
      },
      {
        slug: 'agents/runs',
        titles: {
          en: 'Runs & Mission Control',
          hu: 'Futtatások és Mission Control',
          de: 'Läufe & Mission Control',
          es: 'Ejecuciones y Mission Control',
        },
        descriptions: {
          en: 'Observe live and past agent runs.',
          hu: 'Élő és múltbeli ágens futtatások követése.',
          de: 'Live- und vergangene Agentenläufe beobachten.',
          es: 'Observar ejecuciones de agentes en vivo y pasadas.',
        },
        bullets: {
          en: ['Agent runs list', 'Run tree & progress', 'Mission Control cards', 'Stop / resume'],
          hu: ['Agent runs lista', 'Run tree és progress', 'Mission Control kártyák', 'Stop / resume'],
          de: ['Agent-Runs-Liste', 'Run-Tree & Fortschritt', 'Mission-Control-Karten', 'Stop / Resume'],
          es: ['Lista de ejecuciones', 'Árbol de run y progreso', 'Tarjetas de Mission Control', 'Stop / resume'],
        },
      },
      {
        slug: 'agents/forge',
        titles: { en: 'Forge', hu: 'Forge', de: 'Forge', es: 'Forge' },
        descriptions: {
          en: 'Evolve agent soul and identity with proposals.',
          hu: 'Ágens soul/identity fejlesztése javaslatokkal.',
          de: 'Soul/Identity mit Vorschlägen weiterentwickeln.',
          es: 'Evolucionar soul/identidad con propuestas.',
        },
        bullets: {
          en: ['What Forge does', 'Soul proposals', 'Review & apply', 'Safety'],
          hu: ['Mit csinál a Forge', 'Soul javaslatok', 'Review és alkalmazás', 'Biztonság'],
          de: ['Was Forge tut', 'Soul-Vorschläge', 'Prüfen & anwenden', 'Sicherheit'],
          es: ['Qué hace Forge', 'Propuestas de soul', 'Revisar y aplicar', 'Seguridad'],
        },
      },
      {
        slug: 'agents/autonomy',
        titles: { en: 'Autonomy', hu: 'Autonómia', de: 'Autonomie', es: 'Autonomía' },
        descriptions: {
          en: 'How much agents may do without asking.',
          hu: 'Mennyit tehetnek az ágensek megkérdezés nélkül.',
          de: 'Wie viel Agenten ohne Rückfrage tun dürfen.',
          es: 'Cuánto pueden hacer los agentes sin preguntar.',
        },
        bullets: {
          en: ['Autonomy levels', 'Approval tiers', 'Feature flags', 'Dashboards'],
          hu: ['Autonómia szintek', 'Approval tier-ek', 'Feature flagek', 'Dashboardok'],
          de: ['Autonomiestufen', 'Approval-Tiers', 'Feature-Flags', 'Dashboards'],
          es: ['Niveles de autonomía', 'Tiers de aprobación', 'Feature flags', 'Paneles'],
        },
      },
    ],
  },
  {
    id: 'automation',
    labels: {
      en: 'Skills & automation',
      hu: 'Skillek és automatizálás',
      de: 'Skills & Automatisierung',
      es: 'Skills y automatización',
    },
    pages: [
      {
        slug: 'automation/skills',
        titles: { en: 'Skills', hu: 'Skillek', de: 'Skills', es: 'Skills' },
        descriptions: {
          en: 'Reusable skill packs agents can load.',
          hu: 'Újrahasználható skill csomagok az ágenseknek.',
          de: 'Wiederverwendbare Skill-Pakete für Agenten.',
          es: 'Paquetes de skills reutilizables para agentes.',
        },
        bullets: {
          en: ['Builtin vs user vs own', 'Browse & enable', 'Writing a skill', 'Import'],
          hu: ['Builtin vs user vs own', 'Böngészés és engedélyezés', 'Saját skill írása', 'Import'],
          de: ['Builtin vs user vs own', 'Durchsuchen & aktivieren', 'Eigenen Skill schreiben', 'Import'],
          es: ['Builtin vs user vs own', 'Explorar y activar', 'Escribir un skill', 'Importar'],
        },
      },
      {
        slug: 'automation/tools',
        titles: { en: 'Tools', hu: 'Toolok', de: 'Tools', es: 'Tools' },
        descriptions: {
          en: 'Built-in and extension tools agents call.',
          hu: 'Beépített és extension toolok, amiket az ágens hív.',
          de: 'Eingebaute und Extension-Tools, die Agenten aufrufen.',
          es: 'Tools integrados y de extensión que llaman los agentes.',
        },
        bullets: {
          en: ['Tool catalogue', 'Permissions', 'Sandboxing', 'MCP-backed tools'],
          hu: ['Tool katalógus', 'Jogosultságok', 'Sandbox', 'MCP-alapú toolok'],
          de: ['Tool-Katalog', 'Rechte', 'Sandboxing', 'MCP-basierte Tools'],
          es: ['Catálogo de tools', 'Permisos', 'Sandbox', 'Tools vía MCP'],
        },
      },
      {
        slug: 'automation/scheduler',
        titles: { en: 'Scheduler', hu: 'Ütemező', de: 'Scheduler', es: 'Programador' },
        descriptions: {
          en: 'Cron jobs, calendars, and recurring agent work.',
          hu: 'Cron jobok, naptár, ismétlődő ágens feladatok.',
          de: 'Cron-Jobs, Kalender und wiederkehrende Agentenarbeit.',
          es: 'Jobs cron, calendario y trabajo recurrente de agentes.',
        },
        bullets: {
          en: ['Jobs list', 'Calendar & timeline', 'Agent-backed jobs', 'Dead letters'],
          hu: ['Job lista', 'Naptár és timeline', 'Ágenses jobok', 'Dead letter'],
          de: ['Job-Liste', 'Kalender & Timeline', 'Agenten-Jobs', 'Dead Letters'],
          es: ['Lista de jobs', 'Calendario y timeline', 'Jobs con agente', 'Dead letters'],
        },
      },
      {
        slug: 'automation/pipelines',
        titles: { en: 'Pipelines', hu: 'Pipeline-ok', de: 'Pipelines', es: 'Pipelines' },
        descriptions: {
          en: 'Multi-step flows such as ticket-to-code.',
          hu: 'Többlépéses folyamatok, pl. ticket-to-code.',
          de: 'Mehrstufige Flows, z. B. Ticket-to-Code.',
          es: 'Flujos de varios pasos, p. ej. ticket-to-code.',
        },
        bullets: {
          en: ['Pipeline list', 'Ticket-to-code', 'Run history', 'Inputs & gates'],
          hu: ['Pipeline lista', 'Ticket-to-code', 'Futtatás előzmények', 'Inputok és gate-ek'],
          de: ['Pipeline-Liste', 'Ticket-to-Code', 'Laufhistorie', 'Inputs & Gates'],
          es: ['Lista de pipelines', 'Ticket-to-code', 'Historial de runs', 'Entradas y gates'],
        },
      },
      {
        slug: 'automation/research',
        titles: { en: 'Research', hu: 'Kutatás', de: 'Research', es: 'Investigación' },
        descriptions: {
          en: 'Deep research workflows and reports.',
          hu: 'Mély kutatási workflow-k és jelentések.',
          de: 'Tiefen-Research-Workflows und Berichte.',
          es: 'Flujos de investigación profunda e informes.',
        },
        bullets: {
          en: ['Start a research job', 'Sources', 'Reports', 'Feeding results into memory'],
          hu: ['Kutatás indítása', 'Források', 'Jelentések', 'Eredmények a memóriába'],
          de: ['Research starten', 'Quellen', 'Berichte', 'Ergebnisse in den Speicher'],
          es: ['Iniciar investigación', 'Fuentes', 'Informes', 'Resultados a la memoria'],
        },
      },
      {
        slug: 'automation/proactive',
        titles: {
          en: 'Proactive assistant',
          hu: 'Proaktív asszisztens',
          de: 'Proaktiver Assistent',
          es: 'Asistente proactivo',
        },
        descriptions: {
          en: 'Heartbeat checks, suggestions, unsolicited help.',
          hu: 'Heartbeat ellenőrzések, javaslatok, felajánlott segítség.',
          de: 'Heartbeat-Checks, Vorschläge, unaufgeforderte Hilfe.',
          es: 'Comprobaciones heartbeat, sugerencias, ayuda proactiva.',
        },
        bullets: {
          en: ['Enable proactive mode', 'Nudge types', 'Quiet hours', 'Safety bounds'],
          hu: ['Proaktív mód bekapcsolása', 'Nudge típusok', 'Csendes órák', 'Biztonsági határok'],
          de: ['Proaktiven Modus aktivieren', 'Nudge-Typen', 'Ruhezeiten', 'Sicherheitsgrenzen'],
          es: ['Activar modo proactivo', 'Tipos de aviso', 'Horas quietas', 'Límites de seguridad'],
        },
      },
      {
        slug: 'automation/self-learning',
        titles: {
          en: 'Self-learning & skill evolution',
          hu: 'Öntanulás és skill evolution',
          de: 'Selbstlernen & Skill-Evolution',
          es: 'Autoaprendizaje y evolución de skills',
        },
        descriptions: {
          en: 'Insights from use; evolving skills over time.',
          hu: 'Használatból tanulás; skillek fejlődése idővel.',
          de: 'Lernen aus Nutzung; Skills entwickeln sich.',
          es: 'Aprender del uso; skills que evolucionan.',
        },
        bullets: {
          en: ['Insights dashboard', 'Skill evolution', 'Review before apply', 'Privacy'],
          hu: ['Insights dashboard', 'Skill evolution', 'Review alkalmazás előtt', 'Adatvédelem'],
          de: ['Insights-Dashboard', 'Skill-Evolution', 'Prüfen vor Apply', 'Datenschutz'],
          es: ['Panel de insights', 'Evolución de skills', 'Revisar antes de aplicar', 'Privacidad'],
        },
      },
    ],
  },
  {
    id: 'knowledge',
    labels: {
      en: 'Knowledge & memory',
      hu: 'Tudás és memória',
      de: 'Wissen & Speicher',
      es: 'Conocimiento y memoria',
    },
    pages: [
      {
        slug: 'knowledge/memory',
        titles: { en: 'Memory', hu: 'Memória', de: 'Speicher', es: 'Memoria' },
        descriptions: {
          en: 'Five tiers: working, episodic, semantic, procedural, archive.',
          hu: 'Öt szint: working, episodic, semantic, procedural, archive.',
          de: 'Fünf Ebenen: working, episodic, semantic, procedural, archive.',
          es: 'Cinco niveles: working, episodic, semantic, procedural, archive.',
        },
        bullets: {
          en: ['Tier model', 'Dashboard & review', 'Graph view', 'Tags', 'Consolidation'],
          hu: ['Szint-modell', 'Dashboard és review', 'Graph nézet', 'Tagek', 'Konszolidáció'],
          de: ['Ebenen-Modell', 'Dashboard & Review', 'Graph-Ansicht', 'Tags', 'Konsolidierung'],
          es: ['Modelo de niveles', 'Panel y revisión', 'Vista de grafo', 'Etiquetas', 'Consolidación'],
        },
      },
      {
        slug: 'knowledge/knowledge-base',
        titles: {
          en: 'Knowledge base',
          hu: 'Tudásbázis',
          de: 'Wissensbasis',
          es: 'Base de conocimiento',
        },
        descriptions: {
          en: 'Editable wiki-style knowledge pages.',
          hu: 'Szerkeszthető wiki-szerű tudásoldalak.',
          de: 'Editierbare Wiki-Wissensseiten.',
          es: 'Páginas de conocimiento tipo wiki editables.',
        },
        bullets: {
          en: ['Tree navigation', 'Editor', 'Linking', 'When to use vs memory'],
          hu: ['Fa navigáció', 'Szerkesztő', 'Linkelés', 'Mikor memória helyett'],
          de: ['Baumnavigation', 'Editor', 'Verlinkung', 'Wann statt Speicher'],
          es: ['Navegación en árbol', 'Editor', 'Enlaces', 'Cuándo usar vs memoria'],
        },
      },
      {
        slug: 'knowledge/documents',
        titles: { en: 'Documents', hu: 'Dokumentumok', de: 'Dokumente', es: 'Documentos' },
        descriptions: {
          en: 'Upload, index, and use files with agents.',
          hu: 'Fájlok feltöltése, indexelése, használata ágensekkel.',
          de: 'Dateien hochladen, indexieren, mit Agenten nutzen.',
          es: 'Subir, indexar y usar archivos con agentes.',
        },
        bullets: {
          en: ['Upload', 'Supported types', 'Settings', 'Retrieval in chat'],
          hu: ['Feltöltés', 'Támogatott típusok', 'Beállítások', 'Visszakeresés chatben'],
          de: ['Upload', 'Unterstützte Typen', 'Einstellungen', 'Abruf im Chat'],
          es: ['Subida', 'Tipos soportados', 'Ajustes', 'Recuperación en el chat'],
        },
      },
      {
        slug: 'knowledge/client-wiki',
        titles: {
          en: 'Client wiki',
          hu: 'Ügyfél wiki',
          de: 'Kunden-Wiki',
          es: 'Wiki de cliente',
        },
        descriptions: {
          en: 'Per-client collaborative documentation.',
          hu: 'Ügyfél-specifikus közös dokumentáció.',
          de: 'Kundenbezogene gemeinsame Dokumentation.',
          es: 'Documentación colaborativa por cliente.',
        },
        bullets: {
          en: ['When to use', 'Structure', 'Sharing with agents', 'Permissions'],
          hu: ['Mikor használd', 'Struktúra', 'Megosztás ágensekkel', 'Jogosultságok'],
          de: ['Wann nutzen', 'Struktur', 'Teilen mit Agenten', 'Rechte'],
          es: ['Cuándo usarlo', 'Estructura', 'Compartir con agentes', 'Permisos'],
        },
      },
      {
        slug: 'knowledge/meetings',
        titles: { en: 'Meetings', hu: 'Meetingek', de: 'Meetings', es: 'Reuniones' },
        descriptions: {
          en: 'Meeting processing, notes, and follow-ups.',
          hu: 'Meeting feldolgozás, jegyzetek, follow-upok.',
          de: 'Meeting-Verarbeitung, Notizen, Follow-ups.',
          es: 'Procesamiento de reuniones, notas y seguimientos.',
        },
        bullets: {
          en: ['Capture', 'Transcripts & summaries', 'Action items', 'Link to board'],
          hu: ['Rögzítés', 'Átiratok és összefoglalók', 'Action itemek', 'Kapcsolat a táblához'],
          de: ['Erfassen', 'Transkripte & Zusammenfassungen', 'Action Items', 'Link zum Board'],
          es: ['Captura', 'Transcripciones y resúmenes', 'Action items', 'Enlace al tablero'],
        },
      },
    ],
  },
  {
    id: 'communication',
    labels: {
      en: 'Communication',
      hu: 'Kommunikáció',
      de: 'Kommunikation',
      es: 'Comunicación',
    },
    pages: [
      {
        slug: 'communication/channels',
        titles: {
          en: 'Channels overview',
          hu: 'Csatornák áttekintés',
          de: 'Kanäle-Übersicht',
          es: 'Resumen de canales',
        },
        descriptions: {
          en: 'How EYAS talks outside the web UI.',
          hu: 'Hogyan kommunikál az EYAS a webes UI-n kívül.',
          de: 'Wie EYAS außerhalb der Web-UI kommuniziert.',
          es: 'Cómo habla EYAS fuera de la UI web.',
        },
        bullets: {
          en: ['Channel types', 'Routing to agents', 'Pairing model', 'Inbound queue'],
          hu: ['Csatorna típusok', 'Routing ágensekhez', 'Pairing modell', 'Inbound queue'],
          de: ['Kanaltypen', 'Routing zu Agenten', 'Pairing-Modell', 'Inbound-Queue'],
          es: ['Tipos de canal', 'Enrutado a agentes', 'Modelo de pairing', 'Cola entrante'],
        },
      },
      {
        slug: 'communication/telegram',
        titles: { en: 'Telegram', hu: 'Telegram', de: 'Telegram', es: 'Telegram' },
        descriptions: {
          en: 'Connect a Telegram bot to agents.',
          hu: 'Telegram bot kötése ágensekhez.',
          de: 'Telegram-Bot mit Agenten verbinden.',
          es: 'Conectar un bot de Telegram a agentes.',
        },
        bullets: {
          en: ['Bot token', 'Pairing', 'Agent mapping', 'Limits & safety'],
          hu: ['Bot token', 'Pairing', 'Ágens mapping', 'Korlátok és biztonság'],
          de: ['Bot-Token', 'Pairing', 'Agent-Mapping', 'Limits & Sicherheit'],
          es: ['Token del bot', 'Pairing', 'Mapeo de agentes', 'Límites y seguridad'],
        },
      },
      {
        slug: 'communication/a2a',
        titles: {
          en: 'A2A & external agents',
          hu: 'A2A és külső ágensek',
          de: 'A2A & externe Agenten',
          es: 'A2A y agentes externos',
        },
        descriptions: {
          en: 'Agent-to-agent protocol and cards.',
          hu: 'Ágens–ágens protokoll és agent card.',
          de: 'Agent-zu-Agent-Protokoll und Cards.',
          es: 'Protocolo agente–agente y cards.',
        },
        bullets: {
          en: ['Agent card', 'When to use A2A', 'Trust boundaries', 'Discovery'],
          hu: ['Agent card', 'Mikor használd az A2A-t', 'Trust határok', 'Discovery'],
          de: ['Agent Card', 'Wann A2A nutzen', 'Vertrauensgrenzen', 'Discovery'],
          es: ['Agent card', 'Cuándo usar A2A', 'Límites de confianza', 'Discovery'],
        },
      },
    ],
  },
  {
    id: 'ai',
    labels: {
      en: 'AI models & prompts',
      hu: 'AI modellek és prompok',
      de: 'KI-Modelle & Prompts',
      es: 'Modelos de IA y prompts',
    },
    pages: [
      {
        slug: 'ai/providers',
        titles: {
          en: 'Providers',
          hu: 'Providerek',
          de: 'Provider',
          es: 'Proveedores',
        },
        descriptions: {
          en: 'Claude, OpenAI, Gemini, Grok, Ollama, and more.',
          hu: 'Claude, OpenAI, Gemini, Grok, Ollama és más.',
          de: 'Claude, OpenAI, Gemini, Grok, Ollama und mehr.',
          es: 'Claude, OpenAI, Gemini, Grok, Ollama y más.',
        },
        bullets: {
          en: ['Add a provider', 'API keys', 'Model catalogue', 'Local Ollama'],
          hu: ['Provider hozzáadása', 'API kulcsok', 'Modell katalógus', 'Helyi Ollama'],
          de: ['Provider hinzufügen', 'API-Schlüssel', 'Modellkatalog', 'Lokales Ollama'],
          es: ['Añadir proveedor', 'Claves API', 'Catálogo de modelos', 'Ollama local'],
        },
      },
      {
        slug: 'ai/routing-budget',
        titles: {
          en: 'Routing & budget',
          hu: 'Routing és budget',
          de: 'Routing & Budget',
          es: 'Enrutado y presupuesto',
        },
        descriptions: {
          en: 'Which model runs what, and cost controls.',
          hu: 'Melyik modell mit futtat, költségkontroll.',
          de: 'Welches Modell was ausführt, Kostenkontrolle.',
          es: 'Qué modelo ejecuta qué, y control de costes.',
        },
        bullets: {
          en: ['Model assignments', 'Fallback', 'Budgets', 'Cost visibility'],
          hu: ['Modell hozzárendelések', 'Fallback', 'Budgetek', 'Költség láthatóság'],
          de: ['Modellzuweisungen', 'Fallback', 'Budgets', 'Kostensichtbarkeit'],
          es: ['Asignaciones de modelo', 'Fallback', 'Presupuestos', 'Visibilidad de costes'],
        },
      },
      {
        slug: 'ai/prompts',
        titles: {
          en: 'Prompts system',
          hu: 'Prompt rendszer',
          de: 'Prompt-System',
          es: 'Sistema de prompts',
        },
        descriptions: {
          en: 'Master → project-type → project → conversation chain.',
          hu: 'Master → project-type → project → conversation lánc.',
          de: 'Master → Projekttyp → Projekt → Gesprächs-Kette.',
          es: 'Cadena master → tipo de proyecto → proyecto → conversación.',
        },
        bullets: {
          en: ['Inheritance chain', 'Locked sections', 'Wizard', 'Best practices'],
          hu: ['Öröklési lánc', 'Zárolt szekciók', 'Varázsló', 'Best practice'],
          de: ['Vererbungskette', 'Gesperrte Abschnitte', 'Wizard', 'Best Practices'],
          es: ['Cadena de herencia', 'Secciones bloqueadas', 'Asistente', 'Buenas prácticas'],
        },
      },
      {
        slug: 'ai/mcp',
        titles: {
          en: 'MCP servers',
          hu: 'MCP szerverek',
          de: 'MCP-Server',
          es: 'Servidores MCP',
        },
        descriptions: {
          en: 'Model Context Protocol: external tools and data.',
          hu: 'Model Context Protocol: külső toolok és adatok.',
          de: 'Model Context Protocol: externe Tools und Daten.',
          es: 'Model Context Protocol: tools y datos externos.',
        },
        bullets: {
          en: ['Add a server', 'Auth', 'Expose to agents', 'Catalog'],
          hu: ['Szerver hozzáadása', 'Auth', 'Ágenseknek adás', 'Katalógus'],
          de: ['Server hinzufügen', 'Auth', 'Für Agenten freigeben', 'Katalog'],
          es: ['Añadir servidor', 'Auth', 'Exponer a agentes', 'Catálogo'],
        },
      },
    ],
  },
  {
    id: 'admin',
    labels: {
      en: 'Administration',
      hu: 'Adminisztráció',
      de: 'Administration',
      es: 'Administración',
    },
    pages: [
      {
        slug: 'admin/users',
        titles: {
          en: 'Users & permissions',
          hu: 'Felhasználók és jogosultságok',
          de: 'Benutzer & Rechte',
          es: 'Usuarios y permisos',
        },
        descriptions: {
          en: 'Accounts, roles, CASL permissions.',
          hu: 'Fiókok, szerepek, CASL jogosultságok.',
          de: 'Konten, Rollen, CASL-Rechte.',
          es: 'Cuentas, roles, permisos CASL.',
        },
        bullets: {
          en: ['Users list', 'Roles', 'Permission model', 'API access'],
          hu: ['Felhasználó lista', 'Szerepek', 'Jogosultsági modell', 'API hozzáférés'],
          de: ['Benutzerliste', 'Rollen', 'Rechtemodell', 'API-Zugriff'],
          es: ['Lista de usuarios', 'Roles', 'Modelo de permisos', 'Acceso API'],
        },
      },
      {
        slug: 'admin/secrets',
        titles: {
          en: 'Secrets & API keys',
          hu: 'Secrettek és API kulcsok',
          de: 'Secrets & API-Schlüssel',
          es: 'Secretos y claves API',
        },
        descriptions: {
          en: 'Encrypted secrets store and machine API keys.',
          hu: 'Titkosított secret tár és gépi API kulcsok.',
          de: 'Verschlüsselter Secret-Store und Maschinen-API-Keys.',
          es: 'Almacén cifrado de secretos y claves API de máquina.',
        },
        bullets: {
          en: ['Master password', 'Scoped secrets', 'API keys for clients', 'Rotation'],
          hu: ['Master jelszó', 'Scope-olt secrettek', 'API kulcsok klienseknek', 'Rotáció'],
          de: ['Master-Passwort', 'Gescopte Secrets', 'API-Keys für Clients', 'Rotation'],
          es: ['Contraseña maestra', 'Secretos con scope', 'Claves API para clientes', 'Rotación'],
        },
      },
      {
        slug: 'admin/connections',
        titles: {
          en: 'Connections',
          hu: 'Kapcsolatok',
          de: 'Verbindungen',
          es: 'Conexiones',
        },
        descriptions: {
          en: 'External system inventory — health, secrets, agent proposals.',
          hu: 'Külső rendszerek leltára — health, secrettek, ágens javaslatok.',
          de: 'Inventar externer Systeme — Health, Secrets, Agentenvorschläge.',
          es: 'Inventario de sistemas externos — salud, secretos, propuestas de agentes.',
        },
        bullets: {
          en: ['Catalog of system types', 'Add and test connections', 'Pending agent proposals', 'Vault-bound secrets'],
          hu: ['Rendszertípus-katalógus', 'Kapcsolat létrehozás és teszt', 'Függő ágens javaslatok', 'Vault secrettek'],
          de: ['Katalog der Systemtypen', 'Verbindung anlegen und testen', 'Ausstehende Agentenvorschläge', 'Vault-Secrets'],
          es: ['Catálogo de tipos de sistema', 'Añadir y probar conexiones', 'Propuestas pendientes', 'Secretos en el vault'],
        },
      },
      {
        slug: 'admin/settings',
        titles: {
          en: 'Settings overview',
          hu: 'Beállítások áttekintés',
          de: 'Einstellungen-Übersicht',
          es: 'Resumen de ajustes',
        },
        descriptions: {
          en: 'Map of Settings groups in the UI.',
          hu: 'A Beállítások csoportok térképe a UI-ban.',
          de: 'Karte der Einstellungsgruppen in der UI.',
          es: 'Mapa de grupos de Ajustes en la UI.',
        },
        bullets: {
          en: ['General', 'AI & model', 'Modules', 'Infrastructure'],
          hu: ['Általános', 'AI és modell', 'Modulok', 'Infrastruktúra'],
          de: ['Allgemein', 'KI & Modell', 'Module', 'Infrastruktur'],
          es: ['General', 'IA y modelo', 'Módulos', 'Infraestructura'],
        },
      },
      {
        slug: 'admin/backup',
        titles: {
          en: 'Backup & restore',
          hu: 'Backup és visszaállítás',
          de: 'Backup & Wiederherstellung',
          es: 'Copia y restauración',
        },
        descriptions: {
          en: 'Create backups and restore onto a clean install.',
          hu: 'Backup készítés és visszaállítás tiszta installra.',
          de: 'Backups erstellen und auf saubere Installation zurückspielen.',
          es: 'Crear copias y restaurar en instalación limpia.',
        },
        bullets: {
          en: ['Local backup', 'Remote destinations (S3)', 'Version pinning', 'Empty-system restore'],
          hu: ['Helyi backup', 'Távoli célok (S3)', 'Verzió rögzítés', 'Üres rendszerre restore'],
          de: ['Lokales Backup', 'Remote-Ziele (S3)', 'Versions-Pinning', 'Restore auf leeres System'],
          es: ['Copia local', 'Destinos remotos (S3)', 'Fijar versión', 'Restaurar en sistema vacío'],
        },
      },
      {
        slug: 'admin/ingress',
        titles: {
          en: 'Ingress tunnel',
          hu: 'Ingress alagút',
          de: 'Ingress-Tunnel',
          es: 'Túnel Ingress',
        },
        descriptions: {
          en: 'Expose EYAS remotely through a Cloudflare tunnel.',
          hu: 'Távoli elérés Cloudflare tunnelön keresztül.',
          de: 'EYAS remote über einen Cloudflare-Tunnel erreichbar machen.',
          es: 'Exponer EYAS en remoto con un túnel de Cloudflare.',
        },
        bullets: {
          en: ['Start / stop cloudflared', 'Tunnel token', 'Optional hostname', 'Public URL when connected'],
          hu: ['cloudflared indítás / leállítás', 'Tunnel token', 'Opcionális hostname', 'Nyilvános URL csatlakozáskor'],
          de: ['cloudflared starten / stoppen', 'Tunnel-Token', 'Optionaler Hostname', 'Öffentliche URL wenn verbunden'],
          es: ['Iniciar / detener cloudflared', 'Token del túnel', 'Hostname opcional', 'URL pública al conectar'],
        },
      },
      {
        slug: 'admin/data-port',
        titles: {
          en: 'Data import & export',
          hu: 'Adatimport és -export',
          de: 'Datenimport & -export',
          es: 'Importación y exportación de datos',
        },
        descriptions: {
          en: 'Port memory, skills, and workspace rules.',
          hu: 'Memória, skillek, workspace szabályok átvitele.',
          de: 'Speicher, Skills und Workspace-Regeln portieren.',
          es: 'Portar memoria, skills y reglas de workspace.',
        },
        bullets: {
          en: ['Import wizard', 'Supported targets', 'Proposal → approve', 'Export status'],
          hu: ['Import varázsló', 'Támogatott célok', 'Proposal → approve', 'Export státusz'],
          de: ['Import-Wizard', 'Unterstützte Ziele', 'Proposal → Approve', 'Export-Status'],
          es: ['Asistente de importación', 'Destinos soportados', 'Propuesta → aprobar', 'Estado de export'],
        },
      },
      {
        slug: 'admin/security-privacy',
        titles: {
          en: 'Security & privacy',
          hu: 'Biztonság és adatvédelem',
          de: 'Sicherheit & Datenschutz',
          es: 'Seguridad y privacidad',
        },
        descriptions: {
          en: 'Security gate, audit, privacy controls.',
          hu: 'Security gate, audit, privacy kontrollok.',
          de: 'Security Gate, Audit, Privacy-Kontrollen.',
          es: 'Security gate, auditoría, controles de privacidad.',
        },
        bullets: {
          en: ['Security gate', 'Audit log', 'Privacy module', 'Security events'],
          hu: ['Security gate', 'Audit napló', 'Privacy modul', 'Security események'],
          de: ['Security Gate', 'Audit-Log', 'Privacy-Modul', 'Security-Events'],
          es: ['Security gate', 'Registro de auditoría', 'Módulo de privacidad', 'Eventos de seguridad'],
        },
      },
      {
        slug: 'admin/observability',
        titles: {
          en: 'Observability & ops',
          hu: 'Observability és ops',
          de: 'Observability & Ops',
          es: 'Observabilidad y ops',
        },
        descriptions: {
          en: 'Metrics, tracing, ops agent, extensions, hands, nodes.',
          hu: 'Metrikák, tracing, ops agent, extensionök, hands, node-ok.',
          de: 'Metriken, Tracing, Ops-Agent, Extensions, Hands, Nodes.',
          es: 'Métricas, tracing, agente ops, extensiones, hands, nodos.',
        },
        bullets: {
          en: ['Observability UI', 'Ops page', 'Hands & remote nodes', 'Ingress', 'Extensions', 'System update'],
          hu: ['Observability UI', 'Ops oldal', 'Hands és remote node-ok', 'Ingress', 'Extensionök', 'Rendszerfrissítés'],
          de: ['Observability-UI', 'Ops-Seite', 'Hands & Remote-Nodes', 'Ingress', 'Extensions', 'System-Update'],
          es: ['UI de observabilidad', 'Página ops', 'Hands y nodos remotos', 'Ingress', 'Extensiones', 'Actualización del sistema'],
        },
      },
    ],
  },
  {
    id: 'deploy',
    labels: {
      en: 'Deploy & CLI',
      hu: 'Üzemeltetés és CLI',
      de: 'Betrieb & CLI',
      es: 'Despliegue y CLI',
    },
    pages: [
      {
        slug: 'deploy/native',
        titles: {
          en: 'Native install',
          hu: 'Natív telepítés',
          de: 'Native Installation',
          es: 'Instalación nativa',
        },
        descriptions: {
          en: 'Bun/Node install, installer scripts, PATH.',
          hu: 'Bun/Node telepítés, installer scriptek, PATH.',
          de: 'Bun/Node-Installation, Installer-Skripte, PATH.',
          es: 'Instalación Bun/Node, scripts de instalador, PATH.',
        },
        bullets: {
          en: ['One-line installer', 'Manual git clone', 'bin/eyas on PATH', 'Upgrades'],
          hu: ['Egy-soros installer', 'Kézi git clone', 'bin/eyas a PATH-on', 'Frissítések'],
          de: ['Einzeiliger Installer', 'Manueller Git-Clone', 'bin/eyas im PATH', 'Upgrades'],
          es: ['Instalador de una línea', 'Clone git manual', 'bin/eyas en PATH', 'Actualizaciones'],
        },
      },
      {
        slug: 'deploy/docker',
        titles: { en: 'Docker', hu: 'Docker', de: 'Docker', es: 'Docker' },
        descriptions: {
          en: 'Compose, volumes, ports, GPU/Ollama profile.',
          hu: 'Compose, volume-ok, portok, GPU/Ollama profil.',
          de: 'Compose, Volumes, Ports, GPU/Ollama-Profil.',
          es: 'Compose, volúmenes, puertos, perfil GPU/Ollama.',
        },
        bullets: {
          en: ['docker compose up', 'Ports', 'Volumes', 'GPU profile'],
          hu: ['docker compose up', 'Portok', 'Volume-ok', 'GPU profil'],
          de: ['docker compose up', 'Ports', 'Volumes', 'GPU-Profil'],
          es: ['docker compose up', 'Puertos', 'Volúmenes', 'Perfil GPU'],
        },
      },
      {
        slug: 'deploy/kubernetes',
        titles: {
          en: 'Kubernetes',
          hu: 'Kubernetes',
          de: 'Kubernetes',
          es: 'Kubernetes',
        },
        descriptions: {
          en: 'Manifests and Helm chart under deploy/k8s.',
          hu: 'Manifestek és Helm chart a deploy/k8s alatt.',
          de: 'Manifeste und Helm-Chart unter deploy/k8s.',
          es: 'Manifiestos y chart Helm en deploy/k8s.',
        },
        bullets: {
          en: ['Prerequisites', 'Helm values', 'Persistence', 'Ingress'],
          hu: ['Előfeltételek', 'Helm values', 'Perzisztencia', 'Ingress'],
          de: ['Voraussetzungen', 'Helm Values', 'Persistenz', 'Ingress'],
          es: ['Requisitos', 'Valores Helm', 'Persistencia', 'Ingress'],
        },
      },
      {
        slug: 'deploy/multi-instance',
        titles: {
          en: 'Multiple instances',
          hu: 'Több példány',
          de: 'Mehrere Instanzen',
          es: 'Varias instancias',
        },
        descriptions: {
          en: 'Run prod + dev on one machine with EYAS_HOME / ports.',
          hu: 'Prod + dev egy gépen: EYAS_HOME / portok.',
          de: 'Prod + Dev auf einer Maschine: EYAS_HOME / Ports.',
          es: 'Prod + dev en una máquina: EYAS_HOME / puertos.',
        },
        bullets: {
          en: ['EYAS_HOME', 'Ports', 'Compose projects', 'Isolation rules'],
          hu: ['EYAS_HOME', 'Portok', 'Compose projectek', 'Izolációs szabályok'],
          de: ['EYAS_HOME', 'Ports', 'Compose-Projekte', 'Isolationsregeln'],
          es: ['EYAS_HOME', 'Puertos', 'Proyectos Compose', 'Reglas de aislamiento'],
        },
      },
      {
        slug: 'deploy/cli',
        titles: {
          en: 'CLI reference',
          hu: 'CLI referencia',
          de: 'CLI-Referenz',
          es: 'Referencia CLI',
        },
        descriptions: {
          en: 'eyas serve, start, stop, doctor, module, config.',
          hu: 'eyas serve, start, stop, doctor, module, config.',
          de: 'eyas serve, start, stop, doctor, module, config.',
          es: 'eyas serve, start, stop, doctor, module, config.',
        },
        bullets: {
          en: ['Lifecycle', 'doctor / status', 'config', 'module enable/disable', 'version'],
          hu: ['Életciklus', 'doctor / status', 'config', 'module enable/disable', 'version'],
          de: ['Lebenszyklus', 'doctor / status', 'config', 'module enable/disable', 'version'],
          es: ['Ciclo de vida', 'doctor / status', 'config', 'module enable/disable', 'version'],
        },
      },
      {
        slug: 'deploy/configuration',
        titles: {
          en: 'Configuration',
          hu: 'Konfiguráció',
          de: 'Konfiguration',
          es: 'Configuración',
        },
        descriptions: {
          en: 'YAML config, local overlays, env vars.',
          hu: 'YAML config, local overlay, env változók.',
          de: 'YAML-Config, lokale Overlays, Umgebungsvariablen.',
          es: 'Config YAML, overlays locales, variables de entorno.',
        },
        bullets: {
          en: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot reload'],
          hu: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot reload'],
          de: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot Reload'],
          es: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot reload'],
        },
      },
    ],
  },
  {
    id: 'reference',
    labels: { en: 'Reference', hu: 'Referencia', de: 'Referenz', es: 'Referencia' },
    pages: [
      {
        slug: 'reference/glossary',
        titles: { en: 'Glossary', hu: 'Szójegyzék', de: 'Glossar', es: 'Glosario' },
        descriptions: {
          en: 'Terms used across EYAS.',
          hu: 'Az EYAS-ban használt fogalmak.',
          de: 'Begriffe in EYAS.',
          es: 'Términos usados en EYAS.',
        },
        bullets: {
          en: ['Agent', 'Skill', 'Memory tiers', 'Board card', 'Channel', 'Forge'],
          hu: ['Ágens', 'Skill', 'Memória szintek', 'Tábla kártya', 'Csatorna', 'Forge'],
          de: ['Agent', 'Skill', 'Speicherebenen', 'Board-Karte', 'Kanal', 'Forge'],
          es: ['Agente', 'Skill', 'Niveles de memoria', 'Tarjeta del tablero', 'Canal', 'Forge'],
        },
      },
      {
        slug: 'reference/faq',
        titles: { en: 'FAQ', hu: 'GYIK', de: 'FAQ', es: 'FAQ' },
        descriptions: {
          en: 'Common questions and troubleshooting.',
          hu: 'Gyakori kérdések és hibaelhárítás.',
          de: 'Häufige Fragen und Fehlerbehebung.',
          es: 'Preguntas frecuentes y solución de problemas.',
        },
        bullets: {
          en: ['Port already in use', 'No UI after start', 'Provider errors', 'Where is my data'],
          hu: ['Port foglalt', 'Nincs UI indítás után', 'Provider hibák', 'Hol vannak az adataim'],
          de: ['Port belegt', 'Keine UI nach Start', 'Provider-Fehler', 'Wo liegen meine Daten'],
          es: ['Puerto en uso', 'Sin UI tras el arranque', 'Errores de proveedor', 'Dónde están mis datos'],
        },
      },
      {
        slug: 'reference/architecture',
        titles: {
          en: 'Architecture (pointer)',
          hu: 'Architektúra (mutató)',
          de: 'Architektur (Verweis)',
          es: 'Arquitectura (enlace)',
        },
        descriptions: {
          en: 'Where deep technical specs live in the repo.',
          hu: 'Hol vannak a mély technikai specek a repóban.',
          de: 'Wo tiefe technische Specs im Repo liegen.',
          es: 'Dónde viven las specs técnicas profundas en el repo.',
        },
        bullets: {
          en: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Contributor vs user docs'],
          hu: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Fejlesztői vs felhasználói docs'],
          de: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Contributor- vs User-Docs'],
          es: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Docs de contribuidor vs usuario'],
        },
      },
    ],
  },
]

const LOCALES = ['en', 'hu', 'de', 'es']

const STATUS = {
  en: 'Outline page — full prose content still to write. Structure and topics are locked.',
  hu: 'Vázlatoldal — a teljes szöveg még írandó. A struktúra és a témák rögzítve.',
  de: 'Gliederungsseite — Fließtext folgt. Struktur und Themen sind festgelegt.',
  es: 'Página de esquema — el texto completo está pendiente. Estructura y temas fijados.',
}

const LEARN = {
  en: 'This page will cover',
  hu: 'Ez az oldal ezeket fogja tárgyalni',
  de: 'Diese Seite wird abdecken',
  es: 'Esta página cubrirá',
}

const RELATED = {
  en: 'Related',
  hu: 'Kapcsolódó',
  de: 'Verwandt',
  es: 'Relacionado',
}

/** Special bodies for pages that already had real content */
const RICH = {
  en: {
    index: null, // generated default is fine; we'll enhance after
    'getting-started': null,
    'agents/voice': null,
  },
}

function yamlQuote(s) {
  return JSON.stringify(s)
}

function pageBody(locale, page, sectionLabel) {
  const title = page.titles[locale]
  const bullets = page.bullets[locale] || page.bullets.en
  const list = bullets.map((b) => `- ${b}`).join('\n')
  return `---
title: ${yamlQuote(title)}
description: ${yamlQuote(page.descriptions[locale] || page.descriptions.en)}
---

${MARKER}

${intro(locale, page, sectionLabel)}

## ${LEARN[locale]}

${list}

:::note
${STATUS[locale]}
:::
`
}

function intro(locale, page, sectionLabel) {
  const t = page.titles[locale]
  const intros = {
    en: `**${t}** is part of the *${sectionLabel}* section of the EYAS documentation.`,
    hu: `A **${t}** az EYAS dokumentáció *${sectionLabel}* szekciójába tartozik.`,
    de: `**${t}** gehört zum Abschnitt *${sectionLabel}* der EYAS-Dokumentation.`,
    es: `**${t}** forma parte de la sección *${sectionLabel}* de la documentación de EYAS.`,
  }
  return intros[locale]
}

function writePage(locale, page, sectionLabel) {
  const rel = page.slug === 'index' ? 'index.md' : `${page.slug}.md`
  const path = join(contentRoot, locale, rel)
  mkdirSync(dirname(path), { recursive: true })

  // Preserve non-skeleton content (real prose already written)
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8')
    if (!existing.includes(MARKER) && page.slug !== 'index' && page.slug !== 'getting-started' && page.slug !== 'agents/voice') {
      // unexpected non-skeleton file — skip
      console.log('skip (custom):', path)
      return
    }
    // Always regenerate skeleton-marked pages and the three pilot pages → expand skeleton for consistency
    // For voice / getting-started / index: keep richer content if not skeleton
    if (!existing.includes(MARKER) && (page.slug === 'agents/voice' || page.slug === 'getting-started' || page.slug === 'index')) {
      console.log('keep (rich pilot):', path)
      return
    }
  }

  writeFileSync(path, pageBody(locale, page, sectionLabel[locale] || sectionLabel.en))
  console.log('write', path)
}

function buildSidebarConfig() {
  // Produce JS snippet for astro.config.mjs
  const sidebar = SECTIONS.map((sec) => {
    const items = sec.pages.map((p) => {
      const slug = p.slug === 'index' ? 'index' : p.slug
      return {
        label: p.titles.en,
        translations: {
          hu: p.titles.hu,
          de: p.titles.de,
          es: p.titles.es,
        },
        slug,
      }
    })
    return {
      label: sec.labels.en,
      translations: {
        hu: sec.labels.hu,
        de: sec.labels.de,
        es: sec.labels.es,
      },
      items,
    }
  })
  return sidebar
}

// Generate pages
for (const locale of LOCALES) {
  for (const sec of SECTIONS) {
    for (const page of sec.pages) {
      writePage(locale, page, sec.labels)
    }
  }
}

// Write outline doc + sidebar JSON for astro config
const outlinePath = join(root, 'OUTLINE.md')
let outline = `# EYAS Docs outline

Source of truth for IA. Pages are generated by \`scripts/generate-skeleton.mjs\`.

| Section | Pages |
|---------|-------|
`
for (const sec of SECTIONS) {
  outline += `| **${sec.labels.en}** / ${sec.labels.hu} | ${sec.pages.map((p) => `\`${p.slug}\``).join(', ')} |\n`
}
outline += `
## Principles

1. **User journey first** — start → daily work → agents → automation → knowledge → channels → AI config → admin → deploy.
2. **Not 1:1 with every module** — group by task; deep module lists go under admin/deploy.
3. **Stable slugs** — used by \`help-map.json\` and in-app \`?\` links.
4. **Architecture specs stay in repo \`docs/\`** — docs only points there.

## Page count

${SECTIONS.reduce((n, s) => n + s.pages.length, 0)} pages × ${LOCALES.length} locales (skeleton).
`
writeFileSync(outlinePath, outline)

const sidebarPath = join(root, 'sidebar.generated.json')
writeFileSync(sidebarPath, JSON.stringify(buildSidebarConfig(), null, 2) + '\n')
console.log('wrote', outlinePath, sidebarPath)
