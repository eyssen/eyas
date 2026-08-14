---
title: Kapcsolatok
description: Külső rendszerek leltára — health, secrettek, ágens javaslatok.
---

**Útvonal:** `/connections`.  
Alcím: *Külső rendszerek, amiket az EYAS használhat — leltár, health, ágens javaslatok.*

A Connections **névvel ellátott leltár** külső rendszerekről (Odoo, GitHub, MCP, …). A hitelesítő adatok a [Secrets vault](/docs/hu/admin/secrets/)ba kerülnek; az ágensek **javasolhatnak** kapcsolatot emberi jóváhagyásra, ahelyett hogy MCP/skill/ad-hoc secret darabokban élnének.

---

## Tabok

| Tab | Cél |
|-----|-----|
| **Connections** | Aktív leltár (connected / error / disabled / unknown) |
| **Catalog** | Ismert rendszertípusok — válassz egyet a létrehozáshoz |
| **Pending** | Ágens-javaslatok **Approve** / **Reject** várakozással |

---

## Lista

| Vezérlő / mező | Jelentés |
|----------------|----------|
| **N connections** | Sorok száma |
| **Add connection** | Létrehozó űrlap (vagy Catalog → **Use**) |
| **Name** | Példány neve |
| **System** | Katalógus típus |
| **Status** | Pending / Disabled / Connected / Error / Unknown |
| **Adapter** | `native` / `http` / `mcp` |
| **Last check** | Utolsó health teszt |
| **Error** | Utolsó hibaüzenet |
| **Source** | **User** / **Agent** / **System** |
| **Test** | Health adapter futtatása |
| **Edit / Delete** | Szerkesztés / törlés |

Üres: *No connections yet…*

---

## Létrehozás / szerkesztés

| Mező | Jelentés |
|------|----------|
| **Name** | Megjelenített név |
| **System type** | Katalógus bejegyzés |
| **Configuration** | Nem-secret mezők (URL, db, org, …) |
| **Secrets** | Érzékeny mezők — vault: `conn-{id}-{field}`; *mentés után nem látszanak újra* |
| **Save / Cancel** | Mentés / elvetés |

Gyorslinkek: **MCP Settings**, **Secrets**.

---

## Katalógus típusok

| Típus | Adapter | Tipikus használat |
|-------|---------|-------------------|
| **Odoo** | native | ERP / Helpdesk JSON-RPC + ticket toolok |
| **GitHub / GitLab** | http | Repo, issue, PR/MR |
| **Linear / Notion / Jira** | http | Issue / wiki / Atlassian |
| **Slack (API)** | http | Workspace bot toolok (chat csatorna külön) |
| **MCP server** | mcp | Leltár sor → már beállított [MCP](/docs/hu/ai/mcp/) szerver |
| **Custom HTTP** | http | Általános REST |

---

## Függő javaslatok

Ágensek toolokkal **javasolhatnak** kapcsolatot. **Pending** tab: **Reason**, **Approve**, **Reject**.

---

## Ágens toolok

| Tool | Cél |
|------|-----|
| `connections_list` / `connections_catalog` | Leltár + katalógus |
| `connections_test` | Health |
| `connections_propose` | Javaslat jóváhagyásra |

## Kapcsolódó

- [Secrettek](/docs/hu/admin/secrets/)
- [MCP szerverek](/docs/hu/ai/mcp/)
- [Toolok](/docs/hu/automation/tools/)
