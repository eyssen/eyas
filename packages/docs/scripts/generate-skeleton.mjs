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
    labels: { en: 'Start', hu: 'Kezdés', de: 'Start', es: 'Inicio', fr: 'Démarrage', tlh: 'tagh' },
    pages: [
      {
        slug: 'index',
        titles: {
          en: 'Welcome',
          hu: 'Üdvözlet',
          de: 'Willkommen',
          es: 'Bienvenida',
          fr: 'Bienvenue',
          tlh: 'nuqneH',
        },
        descriptions: {
          en: 'EYAS user documentation — self-hosted personal AI.',
          hu: 'EYAS felhasználói dokumentáció — self-hosted személyes AI.',
          de: 'EYAS Dokumentation — selbst gehostete persönliche KI.',
          es: 'Manual de EYAS — IA personal autoalojada.',
          fr: 'Documentation utilisateur EYAS — IA personnelle auto-hébergée.',
          tlh: 'EYAS lo\'wI\' ghItlh — juHDaq Qapbogh SoH AI.',
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
          fr: [
            'Ce qu’est EYAS (et ce qu’il n’est pas)',
            'À qui s’adresse cette documentation',
            'Comment la documentation est organisée',
            'Langues et aide dans l’application',
          ],
          tlh: [
            'EYAS nuq (\'ej nuqbe\')',
            '\'IvvaD ghItlhlIj',
            'ghItlh SeH mIw',
            'Holmey \'ej UI QaH',
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
          fr: 'Premiers pas',
          tlh: 'wa\'DIch mIwmey',
        },
        descriptions: {
          en: 'Install, first run, and open the UI.',
          hu: 'Telepítés, első indítás, UI megnyitása.',
          de: 'Installation, erster Start und UI öffnen.',
          es: 'Instalación, primer arranque y abrir la UI.',
          fr: 'Installation, premier démarrage et ouverture de l’interface.',
          tlh: 'lIng, wa\'DIch tagh, \'ej UI poSmoH.',
        },
        bullets: {
          en: ['Prerequisites', 'Native install', 'Docker', 'Lifecycle commands', 'Open the UI'],
          hu: ['Előfeltételek', 'Natív telepítés', 'Docker', 'Életciklus-parancsok', 'UI megnyitása'],
          de: ['Voraussetzungen', 'Native Installation', 'Docker', 'Lebenszyklus-Befehle', 'UI öffnen'],
          es: ['Requisitos', 'Instalación nativa', 'Docker', 'Comandos de ciclo de vida', 'Abrir la UI'],
          fr: ['Prérequis', 'Installation native', 'Docker', 'Commandes de cycle de vie', 'Ouvrir l’interface'],
          tlh: ['poQlu\'bogh', 'native lIng', 'Docker', 'yIn He ra\'mey', 'UI poSmoH'],
        },
      },
      {
        slug: 'setup-wizard',
        titles: {
          en: 'Setup wizard',
          hu: 'Setup varázsló',
          de: 'Setup-Assistent',
          es: 'Asistente de configuración',
          fr: 'Assistant de configuration',
          tlh: 'tagh SeHwI\'',
        },
        descriptions: {
          en: 'First-boot wizard: admin, providers, seed agents.',
          hu: 'Első indítás: admin, providerek, seed ágensek.',
          de: 'Erster Start: Admin, Provider, Seed-Agenten.',
          es: 'Primer arranque: admin, proveedores, agentes semilla.',
          fr: 'Assistant de premier démarrage : administrateur, fournisseurs, agents semence.',
          tlh: 'wa\'DIch tagh SeHwI\': lo\'wI\' SeHwI\', nobwI\'pu\', mo\' ghoqwI\'pu\'.',
        },
        bullets: {
          en: ['Language & appearance', 'Admin account', 'AI provider keys', 'Naming your agents', 'Optional specialists'],
          hu: ['Nyelv és megjelenés', 'Admin fiók', 'AI provider kulcsok', 'Ágensek elnevezése', 'Opcionális specialisták'],
          de: ['Sprache & Erscheinungsbild', 'Admin-Konto', 'KI-Provider-Schlüssel', 'Agenten benennen', 'Optionale Spezialisten'],
          es: ['Idioma y apariencia', 'Cuenta de admin', 'Claves de proveedor de IA', 'Nombrar agentes', 'Especialistas opcionales'],
          fr: ['Langue et apparence', 'Compte administrateur', 'Clés de fournisseur d’IA', 'Nommer vos agents', 'Spécialistes facultatifs'],
          tlh: ['Hol qal\'aq je', 'lo\'wI\' SeHwI\' mIw', 'AI nobwI\' ngaQmey', 'ghoqwI\'pu\' pong', 'poQbe\' tejwI\'pu\''],
        },
      },
      {
        slug: 'concepts',
        titles: {
          en: 'Core concepts',
          hu: 'Alapfogalmak',
          de: 'Grundkonzepte',
          es: 'Conceptos básicos',
          fr: 'Concepts de base',
          tlh: 'potlh qechmey',
        },
        descriptions: {
          en: 'Mental model: agents, conversations, board, memory, skills.',
          hu: 'Mentális modell: ágensek, beszélgetések, tábla, memória, skillek.',
          de: 'Mentales Modell: Agenten, Gespräche, Board, Speicher, Skills.',
          es: 'Modelo mental: agentes, conversaciones, tablero, memoria, skills.',
          fr: 'Modèle mental : agents, conversations, tableau, mémoire, compétences.',
          tlh: 'Qub pat: ghoqwI\'pu\', ja\'chuqmey, Qu\' nav, qawHaq, laHmey.',
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
          fr: [
            'Agent vs conversation vs tâche',
            'Tableau et projets',
            'Mémoire à cinq niveaux + coffre',
            'Compétences et outils',
            'Canaux (UI, Telegram, …)',
          ],
          tlh: [
            'ghoqwI\' ja\'chuq Qu\' je',
            'Qu\' nav Qu\'mey je',
            'vagh pat qawHaq + vault',
            'laHmey janmey je',
            'Hemey (UI, Telegram, …)',
          ],
        },
      },
    ],
  },
  {
    id: 'daily',
    labels: { en: 'Daily work', hu: 'Napi munka', de: 'Tägliche Arbeit', es: 'Trabajo diario', fr: 'Travail quotidien', tlh: 'jaj vum' },
    pages: [
      {
        slug: 'daily/dashboard',
        titles: { en: 'Dashboard', hu: 'Irányítópult', de: 'Dashboard', es: 'Panel', fr: 'Tableau de bord', tlh: 'jIH Daq' },
        descriptions: {
          en: 'Home view: status, nudges, setup tips.',
          hu: 'Kezdőnézet: státusz, nudge-ok, setup tippek.',
          de: 'Startansicht: Status, Hinweise, Setup-Tipps.',
          es: 'Vista de inicio: estado, avisos, consejos de setup.',
          fr: 'Vue d’accueil : état, suggestions, conseils de configuration.',
          tlh: 'tagh jIH: Dotlh, ghuHmey, lIng chupmey.',
        },
        bullets: {
          en: ['Status overview', 'Autonomy nudges', 'Setup recommendations', 'Jump into work'],
          hu: ['Státusz áttekintés', 'Autonómia nudge-ok', 'Setup ajánlások', 'Gyors belépés a munkába'],
          de: ['Statusübersicht', 'Autonomie-Hinweise', 'Setup-Empfehlungen', 'Schnell in die Arbeit'],
          es: ['Resumen de estado', 'Avisos de autonomía', 'Recomendaciones de setup', 'Entrar al trabajo'],
          fr: ['Aperçu de l’état', 'Suggestions d’autonomie', 'Recommandations de configuration', 'Passer au travail'],
          tlh: ['Dotlh jIH', 'SeH\'egh ghuHmey', 'lIng chupmey', 'Qu\'Daq jaH'],
        },
      },
      {
        slug: 'daily/conversations',
        titles: {
          en: 'Conversations',
          hu: 'Beszélgetések',
          de: 'Gespräche',
          es: 'Conversaciones',
          fr: 'Conversations',
          tlh: 'ja\'chuqmey',
        },
        descriptions: {
          en: 'Chat with agents: streaming, tools, context rail.',
          hu: 'Chat ágensekkel: streaming, toolok, context rail.',
          de: 'Chat mit Agenten: Streaming, Tools, Context Rail.',
          es: 'Chat con agentes: streaming, tools, context rail.',
          fr: 'Discussion avec les agents : flux, outils, rail de contexte.',
          tlh: 'ghoqwI\'pu\' ja\': stream, janmey, De\' He.',
        },
        bullets: {
          en: ['Start a conversation', 'Messages & streaming', 'Tool calls', 'Context / chatter rail', 'Team sessions'],
          hu: ['Beszélgetés indítása', 'Üzenetek és streaming', 'Tool hívások', 'Context / chatter sáv', 'Team sessionök'],
          de: ['Gespräch starten', 'Nachrichten & Streaming', 'Tool-Aufrufe', 'Context-/Chatter-Leiste', 'Team-Sessions'],
          es: ['Iniciar conversación', 'Mensajes y streaming', 'Llamadas a tools', 'Barra de contexto', 'Sesiones de equipo'],
          fr: ['Démarrer une conversation', 'Messages et flux', 'Appels d’outils', 'Rail de contexte / chatter', 'Sessions d’équipe'],
          tlh: ['ja\'chuq tagh', 'QInmey stream je', 'jan tlhobmey', 'De\' / chatter He', 'ghom poHmey'],
        },
      },
      {
        slug: 'daily/board',
        titles: { en: 'Board', hu: 'Tábla', de: 'Board', es: 'Tablero', fr: 'Tableau', tlh: 'Qu\' nav' },
        descriptions: {
          en: 'Kanban, list, timeline, and graph views for work.',
          hu: 'Kanban, lista, idővonal és graph nézetek.',
          de: 'Kanban-, Listen-, Timeline- und Graph-Ansichten.',
          es: 'Vistas kanban, lista, línea de tiempo y grafo.',
          fr: 'Vues kanban, liste, chronologie et graphe.',
          tlh: 'kanban, tetlh, poH tlhegh, graph jIHmey.',
        },
        bullets: {
          en: ['Cards & columns', 'Views (kanban / list / timeline / graph)', 'Filters & pins', 'Linking to conversations'],
          hu: ['Kártyák és oszlopok', 'Nézetek (kanban / lista / timeline / graph)', 'Szűrők és pinek', 'Kapcsolat beszélgetésekhez'],
          de: ['Karten & Spalten', 'Ansichten (Kanban / Liste / Timeline / Graph)', 'Filter & Pins', 'Verknüpfung mit Gesprächen'],
          es: ['Tarjetas y columnas', 'Vistas (kanban / lista / timeline / grafo)', 'Filtros y pines', 'Enlace a conversaciones'],
          fr: ['Cartes et colonnes', 'Vues (kanban / liste / chronologie / graphe)', 'Filtres et épingles', 'Lien vers les conversations'],
          tlh: ['chaw\'mey tlheghmey je', 'jIHmey (kanban / tetlh / poH tlhegh / graph)', 'nej Qan je', 'ja\'chuqmey rar'],
        },
      },
      {
        slug: 'daily/projects',
        titles: { en: 'Projects', hu: 'Projektek', de: 'Projekte', es: 'Proyectos', fr: 'Projets', tlh: 'Qu\'mey' },
        descriptions: {
          en: 'Project types, stages, and work organisation.',
          hu: 'Projekt típusok, stage-ek, munka szervezése.',
          de: 'Projekttypen, Stages und Arbeitsorganisation.',
          es: 'Tipos de proyecto, etapas y organización del trabajo.',
          fr: 'Types de projet, étapes et organisation du travail.',
          tlh: 'Qu\' Seghmey, mIwmey, \'ej Qu\' SeH.',
        },
        bullets: {
          en: ['Project types', 'Stages', 'Conversation tracking', 'Templates'],
          hu: ['Projekt típusok', 'Stage-ek', 'Beszélgetés-követés', 'Sablonok'],
          de: ['Projekttypen', 'Stages', 'Gesprächsverfolgung', 'Vorlagen'],
          es: ['Tipos de proyecto', 'Etapas', 'Seguimiento de conversaciones', 'Plantillas'],
          fr: ['Types de projet', 'Étapes', 'Suivi des conversations', 'Modèles'],
          tlh: ['Qu\' Seghmey', 'mIwmey', 'ja\'chuq tlha\'', 'chovnatlhmey'],
        },
      },
      {
        slug: 'daily/search',
        titles: { en: 'Search', hu: 'Keresés', de: 'Suche', es: 'Búsqueda', fr: 'Recherche', tlh: 'nej' },
        descriptions: {
          en: 'Unified search across memory, board, docs, and sources.',
          hu: 'Egyesített keresés memóriában, táblán, doksikban, forrásokban.',
          de: 'Einheitliche Suche in Speicher, Board, Docs und Quellen.',
          es: 'Búsqueda unificada en memoria, tablero, docs y fuentes.',
          fr: 'Recherche unifiée dans la mémoire, le tableau, les documents et les sources.',
          tlh: 'wa\' nej — qawHaq, Qu\' nav, ghItlhmey, Halmey.',
        },
        bullets: {
          en: ['Query tips', 'Result types', 'Search sources', 'Filters'],
          hu: ['Lekérdezési tippek', 'Találat-típusok', 'Keresési források', 'Szűrők'],
          de: ['Abfrage-Tipps', 'Ergebnistypen', 'Suchquellen', 'Filter'],
          es: ['Consejos de consulta', 'Tipos de resultado', 'Fuentes de búsqueda', 'Filtros'],
          fr: ['Conseils de requête', 'Types de résultat', 'Sources de recherche', 'Filtres'],
          tlh: ['nej chupmey', 'Sam Seghmey', 'nej Halmey', 'nejwI\'mey'],
        },
      },
    ],
  },
  {
    id: 'agents',
    labels: { en: 'Agents', hu: 'Ágensek', de: 'Agenten', es: 'Agentes', fr: 'Agents', tlh: 'ghoqwI\'pu\'' },
    pages: [
      {
        slug: 'agents/overview',
        titles: {
          en: 'Agents overview',
          hu: 'Ágensek áttekintés',
          de: 'Agenten-Übersicht',
          es: 'Resumen de agentes',
          fr: 'Vue d’ensemble des agents',
          tlh: 'ghoqwI\'pu\' jIH',
        },
        descriptions: {
          en: 'Personas that act: seed agents, specialists, lifecycle.',
          hu: 'Cselekvő personák: seed ágensek, specialisták, életciklus.',
          de: 'Handelnde Personas: Seed-Agenten, Spezialisten, Lebenszyklus.',
          es: 'Personas que actúan: agentes semilla, especialistas, ciclo de vida.',
          fr: 'Personas qui agissent : agents semence, spécialistes, cycle de vie.',
          tlh: 'ta\'bogh nuvpu\': mo\' ghoqwI\'pu\', tejwI\'pu\', yIn He.',
        },
        bullets: {
          en: ['Primary teammates', 'Specialists', 'List & detail UI', 'When to add a new agent'],
          hu: ['Elsődleges társak', 'Specialisták', 'Lista és részletek UI', 'Mikor érdemes új ágenst felvenni'],
          de: ['Primäre Teamkollegen', 'Spezialisten', 'Listen- & Detail-UI', 'Wann einen neuen Agenten anlegen'],
          es: ['Compañeros principales', 'Especialistas', 'UI de lista y detalle', 'Cuándo añadir un agente'],
          fr: ['Collègues principaux', 'Spécialistes', 'Interface liste et détail', 'Quand ajouter un nouvel agent'],
          tlh: ['potlh juppu\'', 'tejwI\'pu\'', 'tetlh De\' UI', 'ghoqwI\' chu\'meH poH'],
        },
      },
      {
        slug: 'agents/configure',
        titles: {
          en: 'Create & configure',
          hu: 'Létrehozás és beállítás',
          de: 'Erstellen & konfigurieren',
          es: 'Crear y configurar',
          fr: 'Créer et configurer',
          tlh: 'chu\' \'ej choH',
        },
        descriptions: {
          en: 'Agent settings, model assignment, budgets, channels.',
          hu: 'Ágens beállítások, modell, budget, csatornák.',
          de: 'Agenteneinstellungen, Modell, Budget, Kanäle.',
          es: 'Ajustes del agente, modelo, presupuesto, canales.',
          fr: 'Paramètres de l’agent, modèle, budgets, canaux.',
          tlh: 'ghoqwI\' SeHmey, pat, Huch mebmey, Hemey.',
        },
        bullets: {
          en: ['Create from template', 'Model & budget', 'Channels', 'Permissions & tools'],
          hu: ['Létrehozás sablonból', 'Modell és budget', 'Csatornák', 'Jogosultságok és toolok'],
          de: ['Aus Vorlage erstellen', 'Modell & Budget', 'Kanäle', 'Rechte & Tools'],
          es: ['Crear desde plantilla', 'Modelo y presupuesto', 'Canales', 'Permisos y tools'],
          fr: ['Créer depuis un modèle', 'Modèle et budget', 'Canaux', 'Permissions et outils'],
          tlh: ['chovnatlhvo\' chu\'', 'pat Huch meb je', 'Hemey', 'chaw\'mey janmey je'],
        },
      },
      {
        slug: 'agents/identity-workspace',
        titles: {
          en: 'Identity & workspace',
          hu: 'Identitás és workspace',
          de: 'Identität & Workspace',
          es: 'Identidad y workspace',
          fr: 'Identité et espace de travail',
          tlh: 'pong workspace je',
        },
        descriptions: {
          en: 'IDENTITY, SOUL, and workspace files that shape behaviour.',
          hu: 'IDENTITY, SOUL és workspace fájlok, amik a viselkedést alakítják.',
          de: 'IDENTITY, SOUL und Workspace-Dateien, die Verhalten prägen.',
          es: 'IDENTITY, SOUL y archivos de workspace que definen el comportamiento.',
          fr: 'IDENTITY, SOUL et fichiers d’espace de travail qui façonnent le comportement.',
          tlh: 'IDENTITY, SOUL, workspace ghItlhmey — tIgh choH.',
        },
        bullets: {
          en: ['IDENTITY.md', 'SOUL / voice link', 'Workspace files', 'History & proposals'],
          hu: ['IDENTITY.md', 'SOUL / hang kapcsolat', 'Workspace fájlok', 'Előzmények és javaslatok'],
          de: ['IDENTITY.md', 'SOUL / Stimme', 'Workspace-Dateien', 'Historie & Vorschläge'],
          es: ['IDENTITY.md', 'SOUL / voz', 'Archivos de workspace', 'Historial y propuestas'],
          fr: ['IDENTITY.md', 'SOUL / lien vocal', 'Fichiers d’espace de travail', 'Historique et propositions'],
          tlh: ['IDENTITY.md', 'SOUL / wab rar', 'workspace ghItlhmey', 'qun chupmey je'],
        },
      },
      {
        slug: 'agents/voice',
        titles: {
          en: 'Voice profiles',
          hu: 'Hangprofilok',
          de: 'Stimmprofile',
          es: 'Perfiles de voz',
          fr: 'Profils de voix',
          tlh: 'wab patmey',
        },
        descriptions: {
          en: 'Internal/external voice, six dimensions, presets.',
          hu: 'Belső/külső hang, hat dimenzió, presetek.',
          de: 'Interne/externe Stimme, sechs Dimensionen, Presets.',
          es: 'Voz interna/externa, seis dimensiones, presets.',
          fr: 'Voix interne/externe, six dimensions, préréglages.',
          tlh: 'qoD/Hur wab, jav patmey, motlh wIv.',
        },
        bullets: {
          en: ['Internal vs external', 'Six dimensions', 'Presets', 'Overrides'],
          hu: ['Belső vs külső', 'Hat dimenzió', 'Presetek', 'Felülírások'],
          de: ['Intern vs extern', 'Sechs Dimensionen', 'Presets', 'Überschreibungen'],
          es: ['Interna vs externa', 'Seis dimensiones', 'Presets', 'Sobrescrituras'],
          fr: ['Interne vs externe', 'Six dimensions', 'Préréglages', 'Remplacements'],
          tlh: ['qoD Hur je', 'jav patmey', 'motlh wIv', 'choHqa\'mey'],
        },
      },
      {
        slug: 'agents/teams',
        titles: {
          en: 'Teams & delegation',
          hu: 'Csapatok és delegálás',
          de: 'Teams & Delegation',
          es: 'Equipos y delegación',
          fr: 'Équipes et délégation',
          tlh: 'ghommey nobHa\'ghach je',
        },
        descriptions: {
          en: 'Multi-agent collaboration, handoffs, team sessions.',
          hu: 'Többágenses együttműködés, handoffok, team sessionök.',
          de: 'Multi-Agent-Zusammenarbeit, Handoffs, Team-Sessions.',
          es: 'Colaboración multiagente, handoffs, sesiones de equipo.',
          fr: 'Collaboration multi-agents, passations, sessions d’équipe.',
          tlh: 'ghoqwI\' law\' Qapchuq, nobHa\'ghachmey, ghom poHmey.',
        },
        bullets: {
          en: ['Team configuration', 'Delegation patterns', 'Handoffs & artifacts', 'Team sessions UI'],
          hu: ['Team konfiguráció', 'Delegálási minták', 'Handoffok és artifactok', 'Team session UI'],
          de: ['Team-Konfiguration', 'Delegationsmuster', 'Handoffs & Artefakte', 'Team-Session-UI'],
          es: ['Configuración de equipo', 'Patrones de delegación', 'Handoffs y artefactos', 'UI de sesiones'],
          fr: ['Configuration d’équipe', 'Modèles de délégation', 'Passations et artefacts', 'Interface des sessions'],
          tlh: ['ghom SeH', 'nobHa\'ghach mIwmey', 'nobHa\'ghachmey chenmoHlu\'bogh je', 'poHmey UI'],
        },
      },
      {
        slug: 'agents/runs',
        titles: {
          en: 'Runs & Mission Control',
          hu: 'Futtatások és Mission Control',
          de: 'Läufe & Mission Control',
          es: 'Ejecuciones y Mission Control',
          fr: 'Exécutions et Mission Control',
          tlh: 'QapmeH Qu\'mey Mission Control je',
        },
        descriptions: {
          en: 'Observe live and past agent runs.',
          hu: 'Élő és múltbeli ágens futtatások követése.',
          de: 'Live- und vergangene Agentenläufe beobachten.',
          es: 'Observar ejecuciones de agentes en vivo y pasadas.',
          fr: 'Observer les exécutions d’agents en direct et passées.',
          tlh: 'DaH qen ghoqwI\' QapmeH Qu\'mey bej.',
        },
        bullets: {
          en: ['Agent runs list', 'Run tree & progress', 'Mission Control cards', 'Stop / resume'],
          hu: ['Agent runs lista', 'Run tree és progress', 'Mission Control kártyák', 'Stop / resume'],
          de: ['Agent-Runs-Liste', 'Run-Tree & Fortschritt', 'Mission-Control-Karten', 'Stop / Resume'],
          es: ['Lista de ejecuciones', 'Árbol de run y progreso', 'Tarjetas de Mission Control', 'Stop / resume'],
          fr: ['Liste des exécutions', 'Arbre d’exécution et progression', 'Cartes Mission Control', 'Arrêter / reprendre'],
          tlh: ['QapmeH Qu\' tetlh', 'QapmeH Sor veb je', 'Mission Control chaw\'mey', 'mev / taghqa\''],
        },
      },
      {
        slug: 'agents/forge',
        titles: { en: 'Forge', hu: 'Forge', de: 'Forge', es: 'Forge', fr: 'Forge', tlh: 'Forge' },
        descriptions: {
          en: 'Evolve agent soul and identity with proposals.',
          hu: 'Ágens soul/identity fejlesztése javaslatokkal.',
          de: 'Soul/Identity mit Vorschlägen weiterentwickeln.',
          es: 'Evolucionar soul/identidad con propuestas.',
          fr: 'Faire évoluer l’âme et l’identité de l’agent avec des propositions.',
          tlh: 'ghoqwI\' SOUL/IDENTITY choH chupmey lo\'.',
        },
        bullets: {
          en: ['What Forge does', 'Soul proposals', 'Review & apply', 'Safety'],
          hu: ['Mit csinál a Forge', 'Soul javaslatok', 'Review és alkalmazás', 'Biztonság'],
          de: ['Was Forge tut', 'Soul-Vorschläge', 'Prüfen & anwenden', 'Sicherheit'],
          es: ['Qué hace Forge', 'Propuestas de soul', 'Revisar y aplicar', 'Seguridad'],
          fr: ['Ce que fait Forge', 'Propositions d’âme', 'Examiner et appliquer', 'Sécurité'],
          tlh: ['Forge nuq ta\'', 'SOUL chupmey', 'chov \'ej lIng', 'Hub'],
        },
      },
      {
        slug: 'agents/autonomy',
        titles: { en: 'Autonomy', hu: 'Autonómia', de: 'Autonomie', es: 'Autonomía', fr: 'Autonomie', tlh: 'SeH\'egh' },
        descriptions: {
          en: 'How much agents may do without asking.',
          hu: 'Mennyit tehetnek az ágensek megkérdezés nélkül.',
          de: 'Wie viel Agenten ohne Rückfrage tun dürfen.',
          es: 'Cuánto pueden hacer los agentes sin preguntar.',
          fr: 'Jusqu’où les agents peuvent agir sans demander.',
          tlh: 'tlhobbe\' ghoqwI\'pu\' ta\'laHchugh \'ar.',
        },
        bullets: {
          en: ['Autonomy levels', 'Approval tiers', 'Feature flags', 'Dashboards'],
          hu: ['Autonómia szintek', 'Approval tier-ek', 'Feature flagek', 'Dashboardok'],
          de: ['Autonomiestufen', 'Approval-Tiers', 'Feature-Flags', 'Dashboards'],
          es: ['Niveles de autonomía', 'Tiers de aprobación', 'Feature flags', 'Paneles'],
          fr: ['Niveaux d’autonomie', 'Niveaux d’approbation', 'Indicateurs de fonctionnalité', 'Tableaux de bord'],
          tlh: ['SeH\'egh patmey', 'chaw\' patmey', 'laH per', 'jIH Daqmey'],
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
      fr: 'Compétences et automatisation',
      tlh: 'laHmey QapchoH\'egh je',
    },
    pages: [
      {
        slug: 'automation/skills',
        titles: { en: 'Skills', hu: 'Skillek', de: 'Skills', es: 'Skills', fr: 'Compétences', tlh: 'laHmey' },
        descriptions: {
          en: 'Reusable skill packs agents can load.',
          hu: 'Újrahasználható skill csomagok az ágenseknek.',
          de: 'Wiederverwendbare Skill-Pakete für Agenten.',
          es: 'Paquetes de skills reutilizables para agentes.',
          fr: 'Paquets de compétences réutilisables que les agents peuvent charger.',
          tlh: 'qa\'laH laH pa\'mey ghoqwI\'pu\' qenglaH.',
        },
        bullets: {
          en: ['Builtin vs user vs own', 'Browse & enable', 'Writing a skill', 'Import'],
          hu: ['Builtin vs user vs own', 'Böngészés és engedélyezés', 'Saját skill írása', 'Import'],
          de: ['Builtin vs user vs own', 'Durchsuchen & aktivieren', 'Eigenen Skill schreiben', 'Import'],
          es: ['Builtin vs user vs own', 'Explorar y activar', 'Escribir un skill', 'Importar'],
          fr: ['Builtin vs user vs own', 'Parcourir et activer', 'Écrire une compétence', 'Importer'],
          tlh: ['builtin user own je', 'nej \'ej chu\'', 'laH ghItlh', 'chel'],
        },
      },
      {
        slug: 'automation/tools',
        titles: { en: 'Tools', hu: 'Toolok', de: 'Tools', es: 'Tools', fr: 'Outils', tlh: 'janmey' },
        descriptions: {
          en: 'Built-in and extension tools agents call.',
          hu: 'Beépített és extension toolok, amiket az ágens hív.',
          de: 'Eingebaute und Extension-Tools, die Agenten aufrufen.',
          es: 'Tools integrados y de extensión que llaman los agentes.',
          fr: 'Outils intégrés et d’extension que les agents appellent.',
          tlh: 'motlh cheltaHghach janmey ghoqwI\'pu\' tlhob.',
        },
        bullets: {
          en: ['Tool catalogue', 'Permissions', 'Sandboxing', 'MCP-backed tools'],
          hu: ['Tool katalógus', 'Jogosultságok', 'Sandbox', 'MCP-alapú toolok'],
          de: ['Tool-Katalog', 'Rechte', 'Sandboxing', 'MCP-basierte Tools'],
          es: ['Catálogo de tools', 'Permisos', 'Sandbox', 'Tools vía MCP'],
          fr: ['Catalogue d’outils', 'Permissions', 'Isolation', 'Outils via MCP'],
          tlh: ['jan tetlh', 'chaw\'mey', 'Sandbox', 'MCP janmey'],
        },
      },
      {
        slug: 'automation/scheduler',
        titles: { en: 'Scheduler', hu: 'Ütemező', de: 'Scheduler', es: 'Programador', fr: 'Planificateur', tlh: 'poH SeHwI\'' },
        descriptions: {
          en: 'Cron jobs, calendars, and recurring agent work.',
          hu: 'Cron jobok, naptár, ismétlődő ágens feladatok.',
          de: 'Cron-Jobs, Kalender und wiederkehrende Agentenarbeit.',
          es: 'Jobs cron, calendario y trabajo recurrente de agentes.',
          fr: 'Tâches cron, calendriers et travail d’agent récurrent.',
          tlh: 'cron Qu\'mey, HovpoH, \'ej qa\'bogh ghoqwI\' Qu\'.',
        },
        bullets: {
          en: ['Jobs list', 'Calendar & timeline', 'Agent-backed jobs', 'Dead letters'],
          hu: ['Job lista', 'Naptár és timeline', 'Ágenses jobok', 'Dead letter'],
          de: ['Job-Liste', 'Kalender & Timeline', 'Agenten-Jobs', 'Dead Letters'],
          es: ['Lista de jobs', 'Calendario y timeline', 'Jobs con agente', 'Dead letters'],
          fr: ['Liste des tâches', 'Calendrier et chronologie', 'Tâches portées par un agent', 'Dead letters'],
          tlh: ['Qu\' tetlh', 'HovpoH poH tlhegh je', 'ghoqwI\' Qu\'mey', 'Hegh QInmey'],
        },
      },
      {
        slug: 'automation/pipelines',
        titles: { en: 'Pipelines', hu: 'Pipeline-ok', de: 'Pipelines', es: 'Pipelines', fr: 'Pipelines', tlh: 'Pipelines' },
        descriptions: {
          en: 'Multi-step flows such as ticket-to-code.',
          hu: 'Többlépéses folyamatok, pl. ticket-to-code.',
          de: 'Mehrstufige Flows, z. B. Ticket-to-Code.',
          es: 'Flujos de varios pasos, p. ej. ticket-to-code.',
          fr: 'Flux en plusieurs étapes tels que ticket-to-code.',
          tlh: 'mIw law\' Hemey, ticket-to-code rur.',
        },
        bullets: {
          en: ['Pipeline list', 'Ticket-to-code', 'Run history', 'Inputs & gates'],
          hu: ['Pipeline lista', 'Ticket-to-code', 'Futtatás előzmények', 'Inputok és gate-ek'],
          de: ['Pipeline-Liste', 'Ticket-to-Code', 'Laufhistorie', 'Inputs & Gates'],
          es: ['Lista de pipelines', 'Ticket-to-code', 'Historial de runs', 'Entradas y gates'],
          fr: ['Liste des pipelines', 'Ticket-to-code', 'Historique d’exécution', 'Entrées et portes'],
          tlh: ['Pipeline tetlh', 'Ticket-to-code', 'QapmeH qun', 'yI\'el lojmItmey je'],
        },
      },
      {
        slug: 'automation/research',
        titles: { en: 'Research', hu: 'Kutatás', de: 'Research', es: 'Investigación', fr: 'Recherche', tlh: 'tej' },
        descriptions: {
          en: 'Deep research workflows and reports.',
          hu: 'Mély kutatási workflow-k és jelentések.',
          de: 'Tiefen-Research-Workflows und Berichte.',
          es: 'Flujos de investigación profunda e informes.',
          fr: 'Flux de recherche approfondie et rapports.',
          tlh: 'nI\' tej Hemey \'ej De\' ghItlhmey.',
        },
        bullets: {
          en: ['Start a research job', 'Sources', 'Reports', 'Feeding results into memory'],
          hu: ['Kutatás indítása', 'Források', 'Jelentések', 'Eredmények a memóriába'],
          de: ['Research starten', 'Quellen', 'Berichte', 'Ergebnisse in den Speicher'],
          es: ['Iniciar investigación', 'Fuentes', 'Informes', 'Resultados a la memoria'],
          fr: ['Démarrer une recherche', 'Sources', 'Rapports', 'Alimenter la mémoire avec les résultats'],
          tlh: ['tej tagh', 'Halmey', 'De\' ghItlhmey', 'qawHaqDaq Sam'],
        },
      },
      {
        slug: 'automation/proactive',
        titles: {
          en: 'Proactive assistant',
          hu: 'Proaktív asszisztens',
          de: 'Proaktiver Assistent',
          es: 'Asistente proactivo',
          fr: 'Assistant proactif',
          tlh: 'tlha\'bogh QaHwI\'',
        },
        descriptions: {
          en: 'Heartbeat checks, suggestions, unsolicited help.',
          hu: 'Heartbeat ellenőrzések, javaslatok, felajánlott segítség.',
          de: 'Heartbeat-Checks, Vorschläge, unaufgeforderte Hilfe.',
          es: 'Comprobaciones heartbeat, sugerencias, ayuda proactiva.',
          fr: 'Contrôles heartbeat, suggestions, aide non sollicitée.',
          tlh: 'tIq chovmey, chupmey, tlhobbe\' QaH.',
        },
        bullets: {
          en: ['Enable proactive mode', 'Nudge types', 'Quiet hours', 'Safety bounds'],
          hu: ['Proaktív mód bekapcsolása', 'Nudge típusok', 'Csendes órák', 'Biztonsági határok'],
          de: ['Proaktiven Modus aktivieren', 'Nudge-Typen', 'Ruhezeiten', 'Sicherheitsgrenzen'],
          es: ['Activar modo proactivo', 'Tipos de aviso', 'Horas quietas', 'Límites de seguridad'],
          fr: ['Activer le mode proactif', 'Types de suggestion', 'Heures calmes', 'Limites de sécurité'],
          tlh: ['tlha\'bogh mIw chu\'', 'ghuH Seghmey', 'tam poHmey', 'Hub mebmey'],
        },
      },
      {
        slug: 'automation/self-learning',
        titles: {
          en: 'Self-learning & skill evolution',
          hu: 'Öntanulás és skill evolution',
          de: 'Selbstlernen & Skill-Evolution',
          es: 'Autoaprendizaje y evolución de skills',
          fr: 'Auto-apprentissage et évolution des compétences',
          tlh: 'ghoj\'egh laH choH je',
        },
        descriptions: {
          en: 'Insights from use; evolving skills over time.',
          hu: 'Használatból tanulás; skillek fejlődése idővel.',
          de: 'Lernen aus Nutzung; Skills entwickeln sich.',
          es: 'Aprender del uso; skills que evolucionan.',
          fr: 'Enseignements tirés de l’usage ; compétences qui évoluent.',
          tlh: 'lo\'vo\' ghoj; poHDaq choHtaHbogh laHmey.',
        },
        bullets: {
          en: ['Insights dashboard', 'Skill evolution', 'Review before apply', 'Privacy'],
          hu: ['Insights dashboard', 'Skill evolution', 'Review alkalmazás előtt', 'Adatvédelem'],
          de: ['Insights-Dashboard', 'Skill-Evolution', 'Prüfen vor Apply', 'Datenschutz'],
          es: ['Panel de insights', 'Evolución de skills', 'Revisar antes de aplicar', 'Privacidad'],
          fr: ['Tableau des enseignements', 'Évolution des compétences', 'Examiner avant d’appliquer', 'Confidentialité'],
          tlh: ['Sov jIH Daq', 'laH choH', 'lIngpa\' chov', 'pegh'],
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
      fr: 'Connaissances et mémoire',
      tlh: 'Sov qawHaq je',
    },
    pages: [
      {
        slug: 'knowledge/memory',
        titles: { en: 'Memory', hu: 'Memória', de: 'Speicher', es: 'Memoria', fr: 'Mémoire', tlh: 'qawHaq' },
        descriptions: {
          en: 'Five tiers: working, episodic, semantic, procedural, archive.',
          hu: 'Öt szint: working, episodic, semantic, procedural, archive.',
          de: 'Fünf Ebenen: working, episodic, semantic, procedural, archive.',
          es: 'Cinco niveles: working, episodic, semantic, procedural, archive.',
          fr: 'Cinq niveaux : working, episodic, semantic, procedural, archive.',
          tlh: 'vagh pat: working, episodic, semantic, procedural, archive.',
        },
        bullets: {
          en: ['Tier model', 'Dashboard & review', 'Graph view', 'Tags', 'Consolidation'],
          hu: ['Szint-modell', 'Dashboard és review', 'Graph nézet', 'Tagek', 'Konszolidáció'],
          de: ['Ebenen-Modell', 'Dashboard & Review', 'Graph-Ansicht', 'Tags', 'Konsolidierung'],
          es: ['Modelo de niveles', 'Panel y revisión', 'Vista de grafo', 'Etiquetas', 'Consolidación'],
          fr: ['Modèle de niveaux', 'Tableau de bord et revue', 'Vue graphe', 'Étiquettes', 'Consolidation'],
          tlh: ['pat pat', 'jIH Daq chov je', 'graph jIH', 'permey', 'ghomqa\''],
        },
      },
      {
        slug: 'knowledge/knowledge-base',
        titles: {
          en: 'Knowledge base',
          hu: 'Tudásbázis',
          de: 'Wissensbasis',
          es: 'Base de conocimiento',
          fr: 'Base de connaissances',
          tlh: 'Sov pa\'',
        },
        descriptions: {
          en: 'Editable wiki-style knowledge pages.',
          hu: 'Szerkeszthető wiki-szerű tudásoldalak.',
          de: 'Editierbare Wiki-Wissensseiten.',
          es: 'Páginas de conocimiento tipo wiki editables.',
          fr: 'Pages de connaissances de type wiki éditables.',
          tlh: 'choHlaH wiki rur Sov ghItlhmey.',
        },
        bullets: {
          en: ['Tree navigation', 'Editor', 'Linking', 'When to use vs memory'],
          hu: ['Fa navigáció', 'Szerkesztő', 'Linkelés', 'Mikor memória helyett'],
          de: ['Baumnavigation', 'Editor', 'Verlinkung', 'Wann statt Speicher'],
          es: ['Navegación en árbol', 'Editor', 'Enlaces', 'Cuándo usar vs memoria'],
          fr: ['Navigation arborescente', 'Éditeur', 'Liens', 'Quand l’utiliser plutôt que la mémoire'],
          tlh: ['Sor He', 'choHwI\'', 'rarmey', 'qawHaq tlhoS lo\'meH poH'],
        },
      },
      {
        slug: 'knowledge/documents',
        titles: { en: 'Documents', hu: 'Dokumentumok', de: 'Dokumente', es: 'Documentos', fr: 'Documents', tlh: 'ghItlhmey' },
        descriptions: {
          en: 'Upload, index, and use files with agents.',
          hu: 'Fájlok feltöltése, indexelése, használata ágensekkel.',
          de: 'Dateien hochladen, indexieren, mit Agenten nutzen.',
          es: 'Subir, indexar y usar archivos con agentes.',
          fr: 'Téléverser, indexer et utiliser des fichiers avec les agents.',
          tlh: 'ghItlhmey chel, per, \'ej ghoqwI\'pu\' lo\'.',
        },
        bullets: {
          en: ['Upload', 'Supported types', 'Settings', 'Retrieval in chat'],
          hu: ['Feltöltés', 'Támogatott típusok', 'Beállítások', 'Visszakeresés chatben'],
          de: ['Upload', 'Unterstützte Typen', 'Einstellungen', 'Abruf im Chat'],
          es: ['Subida', 'Tipos soportados', 'Ajustes', 'Recuperación en el chat'],
          fr: ['Téléversement', 'Types pris en charge', 'Paramètres', 'Récupération dans le chat'],
          tlh: ['chel', 'chaw\'lu\'bogh Seghmey', 'SeHmey', 'ja\'chuqDaq Sam'],
        },
      },
      {
        slug: 'knowledge/client-wiki',
        titles: {
          en: 'Client wiki',
          hu: 'Ügyfél wiki',
          de: 'Kunden-Wiki',
          es: 'Wiki de cliente',
          fr: 'Wiki client',
          tlh: 'jeSwI\' wiki',
        },
        descriptions: {
          en: 'Per-client collaborative documentation.',
          hu: 'Ügyfél-specifikus közös dokumentáció.',
          de: 'Kundenbezogene gemeinsame Dokumentation.',
          es: 'Documentación colaborativa por cliente.',
          fr: 'Documentation collaborative par client.',
          tlh: 'jeSwI\' HochvaD Qapchuq ghItlh.',
        },
        bullets: {
          en: ['When to use', 'Structure', 'Sharing with agents', 'Permissions'],
          hu: ['Mikor használd', 'Struktúra', 'Megosztás ágensekkel', 'Jogosultságok'],
          de: ['Wann nutzen', 'Struktur', 'Teilen mit Agenten', 'Rechte'],
          es: ['Cuándo usarlo', 'Estructura', 'Compartir con agentes', 'Permisos'],
          fr: ['Quand l’utiliser', 'Structure', 'Partage avec les agents', 'Permissions'],
          tlh: ['lo\'meH poH', 'pat', 'ghoqwI\'pu\'vaD nob', 'chaw\'mey'],
        },
      },
      {
        slug: 'knowledge/meetings',
        titles: { en: 'Meetings', hu: 'Meetingek', de: 'Meetings', es: 'Reuniones', fr: 'Réunions', tlh: 'ghommey' },
        descriptions: {
          en: 'Meeting processing, notes, and follow-ups.',
          hu: 'Meeting feldolgozás, jegyzetek, follow-upok.',
          de: 'Meeting-Verarbeitung, Notizen, Follow-ups.',
          es: 'Procesamiento de reuniones, notas y seguimientos.',
          fr: 'Traitement des réunions, notes et suivis.',
          tlh: 'ghom choH, qawHaq, tlha\' ta\'mey.',
        },
        bullets: {
          en: ['Capture', 'Transcripts & summaries', 'Action items', 'Link to board'],
          hu: ['Rögzítés', 'Átiratok és összefoglalók', 'Action itemek', 'Kapcsolat a táblához'],
          de: ['Erfassen', 'Transkripte & Zusammenfassungen', 'Action Items', 'Link zum Board'],
          es: ['Captura', 'Transcripciones y resúmenes', 'Action items', 'Enlace al tablero'],
          fr: ['Capture', 'Transcriptions et synthèses', 'Actions à suivre', 'Lien vers le tableau'],
          tlh: ['qon', 'mu\' ghItlhmey Del je', 'ta\' De\'mey', 'Qu\' nav rar'],
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
      fr: 'Communication',
      tlh: 'Qum',
    },
    pages: [
      {
        slug: 'communication/channels',
        titles: {
          en: 'Channels overview',
          hu: 'Csatornák áttekintés',
          de: 'Kanäle-Übersicht',
          es: 'Resumen de canales',
          fr: 'Vue d’ensemble des canaux',
          tlh: 'Hemey jIH',
        },
        descriptions: {
          en: 'How EYAS talks outside the web UI.',
          hu: 'Hogyan kommunikál az EYAS a webes UI-n kívül.',
          de: 'Wie EYAS außerhalb der Web-UI kommuniziert.',
          es: 'Cómo habla EYAS fuera de la UI web.',
          fr: 'Comment EYAS communique hors de l’interface web.',
          tlh: 'web UI vo\' EYAS ja\'meH mIw.',
        },
        bullets: {
          en: ['Channel types', 'Routing to agents', 'Pairing model', 'Inbound queue'],
          hu: ['Csatorna típusok', 'Routing ágensekhez', 'Pairing modell', 'Inbound queue'],
          de: ['Kanaltypen', 'Routing zu Agenten', 'Pairing-Modell', 'Inbound-Queue'],
          es: ['Tipos de canal', 'Enrutado a agentes', 'Modelo de pairing', 'Cola entrante'],
          fr: ['Types de canal', 'Routage vers les agents', 'Modèle d’appariement', 'File d’entrée'],
          tlh: ['He Seghmey', 'ghoqwI\'pu\'vaD He', 'rar pat', '\'el tetlh'],
        },
      },
      {
        slug: 'communication/telegram',
        titles: { en: 'Telegram', hu: 'Telegram', de: 'Telegram', es: 'Telegram', fr: 'Telegram', tlh: 'Telegram' },
        descriptions: {
          en: 'Connect a Telegram bot to agents.',
          hu: 'Telegram bot kötése ágensekhez.',
          de: 'Telegram-Bot mit Agenten verbinden.',
          es: 'Conectar un bot de Telegram a agentes.',
          fr: 'Connecter un bot Telegram aux agents.',
          tlh: 'Telegram bot ghoqwI\'pu\'vaD rar.',
        },
        bullets: {
          en: ['Bot token', 'Pairing', 'Agent mapping', 'Limits & safety'],
          hu: ['Bot token', 'Pairing', 'Ágens mapping', 'Korlátok és biztonság'],
          de: ['Bot-Token', 'Pairing', 'Agent-Mapping', 'Limits & Sicherheit'],
          es: ['Token del bot', 'Pairing', 'Mapeo de agentes', 'Límites y seguridad'],
          fr: ['Jeton du bot', 'Appariement', 'Correspondance des agents', 'Limites et sécurité'],
          tlh: ['bot ngaQ', 'rar', 'ghoqwI\' pu\'jIn', 'mebmey Hub je'],
        },
      },
      {
        slug: 'communication/a2a',
        titles: {
          en: 'A2A & external agents',
          hu: 'A2A és külső ágensek',
          de: 'A2A & externe Agenten',
          es: 'A2A y agentes externos',
          fr: 'A2A et agents externes',
          tlh: 'A2A Hur ghoqwI\'pu\' je',
        },
        descriptions: {
          en: 'Agent-to-agent protocol and cards.',
          hu: 'Ágens–ágens protokoll és agent card.',
          de: 'Agent-zu-Agent-Protokoll und Cards.',
          es: 'Protocolo agente–agente y cards.',
          fr: 'Protocole agent-à-agent et cartes.',
          tlh: 'ghoqwI\'-ghoqwI\' chut \'ej chaw\'mey.',
        },
        bullets: {
          en: ['Agent card', 'When to use A2A', 'Trust boundaries', 'Discovery'],
          hu: ['Agent card', 'Mikor használd az A2A-t', 'Trust határok', 'Discovery'],
          de: ['Agent Card', 'Wann A2A nutzen', 'Vertrauensgrenzen', 'Discovery'],
          es: ['Agent card', 'Cuándo usar A2A', 'Límites de confianza', 'Discovery'],
          fr: ['Carte d’agent', 'Quand utiliser A2A', 'Frontières de confiance', 'Découverte'],
          tlh: ['ghoqwI\' chaw\'', 'A2A lo\'meH poH', 'vuv mebmey', 'tu\''],
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
      fr: 'Modèles d’IA et prompts',
      tlh: 'AI patmey mu\'tlheghmey je',
    },
    pages: [
      {
        slug: 'ai/providers',
        titles: {
          en: 'Providers',
          hu: 'Providerek',
          de: 'Provider',
          es: 'Proveedores',
          fr: 'Fournisseurs',
          tlh: 'nobwI\'pu\'',
        },
        descriptions: {
          en: 'Claude, OpenAI, Gemini, Grok, Ollama, and more.',
          hu: 'Claude, OpenAI, Gemini, Grok, Ollama és más.',
          de: 'Claude, OpenAI, Gemini, Grok, Ollama und mehr.',
          es: 'Claude, OpenAI, Gemini, Grok, Ollama y más.',
          fr: 'Claude, OpenAI, Gemini, Grok, Ollama et plus encore.',
          tlh: 'Claude, OpenAI, Gemini, Grok, Ollama, latlh je.',
        },
        bullets: {
          en: ['Add a provider', 'API keys', 'Model catalogue', 'Local Ollama'],
          hu: ['Provider hozzáadása', 'API kulcsok', 'Modell katalógus', 'Helyi Ollama'],
          de: ['Provider hinzufügen', 'API-Schlüssel', 'Modellkatalog', 'Lokales Ollama'],
          es: ['Añadir proveedor', 'Claves API', 'Catálogo de modelos', 'Ollama local'],
          fr: ['Ajouter un fournisseur', 'Clés API', 'Catalogue de modèles', 'Ollama local'],
          tlh: ['nobwI\' chel', 'API ngaQmey', 'pat tetlh', 'juH Ollama'],
        },
      },
      {
        slug: 'ai/routing-budget',
        titles: {
          en: 'Routing & budget',
          hu: 'Routing és budget',
          de: 'Routing & Budget',
          es: 'Enrutado y presupuesto',
          fr: 'Routage et budget',
          tlh: 'He Huch meb je',
        },
        descriptions: {
          en: 'Which model runs what, and cost controls.',
          hu: 'Melyik modell mit futtat, költségkontroll.',
          de: 'Welches Modell was ausführt, Kostenkontrolle.',
          es: 'Qué modelo ejecuta qué, y control de costes.',
          fr: 'Quel modèle exécute quoi, et contrôles de coût.',
          tlh: 'pat \'Iv Qu\' qeng, \'ej Huch SeH.',
        },
        bullets: {
          en: ['Model assignments', 'Fallback', 'Budgets', 'Cost visibility'],
          hu: ['Modell hozzárendelések', 'Fallback', 'Budgetek', 'Költség láthatóság'],
          de: ['Modellzuweisungen', 'Fallback', 'Budgets', 'Kostensichtbarkeit'],
          es: ['Asignaciones de modelo', 'Fallback', 'Presupuestos', 'Visibilidad de costes'],
          fr: ['Affectations de modèle', 'Bascule', 'Budgets', 'Visibilité des coûts'],
          tlh: ['pat lIngmey', 'lIngqa\'', 'Huch mebmey', 'Huch leghlaH'],
        },
      },
      {
        slug: 'ai/prompts',
        titles: {
          en: 'Prompts system',
          hu: 'Prompt rendszer',
          de: 'Prompt-System',
          es: 'Sistema de prompts',
          fr: 'Système de prompts',
          tlh: 'mu\'tlhegh pat',
        },
        descriptions: {
          en: 'Master → project-type → project → conversation chain.',
          hu: 'Master → project-type → project → conversation lánc.',
          de: 'Master → Projekttyp → Projekt → Gesprächs-Kette.',
          es: 'Cadena master → tipo de proyecto → proyecto → conversación.',
          fr: 'Chaîne master → type de projet → projet → conversation.',
          tlh: 'master → Qu\' Segh → Qu\' → ja\'chuq He.',
        },
        bullets: {
          en: ['Inheritance chain', 'Locked sections', 'Wizard', 'Best practices'],
          hu: ['Öröklési lánc', 'Zárolt szekciók', 'Varázsló', 'Best practice'],
          de: ['Vererbungskette', 'Gesperrte Abschnitte', 'Wizard', 'Best Practices'],
          es: ['Cadena de herencia', 'Secciones bloqueadas', 'Asistente', 'Buenas prácticas'],
          fr: ['Chaîne d’héritage', 'Sections verrouillées', 'Assistant', 'Bonnes pratiques'],
          tlh: ['lIng He', 'ngaQ mIwmey', 'SeHwI\'', 'QaQ mIwmey'],
        },
      },
      {
        slug: 'ai/mcp',
        titles: {
          en: 'MCP servers',
          hu: 'MCP szerverek',
          de: 'MCP-Server',
          es: 'Servidores MCP',
          fr: 'Serveurs MCP',
          tlh: 'MCP Servers',
        },
        descriptions: {
          en: 'Model Context Protocol: external tools and data.',
          hu: 'Model Context Protocol: külső toolok és adatok.',
          de: 'Model Context Protocol: externe Tools und Daten.',
          es: 'Model Context Protocol: tools y datos externos.',
          fr: 'Model Context Protocol : outils et données externes.',
          tlh: 'Model Context Protocol: Hur janmey De\' je.',
        },
        bullets: {
          en: ['Add a server', 'Auth', 'Expose to agents', 'Catalog'],
          hu: ['Szerver hozzáadása', 'Auth', 'Ágenseknek adás', 'Katalógus'],
          de: ['Server hinzufügen', 'Auth', 'Für Agenten freigeben', 'Katalog'],
          es: ['Añadir servidor', 'Auth', 'Exponer a agentes', 'Catálogo'],
          fr: ['Ajouter un serveur', 'Authentification', 'Exposer aux agents', 'Catalogue'],
          tlh: ['Server chel', 'yI\'el', 'ghoqwI\'pu\'vaD \'ang', 'tetlh'],
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
      fr: 'Administration',
      tlh: 'lo\'wI\' SeH',
    },
    pages: [
      {
        slug: 'admin/users',
        titles: {
          en: 'Users & permissions',
          hu: 'Felhasználók és jogosultságok',
          de: 'Benutzer & Rechte',
          es: 'Usuarios y permisos',
          fr: 'Utilisateurs et permissions',
          tlh: 'lo\'wI\'pu\' chaw\'mey je',
        },
        descriptions: {
          en: 'Accounts, roles, CASL permissions.',
          hu: 'Fiókok, szerepek, CASL jogosultságok.',
          de: 'Konten, Rollen, CASL-Rechte.',
          es: 'Cuentas, roles, permisos CASL.',
          fr: 'Comptes, rôles, permissions CASL.',
          tlh: 'lo\'wI\' mIwmey, Qu\', CASL chaw\'mey.',
        },
        bullets: {
          en: ['Users list', 'Roles', 'Permission model', 'API access'],
          hu: ['Felhasználó lista', 'Szerepek', 'Jogosultsági modell', 'API hozzáférés'],
          de: ['Benutzerliste', 'Rollen', 'Rechtemodell', 'API-Zugriff'],
          es: ['Lista de usuarios', 'Roles', 'Modelo de permisos', 'Acceso API'],
          fr: ['Liste des utilisateurs', 'Rôles', 'Modèle de permissions', 'Accès API'],
          tlh: ['lo\'wI\' tetlh', 'Qu\'mey', 'chaw\' pat', 'API lo\''],
        },
      },
      {
        slug: 'admin/secrets',
        titles: {
          en: 'Secrets & API keys',
          hu: 'Secrettek és API kulcsok',
          de: 'Secrets & API-Schlüssel',
          es: 'Secretos y claves API',
          fr: 'Secrets et clés API',
          tlh: 'peghmey API ngaQmey je',
        },
        descriptions: {
          en: 'Encrypted secrets store and machine API keys.',
          hu: 'Titkosított secret tár és gépi API kulcsok.',
          de: 'Verschlüsselter Secret-Store und Maschinen-API-Keys.',
          es: 'Almacén cifrado de secretos y claves API de máquina.',
          fr: 'Magasin de secrets chiffré et clés API machine.',
          tlh: 'ngaQlu\'bogh pegh pa\' \'ej jan API ngaQmey.',
        },
        bullets: {
          en: ['Master password', 'Scoped secrets', 'API keys for clients', 'Rotation'],
          hu: ['Master jelszó', 'Scope-olt secrettek', 'API kulcsok klienseknek', 'Rotáció'],
          de: ['Master-Passwort', 'Gescopte Secrets', 'API-Keys für Clients', 'Rotation'],
          es: ['Contraseña maestra', 'Secretos con scope', 'Claves API para clientes', 'Rotación'],
          fr: ['Mot de passe maître', 'Secrets à périmètre', 'Clés API pour clients', 'Rotation'],
          tlh: ['joH pegh mu\'', 'meb peghmey', 'jeSwI\'pu\'vaD API ngaQmey', 'choHqa\''],
        },
      },
      {
        slug: 'admin/connections',
        titles: {
          en: 'Connections',
          hu: 'Kapcsolatok',
          de: 'Verbindungen',
          es: 'Conexiones',
          fr: 'Connexions',
          tlh: 'rarmey',
        },
        descriptions: {
          en: 'External system inventory — health, secrets, agent proposals.',
          hu: 'Külső rendszerek leltára — health, secrettek, ágens javaslatok.',
          de: 'Inventar externer Systeme — Health, Secrets, Agentenvorschläge.',
          es: 'Inventario de sistemas externos — salud, secretos, propuestas de agentes.',
          fr: 'Inventaire des systèmes externes — santé, secrets, propositions d’agents.',
          tlh: 'Hur pat tetlh — Dotlh, peghmey, ghoqwI\' chupmey.',
        },
        bullets: {
          en: ['Catalog of system types', 'Add and test connections', 'Pending agent proposals', 'Vault-bound secrets'],
          hu: ['Rendszertípus-katalógus', 'Kapcsolat létrehozás és teszt', 'Függő ágens javaslatok', 'Vault secrettek'],
          de: ['Katalog der Systemtypen', 'Verbindung anlegen und testen', 'Ausstehende Agentenvorschläge', 'Vault-Secrets'],
          es: ['Catálogo de tipos de sistema', 'Añadir y probar conexiones', 'Propuestas pendientes', 'Secretos en el vault'],
          fr: ['Catalogue des types de système', 'Ajouter et tester des connexions', 'Propositions d’agents en attente', 'Secrets liés au coffre'],
          tlh: ['pat Segh tetlh', 'rarmey chel \'ej chov', 'loS ghoqwI\' chupmey', 'vault peghmey'],
        },
      },
      {
        slug: 'admin/settings',
        titles: {
          en: 'Settings overview',
          hu: 'Beállítások áttekintés',
          de: 'Einstellungen-Übersicht',
          es: 'Resumen de ajustes',
          fr: 'Vue d’ensemble des paramètres',
          tlh: 'SeHmey jIH',
        },
        descriptions: {
          en: 'Map of Settings groups in the UI.',
          hu: 'A Beállítások csoportok térképe a UI-ban.',
          de: 'Karte der Einstellungsgruppen in der UI.',
          es: 'Mapa de grupos de Ajustes en la UI.',
          fr: 'Carte des groupes de Paramètres dans l’interface.',
          tlh: 'UI SeHmey ghommey pu\'jIn.',
        },
        bullets: {
          en: ['General', 'AI & model', 'Modules', 'Infrastructure'],
          hu: ['Általános', 'AI és modell', 'Modulok', 'Infrastruktúra'],
          de: ['Allgemein', 'KI & Modell', 'Module', 'Infrastruktur'],
          es: ['General', 'IA y modelo', 'Módulos', 'Infraestructura'],
          fr: ['Général', 'IA et modèle', 'Modules', 'Infrastructure'],
          tlh: ['motlh', 'AI pat je', 'patHommey', 'qach pat'],
        },
      },
      {
        slug: 'admin/backup',
        titles: {
          en: 'Backup & restore',
          hu: 'Backup és visszaállítás',
          de: 'Backup & Wiederherstellung',
          es: 'Copia y restauración',
          fr: 'Sauvegarde et restauration',
          tlh: 'qon qa\' je',
        },
        descriptions: {
          en: 'Create backups and restore onto a clean install.',
          hu: 'Backup készítés és visszaállítás tiszta installra.',
          de: 'Backups erstellen und auf saubere Installation zurückspielen.',
          es: 'Crear copias y restaurar en instalación limpia.',
          fr: 'Créer des sauvegardes et restaurer sur une installation propre.',
          tlh: 'qonmey chu\' \'ej chIm lIngDaq qa\'.',
        },
        bullets: {
          en: ['Local backup', 'Remote destinations (S3)', 'Version pinning', 'Empty-system restore'],
          hu: ['Helyi backup', 'Távoli célok (S3)', 'Verzió rögzítés', 'Üres rendszerre restore'],
          de: ['Lokales Backup', 'Remote-Ziele (S3)', 'Versions-Pinning', 'Restore auf leeres System'],
          es: ['Copia local', 'Destinos remotos (S3)', 'Fijar versión', 'Restaurar en sistema vacío'],
          fr: ['Sauvegarde locale', 'Destinations distantes (S3)', 'Épinglage de version', 'Restauration sur système vide'],
          tlh: ['juH qon', 'Hop ghochmey (S3)', 'chovnatlh ngaQ', 'chIm patDaq qa\''],
        },
      },
      {
        slug: 'admin/ingress',
        titles: {
          en: 'Ingress tunnel',
          hu: 'Ingress alagút',
          de: 'Ingress-Tunnel',
          es: 'Túnel Ingress',
          fr: 'Tunnel Ingress',
          tlh: 'Ingress He',
        },
        descriptions: {
          en: 'Expose EYAS remotely through a Cloudflare tunnel.',
          hu: 'Távoli elérés Cloudflare tunnelön keresztül.',
          de: 'EYAS remote über einen Cloudflare-Tunnel erreichbar machen.',
          es: 'Exponer EYAS en remoto con un túnel de Cloudflare.',
          fr: 'Exposer EYAS à distance via un tunnel Cloudflare.',
          tlh: 'Cloudflare He lo\'taHvIS HopDaq EYAS \'ang.',
        },
        bullets: {
          en: ['Start / stop cloudflared', 'Tunnel token', 'Optional hostname', 'Public URL when connected'],
          hu: ['cloudflared indítás / leállítás', 'Tunnel token', 'Opcionális hostname', 'Nyilvános URL csatlakozáskor'],
          de: ['cloudflared starten / stoppen', 'Tunnel-Token', 'Optionaler Hostname', 'Öffentliche URL wenn verbunden'],
          es: ['Iniciar / detener cloudflared', 'Token del túnel', 'Hostname opcional', 'URL pública al conectar'],
          fr: ['Démarrer / arrêter cloudflared', 'Jeton du tunnel', 'Nom d’hôte facultatif', 'URL publique une fois connecté'],
          tlh: ['cloudflared tagh / mev', 'He ngaQ', 'poQbe\' hostname', 'rarlu\'DI\' Hoch URL'],
        },
      },
      {
        slug: 'admin/data-port',
        titles: {
          en: 'Data import & export',
          hu: 'Adatimport és -export',
          de: 'Datenimport & -export',
          es: 'Importación y exportación de datos',
          fr: 'Import et export de données',
          tlh: 'De\' chel nargh je',
        },
        descriptions: {
          en: 'Port memory, skills, and workspace rules.',
          hu: 'Memória, skillek, workspace szabályok átvitele.',
          de: 'Speicher, Skills und Workspace-Regeln portieren.',
          es: 'Portar memoria, skills y reglas de workspace.',
          fr: 'Porter mémoire, compétences et règles d’espace de travail.',
          tlh: 'qawHaq, laHmey, workspace chutmey lIng.',
        },
        bullets: {
          en: ['Import wizard', 'Supported targets', 'Proposal → approve', 'Export status'],
          hu: ['Import varázsló', 'Támogatott célok', 'Proposal → approve', 'Export státusz'],
          de: ['Import-Wizard', 'Unterstützte Ziele', 'Proposal → Approve', 'Export-Status'],
          es: ['Asistente de importación', 'Destinos soportados', 'Propuesta → aprobar', 'Estado de export'],
          fr: ['Assistant d’import', 'Cibles prises en charge', 'Proposition → approuver', 'État de l’export'],
          tlh: ['chel SeHwI\'', 'chaw\'lu\'bogh ghochmey', 'chup → chaw\'', 'nargh Dotlh'],
        },
      },
      {
        slug: 'admin/security-privacy',
        titles: {
          en: 'Security & privacy',
          hu: 'Biztonság és adatvédelem',
          de: 'Sicherheit & Datenschutz',
          es: 'Seguridad y privacidad',
          fr: 'Sécurité et confidentialité',
          tlh: 'Hub pegh je',
        },
        descriptions: {
          en: 'Security gate, audit, privacy controls.',
          hu: 'Security gate, audit, privacy kontrollok.',
          de: 'Security Gate, Audit, Privacy-Kontrollen.',
          es: 'Security gate, auditoría, controles de privacidad.',
          fr: 'Barrière de sécurité, audit, contrôles de confidentialité.',
          tlh: 'Hub lojmIt, chov, pegh SeHmey.',
        },
        bullets: {
          en: ['Security gate', 'Audit log', 'Privacy module', 'Security events'],
          hu: ['Security gate', 'Audit napló', 'Privacy modul', 'Security események'],
          de: ['Security Gate', 'Audit-Log', 'Privacy-Modul', 'Security-Events'],
          es: ['Security gate', 'Registro de auditoría', 'Módulo de privacidad', 'Eventos de seguridad'],
          fr: ['Barrière de sécurité', 'Journal d’audit', 'Module de confidentialité', 'Événements de sécurité'],
          tlh: ['Hub lojmIt', 'chov ghItlh', 'pegh patHom', 'Hub wanI\'mey'],
        },
      },
      {
        slug: 'admin/observability',
        titles: {
          en: 'Observability & ops',
          hu: 'Observability és ops',
          de: 'Observability & Ops',
          es: 'Observabilidad y ops',
          fr: 'Observabilité et ops',
          tlh: 'bejlaH ops je',
        },
        descriptions: {
          en: 'Metrics, tracing, ops agent, extensions, hands, nodes.',
          hu: 'Metrikák, tracing, ops agent, extensionök, hands, node-ok.',
          de: 'Metriken, Tracing, Ops-Agent, Extensions, Hands, Nodes.',
          es: 'Métricas, tracing, agente ops, extensiones, hands, nodos.',
          fr: 'Métriques, traçage, agent ops, extensions, mains, nœuds.',
          tlh: 'mI\'mey, tlha\', ops ghoqwI\', cheltaHghachmey, ghopmey, Nodes.',
        },
        bullets: {
          en: ['Observability UI', 'Ops page', 'Hands & remote nodes', 'Ingress', 'Extensions', 'System update'],
          hu: ['Observability UI', 'Ops oldal', 'Hands és remote node-ok', 'Ingress', 'Extensionök', 'Rendszerfrissítés'],
          de: ['Observability-UI', 'Ops-Seite', 'Hands & Remote-Nodes', 'Ingress', 'Extensions', 'System-Update'],
          es: ['UI de observabilidad', 'Página ops', 'Hands y nodos remotos', 'Ingress', 'Extensiones', 'Actualización del sistema'],
          fr: ['Interface d’observabilité', 'Page ops', 'Mains et nœuds distants', 'Ingress', 'Extensions', 'Mise à jour système'],
          tlh: ['bejlaH UI', 'ops ghItlh', 'Hop ghopmey Nodes je', 'Ingress', 'cheltaHghachmey', 'pat chu\'qa\''],
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
      fr: 'Déploiement et CLI',
      tlh: 'lIng CLI je',
    },
    pages: [
      {
        slug: 'deploy/native',
        titles: {
          en: 'Native install',
          hu: 'Natív telepítés',
          de: 'Native Installation',
          es: 'Instalación nativa',
          fr: 'Installation native',
          tlh: 'native lIng',
        },
        descriptions: {
          en: 'Bun/Node install, installer scripts, PATH.',
          hu: 'Bun/Node telepítés, installer scriptek, PATH.',
          de: 'Bun/Node-Installation, Installer-Skripte, PATH.',
          es: 'Instalación Bun/Node, scripts de instalador, PATH.',
          fr: 'Installation Bun/Node, scripts d’installateur, PATH.',
          tlh: 'Bun/Node lIng, lIngwI\' scripts, PATH.',
        },
        bullets: {
          en: ['One-line installer', 'Manual git clone', 'bin/eyas on PATH', 'Upgrades'],
          hu: ['Egy-soros installer', 'Kézi git clone', 'bin/eyas a PATH-on', 'Frissítések'],
          de: ['Einzeiliger Installer', 'Manueller Git-Clone', 'bin/eyas im PATH', 'Upgrades'],
          es: ['Instalador de una línea', 'Clone git manual', 'bin/eyas en PATH', 'Actualizaciones'],
          fr: ['Installateur en une ligne', 'Clone git manuel', 'bin/eyas dans le PATH', 'Mises à jour'],
          tlh: ['wa\' tlhegh lIngwI\'', 'ghItlh git clone', 'PATHDaq bin/eyas', 'chu\'qa\'mey'],
        },
      },
      {
        slug: 'deploy/docker',
        titles: { en: 'Docker', hu: 'Docker', de: 'Docker', es: 'Docker', fr: 'Docker', tlh: 'Docker' },
        descriptions: {
          en: 'Compose, volumes, ports, GPU/Ollama profile.',
          hu: 'Compose, volume-ok, portok, GPU/Ollama profil.',
          de: 'Compose, Volumes, Ports, GPU/Ollama-Profil.',
          es: 'Compose, volúmenes, puertos, perfil GPU/Ollama.',
          fr: 'Compose, volumes, ports, profil GPU/Ollama.',
          tlh: 'Compose, volumes, portmey, GPU/Ollama pat.',
        },
        bullets: {
          en: ['docker compose up', 'Ports', 'Volumes', 'GPU profile'],
          hu: ['docker compose up', 'Portok', 'Volume-ok', 'GPU profil'],
          de: ['docker compose up', 'Ports', 'Volumes', 'GPU-Profil'],
          es: ['docker compose up', 'Puertos', 'Volúmenes', 'Perfil GPU'],
          fr: ['docker compose up', 'Ports', 'Volumes', 'Profil GPU'],
          tlh: ['docker compose up', 'portmey', 'volumes', 'GPU pat'],
        },
      },
      {
        slug: 'deploy/kubernetes',
        titles: {
          en: 'Kubernetes',
          hu: 'Kubernetes',
          de: 'Kubernetes',
          es: 'Kubernetes',
          fr: 'Kubernetes',
          tlh: 'Kubernetes',
        },
        descriptions: {
          en: 'Manifests and Helm chart under deploy/k8s.',
          hu: 'Manifestek és Helm chart a deploy/k8s alatt.',
          de: 'Manifeste und Helm-Chart unter deploy/k8s.',
          es: 'Manifiestos y chart Helm en deploy/k8s.',
          fr: 'Manifestes et chart Helm sous deploy/k8s.',
          tlh: 'manifests Helm chart je deploy/k8s bIngDaq.',
        },
        bullets: {
          en: ['Prerequisites', 'Helm values', 'Persistence', 'Ingress'],
          hu: ['Előfeltételek', 'Helm values', 'Perzisztencia', 'Ingress'],
          de: ['Voraussetzungen', 'Helm Values', 'Persistenz', 'Ingress'],
          es: ['Requisitos', 'Valores Helm', 'Persistencia', 'Ingress'],
          fr: ['Prérequis', 'Valeurs Helm', 'Persistance', 'Ingress'],
          tlh: ['poQlu\'bogh', 'Helm De\'mey', 'taHghach', 'Ingress'],
        },
      },
      {
        slug: 'deploy/multi-instance',
        titles: {
          en: 'Multiple instances',
          hu: 'Több példány',
          de: 'Mehrere Instanzen',
          es: 'Varias instancias',
          fr: 'Plusieurs instances',
          tlh: 'law\' patmey',
        },
        descriptions: {
          en: 'Run prod + dev on one machine with EYAS_HOME / ports.',
          hu: 'Prod + dev egy gépen: EYAS_HOME / portok.',
          de: 'Prod + Dev auf einer Maschine: EYAS_HOME / Ports.',
          es: 'Prod + dev en una máquina: EYAS_HOME / puertos.',
          fr: 'Prod + dev sur une machine avec EYAS_HOME / ports.',
          tlh: 'wa\' janDaq prod + dev: EYAS_HOME / portmey.',
        },
        bullets: {
          en: ['EYAS_HOME', 'Ports', 'Compose projects', 'Isolation rules'],
          hu: ['EYAS_HOME', 'Portok', 'Compose projectek', 'Izolációs szabályok'],
          de: ['EYAS_HOME', 'Ports', 'Compose-Projekte', 'Isolationsregeln'],
          es: ['EYAS_HOME', 'Puertos', 'Proyectos Compose', 'Reglas de aislamiento'],
          fr: ['EYAS_HOME', 'Ports', 'Projets Compose', 'Règles d’isolation'],
          tlh: ['EYAS_HOME', 'portmey', 'Compose Qu\'mey', 'pImghach chutmey'],
        },
      },
      {
        slug: 'deploy/cli',
        titles: {
          en: 'CLI reference',
          hu: 'CLI referencia',
          de: 'CLI-Referenz',
          es: 'Referencia CLI',
          fr: 'Référence CLI',
          tlh: 'CLI De\'',
        },
        descriptions: {
          en: 'eyas serve, start, stop, doctor, module, config.',
          hu: 'eyas serve, start, stop, doctor, module, config.',
          de: 'eyas serve, start, stop, doctor, module, config.',
          es: 'eyas serve, start, stop, doctor, module, config.',
          fr: 'eyas serve, start, stop, doctor, module, config.',
          tlh: 'eyas serve, start, stop, doctor, module, config.',
        },
        bullets: {
          en: ['Lifecycle', 'doctor / status', 'config', 'module enable/disable', 'version'],
          hu: ['Életciklus', 'doctor / status', 'config', 'module enable/disable', 'version'],
          de: ['Lebenszyklus', 'doctor / status', 'config', 'module enable/disable', 'version'],
          es: ['Ciclo de vida', 'doctor / status', 'config', 'module enable/disable', 'version'],
          fr: ['Cycle de vie', 'doctor / status', 'config', 'module enable/disable', 'version'],
          tlh: ['yIn He', 'doctor / status', 'config', 'module enable/disable', 'version'],
        },
      },
      {
        slug: 'deploy/configuration',
        titles: {
          en: 'Configuration',
          hu: 'Konfiguráció',
          de: 'Konfiguration',
          es: 'Configuración',
          fr: 'Configuration',
          tlh: 'SeH',
        },
        descriptions: {
          en: 'YAML config, local overlays, env vars.',
          hu: 'YAML config, local overlay, env változók.',
          de: 'YAML-Config, lokale Overlays, Umgebungsvariablen.',
          es: 'Config YAML, overlays locales, variables de entorno.',
          fr: 'Config YAML, superpositions locales, variables d’environnement.',
          tlh: 'YAML SeH, juH overlays, De\' choHmey.',
        },
        bullets: {
          en: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot reload'],
          hu: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot reload'],
          de: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot Reload'],
          es: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Hot reload'],
          fr: ['default.yaml', 'local.yaml', 'EYAS_* env', 'Rechargement à chaud'],
          tlh: ['default.yaml', 'local.yaml', 'EYAS_* env', 'tujqa\''],
        },
      },
    ],
  },
  {
    id: 'reference',
    labels: { en: 'Reference', hu: 'Referencia', de: 'Referenz', es: 'Referencia', fr: 'Référence', tlh: 'De\' Degh' },
    pages: [
      {
        slug: 'reference/glossary',
        titles: { en: 'Glossary', hu: 'Szójegyzék', de: 'Glossar', es: 'Glosario', fr: 'Glossaire', tlh: 'mu\'ghom' },
        descriptions: {
          en: 'Terms used across EYAS.',
          hu: 'Az EYAS-ban használt fogalmak.',
          de: 'Begriffe in EYAS.',
          es: 'Términos usados en EYAS.',
          fr: 'Termes utilisés dans EYAS.',
          tlh: 'EYASDaq lo\'lu\'bogh mu\'mey.',
        },
        bullets: {
          en: ['Agent', 'Skill', 'Memory tiers', 'Board card', 'Channel', 'Forge'],
          hu: ['Ágens', 'Skill', 'Memória szintek', 'Tábla kártya', 'Csatorna', 'Forge'],
          de: ['Agent', 'Skill', 'Speicherebenen', 'Board-Karte', 'Kanal', 'Forge'],
          es: ['Agente', 'Skill', 'Niveles de memoria', 'Tarjeta del tablero', 'Canal', 'Forge'],
          fr: ['Agent', 'Compétence', 'Niveaux de mémoire', 'Carte du tableau', 'Canal', 'Forge'],
          tlh: ['ghoqwI\'', 'laH', 'qawHaq patmey', 'Qu\' nav chaw\'', 'He', 'Forge'],
        },
      },
      {
        slug: 'reference/faq',
        titles: { en: 'FAQ', hu: 'GYIK', de: 'FAQ', es: 'FAQ', fr: 'FAQ', tlh: 'yI\'elbogh QInmey' },
        descriptions: {
          en: 'Common questions and troubleshooting.',
          hu: 'Gyakori kérdések és hibaelhárítás.',
          de: 'Häufige Fragen und Fehlerbehebung.',
          es: 'Preguntas frecuentes y solución de problemas.',
          fr: 'Questions fréquentes et dépannage.',
          tlh: 'motlh yu\'mey \'ej Qagh tI\'.',
        },
        bullets: {
          en: ['Port already in use', 'No UI after start', 'Provider errors', 'Where is my data'],
          hu: ['Port foglalt', 'Nincs UI indítás után', 'Provider hibák', 'Hol vannak az adataim'],
          de: ['Port belegt', 'Keine UI nach Start', 'Provider-Fehler', 'Wo liegen meine Daten'],
          es: ['Puerto en uso', 'Sin UI tras el arranque', 'Errores de proveedor', 'Dónde están mis datos'],
          fr: ['Port déjà utilisé', 'Pas d’interface après le démarrage', 'Erreurs de fournisseur', 'Où sont mes données'],
          tlh: ['port lo\'lu\'taH', 'tagh ret UI Hutlh', 'nobwI\' Qaghmey', 'nuqDaq De\'wIj'],
        },
      },
      {
        slug: 'reference/architecture',
        titles: {
          en: 'Architecture (pointer)',
          hu: 'Architektúra (mutató)',
          de: 'Architektur (Verweis)',
          es: 'Arquitectura (enlace)',
          fr: 'Architecture (lien)',
          tlh: 'qach pat (Degh)',
        },
        descriptions: {
          en: 'Where deep technical specs live in the repo.',
          hu: 'Hol vannak a mély technikai specek a repóban.',
          de: 'Wo tiefe technische Specs im Repo liegen.',
          es: 'Dónde viven las specs técnicas profundas en el repo.',
          fr: 'Où se trouvent les spécifications techniques approfondies dans le dépôt.',
          tlh: 'repoDaq nI\' tej Del tu\'lu\'.',
        },
        bullets: {
          en: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Contributor vs user docs'],
          hu: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Fejlesztői vs felhasználói docs'],
          de: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Contributor- vs User-Docs'],
          es: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Docs de contribuidor vs usuario'],
          fr: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'Documentation contributeur vs utilisateur'],
          tlh: ['docs/eyas-architecture.md', 'docs/superpowers/*', 'chenmoHwI\' ghItlh lo\'wI\' ghItlh je'],
        },
      },
    ],
  },
]

const LOCALES = ['en', 'hu', 'de', 'es', 'fr', 'tlh']

const STATUS = {
  en: 'Outline page — full prose content still to write. Structure and topics are locked.',
  hu: 'Vázlatoldal — a teljes szöveg még írandó. A struktúra és a témák rögzítve.',
  de: 'Gliederungsseite — Fließtext folgt. Struktur und Themen sind festgelegt.',
  es: 'Página de esquema — el texto completo está pendiente. Estructura y temas fijados.',
  fr: 'Page plan — le texte complet reste à rédiger. Structure et sujets figés.',
  tlh: 'nab ghItlh — nI\'bogh mu\'mey lughItlhbe\'. pat qechmey je taH.',
}

const LEARN = {
  en: 'This page will cover',
  hu: 'Ez az oldal ezeket fogja tárgyalni',
  de: 'Diese Seite wird abdecken',
  es: 'Esta página cubrirá',
  fr: 'Cette page couvrira',
  tlh: 'ghItlhlIj Del',
}

const RELATED = {
  en: 'Related',
  hu: 'Kapcsolódó',
  de: 'Verwandt',
  es: 'Relacionado',
  fr: 'Lié',
  tlh: 'lIng',
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
  const title = page.titles[locale] || page.titles.en
  const bullets = page.bullets[locale] || page.bullets.en
  const list = bullets.map((b) => `- ${b}`).join('\n')
  return `---
title: ${yamlQuote(title)}
description: ${yamlQuote(page.descriptions[locale] || page.descriptions.en)}
---

${MARKER}

${intro(locale, page, sectionLabel)}

## ${LEARN[locale] || LEARN.en}

${list}

:::note
${STATUS[locale] || STATUS.en}
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
    fr: `**${t}** fait partie de la section *${sectionLabel}* de la documentation EYAS.`,
    tlh: `**${t}** 'oH EYAS ghItlh *${sectionLabel}* 'e'.`,
  }
  return intros[locale] || intros.en
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
          fr: p.titles.fr,
          tlh: p.titles.tlh,
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
        fr: sec.labels.fr,
        tlh: sec.labels.tlh,
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
