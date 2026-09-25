---
title: Autonomía
description: Define cuánto pueden hacer los agentes sin preguntar — cola de aprobaciones y tres niveles.
---

**Para qué sirve.** La autonomía es el regulador de seguridad. Para cada clase de acción eliges **Aviso** (preguntar primero), **Aprobar** (propuesta + un clic) o **Auto** (hacerlo e informar). Las acciones salientes e irreversibles quedan bloqueadas en Aviso. La misma página es la cola de **Aprobaciones pendientes**, que aparca una ejecución hasta que decides.

## Cuándo usarlo

- Una conversación está **Esperando aprobación** y necesitas **Aprobar** o **Rechazar** sin adivinar qué está aparcado.
- Quieres que el trabajo reversible (edición de archivos, investigación) vaya en **Auto**, pero nunca subir una clase saliente bloqueada.
- Una reanudación falló después de que ya aprobaras — la fila atascada todavía te necesita.
- Quieres activar o desactivar los bucles de automejora en segundo plano (latido proactivo, reflexión nocturna, propuestas de Forge, autoaprendizaje, adopción de habilidades).

## Flujo típico

1. Abre **Autonomía** en la barra lateral (sección **Monitorización**) — ruta `/autonomy`. Los bucles de automejora están en **Ajustes → Sistema**, tarjeta **Autonomía y automejora**.
2. Lee **Aprobaciones pendientes**. En cada fila, **Aprobar** o **Rechazar**. Sigue **Ejecución en espera** hasta la conversación si necesitas contexto.
3. En **Reversible**, pon una categoría en **Aviso / Aprobar / Auto** (las categorías bloqueadas no pueden pasar de Aviso).
4. La ejecución aparcada se reanuda (o se queda detenida si rechazas). **Requiere atención** en Inicio y el distintivo **Esperando aprobación** de la conversación desaparecen.

## Funciones

La autonomía controla el comportamiento **desatendido**: cuánto puede hacer un agente por clase de acción y qué requiere **aprobación humana**.

## Principios

1. Los bucles de automejora en segundo plano están **desactivados por defecto**; activarlos es decisión tuya.
2. Las aprobaciones aparecen en **Requiere atención** de Inicio y como distintivo **Esperando aprobación** en la conversación.
3. Que un agente pueda editar directamente su propia IDENTITY es un ajuste YAML: `autonomy.identitySelfUpdate` (activado por defecto). Si está desactivado, los cambios de identidad pasan por propuestas de Forge.

## Cola de aprobaciones y niveles

**Ruta:** `/autonomy`. El subtítulo explica que las acciones irreversibles / salientes están bloqueadas en **Aviso** y no se pueden aumentar: un límite de seguridad.

### Aprobaciones pendientes

| Control | Significado |
|---------|-------------|
| **Aprobaciones pendientes** | Cola de solicitudes aparcadas |
| *No hay nada esperando aprobación.* | Cola vacía |
| Categoría · herramienta | Qué se pide |
| Motivo | Por qué saltó la puerta |
| **Ejecución en espera** | Enlace a la ejecución / conversación aparcada |
| **Aprobar / Rechazar** | Decidir — aprobar intenta reanudar la ejecución |
| *No se pudo reanudar: …* | La aprobación ya está decidida, pero la ejecución no se reinició (reanudación atascada) |

**Qué llega a la cola.** Una llamada a herramienta amarilla o roja espera aquí cuando la puerta de seguridad pide una persona, con todos los proveedores — incluidas las llamadas que una CLI (Claude Code, Grok, Kimi) quiere hacer con sus propias herramientas, y las herramientas de EYAS que Grok o Kimi llaman por el puente de herramientas. En una ejecución autónoma supervisada, esa aprobación pausa la ejecución (**Esperando aprobación**); una vez aprobada, la ejecución se reanuda y se permite exactamente una vez la llamada aprobada.

