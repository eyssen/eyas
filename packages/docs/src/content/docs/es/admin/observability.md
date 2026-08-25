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

`/observability` tiene tres pestañas: **Usage** (trazas / estadísticas existentes), **God Mode** y **Contexto**. La pestaña God Mode lista las ejecuciones de conjunto (conversación, ganador, número de modelos, coste, duración, desempate), la tasa de victorias por modelo y el múltiplo medio de coste frente a un solo modelo. Al pulsar una ejecución se abre la pestaña God de esa conversación (registro de pasos, quién votó a quién, revisión cruzada).

Plantilla, reglas de decisión y pestaña God: [Conversaciones — Modo Dios](/docs/es/daily/conversations/#modo-dios).

### Pestaña Contexto

La pestaña **Contexto** responde a una pregunta que hasta ahora nada podía responder: qué recibió *realmente* el modelo, no qué se pretendía enviar. Muestra el coste medio y máximo de tokens por sección del prompt (y sobre cuántas muestras se calcula), la frecuencia de truncamiento (con qué frecuencia, y qué sección, se recorta para caber en el presupuesto), y estimado vs. real: la diferencia entre la estimación de tokens y lo que reportó el proveedor — algo que hasta ahora nadie podía medir.

Los registros detallados por sección tienen una retención corta (7 días por defecto); a largo plazo solo sobrevive el resumen diario. Si buscas un detalle antiguo y no lo encuentras, es porque se eliminó a propósito, no porque se haya perdido.

## Relacionado

[Mission Control](/docs/es/agents/runs/) · [Seguridad](/docs/es/admin/security-privacy/)
