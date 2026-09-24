---
title: Asistente proactivo
description: Alertas por heartbeat, insights y lecciones — el asistente que saca el trabajo a la superficie.
---

**Para qué sirve.** El asistente proactivo vigila el trabajo que te necesita: conversaciones vencidas, hilos stale, anomalías, oportunidades, recordatorios. No sustituye Tablero ni Inicio. El mosaico **Atención** puede mostrar las mismas alertas; aquí está la lista completa más **Lecciones aprendidas**. Deja el heartbeat **apagado** hasta entender aprobación y coste.

**Ruta:** `/proactive`. Barra: **Proactivo**.

## Cuándo usarlo

- Un toque cuando el trabajo está overdue o stale.
- **Heartbeat proactivo** en Autonomía y necesitas la superficie de operador.
- **Comprobar ahora** en vez del siguiente heartbeat.
- Lecciones de alertas anteriores.

## Flujo típico

1. Activa el heartbeat en [Autonomía](/docs/es/agents/autonomy/) solo si quieres gasto en segundo plano.
2. **Proactivo** (`/proactive`).
3. **Alertas activas**. Prioridad **Urgente / Alta / Normal / Baja**.
4. **Comprobar ahora**. Vacío: *Todo en orden — no hay alertas activas*.
5. **Lecciones aprendidas** (confianza %).

**El texto del resumen** lo escribe el modelo en segundo plano de EYAS en una llamada aislada: el nivel de enrutado **Heartbeat** (primario, luego fallback), luego el valor por defecto de la instalación, luego los proveedores de API, luego las CLIs que pueden hacer llamadas aisladas — nunca un proveedor que el gateway elija por su cuenta, ni una CLI que corre con sus propias herramientas y memoria. Cuando ningún modelo cumple (por ejemplo, una instalación solo con Grok o solo con Kimi antes de verificar su aislamiento) o el presupuesto está en *stop*, EYAS no hace ninguna llamada al modelo y envía el aviso fijo *Heartbeat: items may need your attention* con la lista de motivos. Ver [Enrutado y presupuesto — El modelo en segundo plano](/docs/es/ai/routing-budget/#background-model).

**Las ejecuciones en segundo plano reciben la misma memoria que el chat.** Cuando el heartbeat o una tarjeta del tablero lanza una ejecución en segundo plano, esa ejecución recibe el mismo bloque de memoria recordada, con la fecha y la hora actuales, que un turno de chat (ver [Memoria — Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model)). El objetivo de una tarjeta también se recuerda — una vez por objetivo distinto, por muchas veces que se reintente la ejecución — como texto escrito por EYAS, no por ti.

**Un único ejecutor para las ejecuciones en segundo plano.** Las tarjetas en etapas bot-listen o de auto-asignación, y las tarjetas de `assign_task`, se ejecutan con la misma configuración que un reintento de la misma tarjeta, una [rutina de agente programada](/docs/es/automation/scheduler/#agent-routines-run-in-a-conversation) y un colega arrancado por un traspaso: supervisadas, autónomas y controladas por la escala de autonomía, con el modelo de la tarjeta, con recall de memoria, diseños adjuntos, documentos, captura de memoria duradera y el crítico de completitud. Las ejecuciones del tablero reciben ahora también diseños, documentos y captura de memoria duradera, que antes les faltaban. Una tarjeta en segundo plano toma siempre su proveedor y su modelo de un único binding, nunca el proveedor de una tarjeta combinado con el modelo de un agente de otro proveedor.

Señales SLA: **Overdue**, **Stale**.

## Relacionado

- [Autonomía](/docs/es/agents/autonomy/)
- [Inicio](/docs/es/daily/home/)
- [Conversaciones](/docs/es/daily/conversations/)
- [Autoaprendizaje](/docs/es/automation/self-learning/)
- [Programador](/docs/es/automation/scheduler/)
