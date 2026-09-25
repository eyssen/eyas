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

**OpenCode-Terminal:** nur Eigentümer und Admins (das Verwaltungsrecht für OpenCode), denn das Terminal führt Befehle als eigener Benutzer des Servers aus. Die Rolle user sieht die OpenCode-Seite, und die `opencode_run`-Aufgaben von Kollegen laufen in ihren Gesprächen. Die Rechte der eingebauten Rollen sind fest; wer das Terminal braucht, bekommt die Rolle admin. Wer herabgestuft, gesperrt oder archiviert wird, dessen offene Terminals enden sofort — siehe [OpenCode — Wer ein Terminal öffnen darf](/docs/de/automation/opencode/#who-can-open-a-terminal).

## Verwandt

- [Setup — Root-Owner](/docs/de/setup-wizard/)
- [API-Schlüssel](/docs/de/admin/secrets/)
- [Agenten](/docs/de/agents/overview/)
- [Sicherheit](/docs/de/admin/security-privacy/)
