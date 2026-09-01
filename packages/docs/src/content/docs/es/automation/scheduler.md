---
title: Programador
description: Trabajos recurrentes, rutinas de agente, calendario y Gantt, y los que no pueden ejecutarse.
---

**Para qué sirve.** El programador es el reloj: handlers de sistema y rutinas de agente. Creas trabajos, ves last/next y cazas los que nunca disparan. No es el Tablero.

**Ruta:** `/scheduler`. Barra: **Programador**.

## Cuándo usarlo

- Un agente debe correr un prompt cada mañana sin conversación.
- Backup en cron, last/next visible.
- Un trabajo está parado — badge **Sin handler / Nunca dispara / No programado**.
- Liderazgo de clúster, overdue, dead-letter.

## Flujo típico

1. **Programador** (`/scheduler`).
2. **Lista / Gantt / Calendario**. Zoom **Día / Semana / Mes**.
3. **Crear trabajo** — tipo **Handler de sistema** / **Rutina de agente**, trigger **Cron / Intervalo / Evento**.
4. Franja de salud. Badge cannot-run: hover para la causa.
5. **Ejecutar ahora** (único camino para Evento). **Pausa / Reanudar**, **Reprogramar**.

Cron inválido o intervalo &lt; 1 s se rechaza al crear. **Evento** se acepta pero no dispara solo — **Nunca dispara**. **Mostrar trabajos de infraestructura** no oculta un trabajo roto.

## Relacionado

- [CLI / config](/docs/es/deploy/configuration/)
- [Agentes](/docs/es/agents/overview/)
- [Copia de seguridad](/docs/es/admin/backup/)
- [Inicio](/docs/es/daily/home/)
