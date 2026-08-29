---
title: Observabilidad y ops
description: Telemetría de tokens, trazas, coste, carreras de Modo Dios y coste de contexto del prompt.
---

**Para qué sirve.** Observabilidad (`/observability`) es la superficie de telemetría de esta instancia: trazas, coste, latencia, anomalías, carreras de conjunto (Modo Dios) y lo que el modelo recibió de verdad. **Ops** (`/ops`) es remediación. Manos, nodos remotos, extensiones y preferencias de notificación **no** están en esta página — tienen capítulos propios.

| Área | Ruta | Significado |
|------|------|-------------|
| Observability | `/observability` | Métricas / tracing — pestañas **Usage**, **God Mode**, **Contexto** |
| Ops | `/ops` | Ops / remediation |

En otro sitio (no esta página): [Manos](/docs/es/admin/hands/) (`/hands`), [Nodos remotos](/docs/es/admin/nodes/) (`/nodes`) — incluido invoke SSH vigilado, [Ingress](/docs/es/admin/ingress/) (`/ingress`), [Extensiones](/docs/es/admin/extensions/) (`/extensions`), [Notificaciones](/docs/es/admin/notifications/) (`/notifications-settings`).

### Pestaña Usage

**Usage** es telemetría de tokens: **Total Traces**, **Total Cost**, **Avg Latency**, **Anomalies**, coste diario, distribución de modelos y la tabla de trazas (marca de tiempo, modelo, proveedor, tokens, coste, latencia, herramientas, calidad).

### Pestaña God Mode

`/observability` tiene tres pestañas: **Usage** (trazas / estadísticas existentes), **God Mode** y **Contexto**. La pestaña God Mode lista las ejecuciones de conjunto (conversación, ganador, número de modelos, coste, duración, desempate), la tasa de victorias por modelo y el múltiplo medio de coste frente a un solo modelo. Al pulsar una ejecución se abre la pestaña God de esa conversación (registro de pasos, quién votó a quién, revisión cruzada).

Plantilla, reglas de decisión y pestaña God: [Conversaciones — Modo Dios](/docs/es/daily/conversations/#modo-dios).

### Pestaña Contexto

La pestaña **Contexto** responde a una pregunta que hasta ahora nada podía responder: qué recibió *realmente* el modelo, no qué se pretendía enviar. Muestra el coste medio y máximo de tokens por sección del prompt (y sobre cuántas muestras se calcula), la frecuencia de truncamiento (con qué frecuencia, y qué sección, se recorta para caber en el presupuesto), y estimado vs. real: la diferencia entre la estimación de tokens y lo que reportó el proveedor — algo que hasta ahora nadie podía medir.

Los registros detallados por sección tienen una retención corta (7 días por defecto); a largo plazo solo sobrevive el resumen diario. Si buscas un detalle antiguo y no lo encuentras, es porque se eliminó a propósito, no porque se haya perdido.

## Relacionado

[Mission Control](/docs/es/agents/runs/) · [Seguridad](/docs/es/admin/security-privacy/) · [Resumen de ajustes](/docs/es/admin/settings/) · [Manos](/docs/es/admin/hands/) · [Nodos remotos](/docs/es/admin/nodes/) · [Extensiones](/docs/es/admin/extensions/) · [Notificaciones](/docs/es/admin/notifications/)
