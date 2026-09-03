---
title: Benutzer & Berechtigungen
description: Menschen, Agenten-Identitäten, Rollen, Archivieren und Wiederherstellen.
---

**Wozu das da ist.** Verzeichnis von Login-Menschen und Non-Login-**Agenten**-Identitäten. CASL auf jeder geschützten API. Modell/Tools stehen unter [Konfigurieren](/docs/de/agents/configure/). **Neuer Agent** legt die Identität an und springt zum Editor.

**Route:** `/users`. Sidebar: **Benutzer**.

## Wann du es brauchst

- Zweiter Mensch (Operator/Viewer).
- Neue Agenten-Identität ohne den Agenten-Bereich zuerst.
- Jemand geht — **Archivieren** (weich). Root-Owner und Agent-User nicht von hier.
- **Aktiv** vs **Archiviert**.

## Typischer Ablauf

1. **Benutzer** (`/users`).
2. **Aktiv / Archiviert**.
3. **Neuer Agent** → `/agents/<id>`.
4. Menschen über Setup/Provisioning; Rollen via CASL.
5. Archivieren (Bestätigen). Wiederherstellen aus **Archiviert**.

Spalten: Username, Anzeigename, Rolle, Typ (Mensch/Agent), Erstellt, **AI-Config →**. Archive = `DELETE /users/:id`; Restore `POST /users/:id/restore`.

## Verwandt

- [Setup — Root-Owner](/docs/de/setup-wizard/)
- [API-Schlüssel](/docs/de/admin/secrets/)
- [Agenten](/docs/de/agents/overview/)
- [Sicherheit](/docs/de/admin/security-privacy/)
