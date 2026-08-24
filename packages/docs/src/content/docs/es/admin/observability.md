---
title: Observabilidad y ops
description: Métricas, ops, hands, nodes (SSH), ingress.
---

| Área | Ruta | Significado |
|------|------|-------------|
| Observability | `/observability` | Métricas / tracing |
| Ops | `/ops` | Ops / remediation |
| Hands | `/hands` | Computer-use hub |
| Nodes | `/nodes` | Nodos remotos — **SSH invoke** con guardia destructiva |
| [Ingress](/docs/es/admin/ingress/) | `/ingress` | Túnel / acceso remoto |
| Extensions | `/extensions` | Catálogo de extensiones |
| Notifications | `/notifications-settings` | Canales de notificación |

### Pestaña God Mode

`/observability` tiene dos pestañas: **Usage** (trazas / estadísticas existentes) y **God Mode**. La pestaña God Mode lista las ejecuciones de conjunto (conversación, ganador, número de modelos, coste, duración, desempate), la tasa de victorias por modelo y el múltiplo medio de coste frente a un solo modelo. Al pulsar una ejecución se abre la pestaña God de esa conversación (registro de pasos, quién votó a quién, revisión cruzada).

Plantilla, reglas de decisión y pestaña God: [Conversaciones — Modo Dios](/docs/es/daily/conversations/#modo-dios).

## Relacionado

[Mission Control](/docs/es/agents/runs/) · [Seguridad](/docs/es/admin/security-privacy/)