**Los mismos veredictos con todos los proveedores.** Las herramientas de EYAS a las que Grok y Kimi llegan por el puente de herramientas se deciden exactamente igual que en los proveedores de API y en Claude Code. En un chat que estás atendiendo, o en una conversación de canal, una llamada que la puerta permite se ejecuta: los niveles de esta página no se aplican a los chats atendidos, y una herramienta marcada como que requiere aprobación ya no espera aquí solo porque el modelo sea Grok o Kimi. En las ejecuciones en segundo plano (programadas, de equipo, de pipeline o cualquier ejecución no marcada como atendida) se aplican los niveles: una llamada de una categoría en **Aviso** o **Aprobar** espera aquí, y una llamada que la puerta escala siempre espera a una persona, aunque su categoría esté en **Auto** — antes, una llamada así se ejecutaba sin preguntar en Grok y Kimi. Una herramienta fuera de la lista de **Herramientas** del agente se rechaza antes de preguntar a la puerta, así que nunca llega aquí. Cuando la comprobación con IA de la puerta no puede ejecutarse — no hay modelo de segundo plano elegible, el presupuesto está detenido o todos los intentos fallan —, la llamada se escala aquí en lugar de bloquearse (ver [Seguridad y privacidad — Juez de seguridad](/docs/es/admin/security-privacy/#security-judge)).

**Un comando de shell que pide salir del sandbox.** Con `security.cliSandbox: auto`, Claude Code puede pedir ejecutar un comando fuera del sandbox de archivos del kernel (por ejemplo, uno que necesita `~/.npm`). Ese comando siempre llega aquí y espera a una persona — nunca al juez de IA, nunca a la escala de autonomía, sea cual sea el nivel de la categoría. Su motivo dice: *Un comando de shell pidió ejecutarse fuera del sandbox de archivos del kernel. Solo una persona puede permitirlo; aprobarlo deja que exactamente este comando se ejecute una vez sin sandbox.* Las ejecuciones autónomas se aparcan en él. Ver [Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox).

**Decidir desde la conversación.** Una llamada que espera aprobación se muestra como *Requiere aprobación*, nunca como correcta, y en la conversación aparece una tarjeta de aprobación con **Aprobar**, **Rechazar** y **Abrir aprobaciones**. La tarjeta usa el mismo permiso que esta cola (aprobar en Autonomía); a un usuario sin él se le indica que un owner o un admin puede decidirla aquí. Ver [Conversaciones — Aprobaciones en el chat](/docs/es/daily/conversations/#approvals-in-the-chat).

### Niveles (por categoría)

| Nivel | Etiqueta | Pista |
|-------|----------|-------|
| 1 | **Aviso** | Preguntar primero |
| 2 | **Aprobar** | Propuesta + aprobación con un clic |
| 3 | **Auto** | Autónomo + informe posterior |

Las categorías se dividen en **Reversible** (puedes subir el nivel) y **Saliente / irreversible (bloqueado)** (no puede pasar de Aviso: un límite de seguridad).

## Ajustes (tarjeta Autonomía y automejora)

**Ajustes → Sistema** tiene la tarjeta **Autonomía y automejora**. Cada bucle activado hace llamadas de pago a modelos de forma programada (o al activarse), y todos están desactivados por defecto:

| Interruptor | Significado |
|-------------|-------------|
| **Latido proactivo** | Elabora resúmenes proactivos cuando algo requiere tu atención |
| **Reflexión nocturna** | Una pasada nocturna de autorreflexión que detecta mejoras en el funcionamiento del asistente |
| **Propuestas de Forge** | Propone mejoras de herramientas o habilidades aprendidas de la fricción — sigue necesitando tu aprobación |
| **Autoaprendizaje** | Propone ajustes de prompt o enrutamiento aprendidos de las métricas de uso — sigue necesitando tu aprobación |
| **Adopción de habilidades** | Propone habilidades nuevas aprendidas de patrones repetidos — sigue necesitando tu aprobación |

Cada interruptor es solo un indicador de función — no borra datos. Para cambiarlo hace falta el permiso **update Autonomy**.

## Superficies del panel

| Superficie | Significado |
|------------|-------------|
| Elemento de configuración de Inicio **Autonomía y auto-mejora** | Explicación para activarlo + enlace a la tarjeta de ajustes |
| Inicio **Requiere atención** | Aprobaciones pendientes y reanudaciones atascadas |
| Conversación **Esperando aprobación** | Ejecución bloqueada esperándote |
| Telegram **Approve / Deny** | La misma vía de decisión que esta cola, para herramientas amarillas/rojas. El aviso va a la asignación de Telegram del hilo o, si no la hay, a un emparejamiento aprobado. Sin argumentos crudos de la herramienta. Ver [Telegram](/docs/es/communication/telegram/) |

## Relacionado

- [Inicio](/docs/es/daily/home/)
- [Forge](/docs/es/agents/forge/)
- [Asistente proactivo](/docs/es/automation/proactive/)
- [Seguridad y privacidad](/docs/es/admin/security-privacy/)
- [Telegram](/docs/es/communication/telegram/)
