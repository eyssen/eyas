---
title: Autonomía
description: Cuánto pueden hacer los agentes sin preguntar — cola de aprobaciones y tres niveles.
---

**Para qué sirve.** La autonomía es el dial de seguridad. Por clase de acción eliges **Aviso** (preguntar primero), **Aprobar** (propuesta + un clic) o **Auto** (hacerlo e informar después). Las acciones salientes e irreversibles quedan bloqueadas en Aviso. La misma página es la cola de **Aprobaciones pendientes** que aparca una ejecución hasta que decides.

## Cuándo usarlo

- Una conversación está **Waiting approval** y necesitas **Aprobar** o **Rechazar** sin adivinar qué está aparcado.
- El trabajo reversible (edits de archivo, investigación) en **Auto**, pero nunca subir una clase saliente bloqueada.
- Un resume falló después de que ya aprobaste — la fila atascada aún te necesita.
- Encender o apagar heartbeats, propuestas Forge o identity self-update como flags.

## Flujo típico

1. Abre **Autonomía** en la barra lateral (**Monitorización**) — ruta `/autonomy`. Los flags viven en **Ajustes → Sistema** (tarjeta Autonomy features).
2. Lee **Aprobaciones pendientes**. En cada fila, **Aprobar** o **Rechazar**. **Ejecución en espera** lleva a la conversación.
3. En **Reversible**, pon una categoría en **Aviso / Aprobar / Auto** (las bloqueadas no suben de Aviso).
4. La ejecución aparcada debe reanudar (o quedarse parada si rechazas). Inicio **Requiere atención** y el badge **Waiting approval** deben desaparecer.

## Funciones

Niveles: **Aviso** · **Aprobar** · **Auto**. Grupos: **Reversible** y **Saliente / irreversible (bloqueado)**. Vacío: *No hay nada esperando aprobación.*

Flags (off por defecto): heartbeat, reflection, Forge, self-learning, identity self-update. YAML: `autonomy.identitySelfUpdate`. Aprobaciones también en Inicio y en la conversación.

## Relacionado

- [Inicio](/docs/es/daily/home/)
- [Forge](/docs/es/agents/forge/)
- [Asistente proactivo](/docs/es/automation/proactive/)
