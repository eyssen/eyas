---
title: Conexiones
description: Inventario de sistemas externos — salud, secretos, propuestas de agentes.
---

**Ruta:** `/connections`.  
Subtítulo: *Sistemas externos que EYAS puede usar — inventario, salud y propuestas de agentes.*

Las Connections son un **inventario con nombre** de sistemas externos (Odoo, GitHub, MCP, …). Las credenciales van al [vault de secretos](/docs/es/admin/secrets/); los agentes pueden **proponer** una conexión para aprobación humana en lugar de repartir la config entre MCP, skills y secretos sueltos.

---

## Pestañas

| Pestaña | Propósito |
|---------|-----------|
| **Connections** | Inventario activo (connected / error / disabled / unknown) |
| **Catalog** | Tipos de sistema conocidos — elige uno para crear |
| **Pending** | Propuestas de agentes: **Approve** / **Reject** |

---

## Lista

| Control / campo | Significado |
|-----------------|-------------|
| **N connections** | Número de filas |
| **Add connection** | Crear (o Catalog → **Use**) |
| **Name** | Etiqueta de la instancia |
| **System** | Tipo de catálogo |
| **Status** | Pending / Disabled / Connected / Error / Unknown |
| **Adapter** | `native` / `http` / `mcp` |
| **Last check / Error** | Última prueba / mensaje de error |
| **Source** | **User** / **Agent** / **System** |
| **Test / Edit / Delete** | Probar / editar / eliminar |

---

## Formulario

| Campo | Significado |
|-------|-------------|
| **Name** | Nombre visible |
| **System type** | Entrada del catálogo |
| **Configuration** | Campos no secretos (URL, db, org, …) |
| **Secrets** | Campos sensibles en el vault como `conn-{id}-{field}` — *no se vuelven a mostrar tras guardar* |
| **Save / Cancel** | Guardar / descartar |

---

## Tipos del catálogo

Odoo (native) · GitHub / GitLab · Linear · Notion · Jira · Slack (API) · **MCP server** (enlace a [MCP](/docs/es/ai/mcp/)) · Custom HTTP.

---

## Herramientas de agente

`connections_list` · `connections_catalog` · `connections_test` · `connections_propose`.

## Relacionado

- [Secretos](/docs/es/admin/secrets/)
- [Servidores MCP](/docs/es/ai/mcp/)
- [Herramientas](/docs/es/automation/tools/)
