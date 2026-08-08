---
title: Verbindungen
description: Inventar externer Systeme — Health, Secrets, Agentenvorschläge.
---

**Route:** `/connections`.  
Untertitel: *Externe Systeme, die EYAS nutzen kann — Inventar, Health und Agentenvorschläge.*

Connections sind ein **benanntes Inventar** externer Systeme (Odoo, GitHub, MCP, …). Zugangsdaten liegen im [Secrets-Vault](/docs/de/admin/secrets/); Agenten können Verbindungen zur **menschlichen Freigabe vorschlagen**, statt Konfiguration über MCP/Skills/Ad-hoc-Secrets zu verstreuen.

---

## Tabs

| Tab | Zweck |
|-----|-------|
| **Connections** | Aktives Inventar (connected / error / disabled / unknown) |
| **Catalog** | Bekannte Systemtypen — wählen zum Anlegen |
| **Pending** | Agentenvorschläge: **Approve** / **Reject** |

---

## Liste

| Steuerung / Feld | Bedeutung |
|------------------|-----------|
| **N connections** | Anzahl der Einträge |
| **Add connection** | Anlegen (oder Catalog → **Use**) |
| **Name** | Anzeigename der Instanz |
| **System** | Katalogtyp |
| **Status** | Pending / Disabled / Connected / Error / Unknown |
| **Adapter** | `native` / `http` / `mcp` |
| **Last check / Error** | Letzter Health-Check / Fehler |
| **Source** | **User** / **Agent** / **System** |
| **Test / Edit / Delete** | Prüfen / bearbeiten / löschen |

---

## Formular

| Feld | Bedeutung |
|------|-----------|
| **Name** | Anzeigename |
| **System type** | Katalogeintrag |
| **Configuration** | Nicht-geheime Felder (URL, db, org, …) |
| **Secrets** | Sensible Felder im Vault als `conn-{id}-{field}` — *nach dem Speichern nicht erneut sichtbar* |
| **Save / Cancel** | Speichern / verwerfen |

---

## Katalogtypen

Odoo (native) · GitHub / GitLab · Linear · Notion · Jira · Slack (API) · **MCP server** (Link zu [MCP](/docs/de/ai/mcp/)) · Custom HTTP.

---

## Agent-Tools

`connections_list` · `connections_catalog` · `connections_test` · `connections_propose`.

## Verwandt

- [Secrets](/docs/de/admin/secrets/)
- [MCP-Server](/docs/de/ai/mcp/)
- [Tools](/docs/de/automation/tools/)
