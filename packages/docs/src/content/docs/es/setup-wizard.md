---
title: Asistente de configuración
description: Asistente del primer arranque — cada paso, campo y control explicado.
---

**Para qué sirve.** Solo en el primer arranque. El asistente crea la contraseña maestra, el propietario principal, tus dos agentes principales y un primer backend de modelos para que la aplicación principal se desbloquee. Después, cambia esas cosas en **Ajustes**, **Proveedores** y **Agentes** — no cuentes con volver a ejecutar el asistente.

## Cuándo usarlo

- El navegador te envió a `/setup` porque la configuración está incompleta
- Te saltaste un paso opcional y quieres la lista de campos
- Estás restaurando una instancia nueva

No sirve para cambios del día a día una vez abierta la aplicación.

## Flujo típico

El asistente se ejecuta **una vez** mientras la configuración está incompleta. El navegador se redirige a `/setup` hasta que terminan los pasos obligatorios. Los pasos opcionales se pueden omitir y completar más tarde en Ajustes.

Controles en todos los pasos:

| Control | Significado |
|---------|-------------|
| **Idioma** | Idioma de la interfaz (`en` / `hu` / `de` / `es` / `fr` / `tlh`). Se guarda en el ajuste de idioma del navegador. |
| **Apariencia** | Plantilla de tema (p. ej. Halo, Nebula) + interruptor claro/oscuro. |
| *Paso N de M* | Avance por los pasos pendientes. |
| **Continuar / Finalizar configuración** | Enviar el paso actual y avanzar. |

## Orden de los pasos (típico)

| Orden | Paso | Obligatorio | Módulo |
|------:|------|-------------|--------|
| — | Apariencia / idioma (marco de la interfaz) | — | frontend |
| 1 | **Contraseña maestra** | Sí | secrets |
| 2 | **Propietario principal** | Sí | auth |
| 3 | Agentes principales (*Tus dos compañeros de IA siempre activos*) | Sí | auth |
| 4 | **Agentes de equipo** | No | auth |
| 5 | **Proveedor de IA** | Normalmente | model |
| 6 | **Modelos de IA** | Normalmente | model |

El registro es modular — los módulos registran sus pasos al arrancar. Los pasos obligatorios deben completarse antes de que se desbloquee la aplicación principal.

## Contraseña maestra

**Propósito:** cifrar en reposo todos los secretos guardados (claves de API, tokens).

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| **Contraseña maestra** | Sí | Frase de paso para el material de clave del cifrado de secretos. Elige algo fuerte; si la pierdes, tendrás que volver a introducir las claves de los proveedores. |
| **Confirmar contraseña** | Sí | Debe coincidir con la contraseña maestra. |

Tras este paso, los secretos introducidos desde la interfaz pasan por el almacén cifrado de Secrets.

## Propietario principal

**Propósito:** crear al administrador humano principal (`role: owner`, `is_root_owner`).

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| **Nombre de usuario** | Sí | Nombre de inicio de sesión (marcador: `admin`). Debe ser único. |
| **Contraseña** | Sí | Contraseña de la cuenta (con hash; nunca se guarda en texto plano). |
| **Nombre visible** | No | Nombre amable en la interfaz (si está vacío, el nombre de usuario). |

El asistente mantiene las credenciales del owner **en memoria** durante el resto de la sesión, para que los pasos opcionales que necesitan un owner autenticado se ejecuten sin volver a iniciar sesión. Si recargas a mitad del asistente y solo quedan pasos opcionales, puede que vayas a **Iniciar sesión** y luego de vuelta a `/setup`.

## Agentes principales

**Propósito:** crear los dos **colegas** siempre disponibles con los que hablas (barra lateral **Colegas**, un hilo propio cada uno). En pantalla: *Tus dos compañeros de IA siempre activos*.

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| **Asistente personal — tu compañero de IA del día a día** | Sí | Nombre visible de tu agente del día a día (p. ej. Jarvis). Nivel: principal, tipo: asistente. Vinculado al tipo de proyecto **general**. |
| **Ingeniero de sistemas — mantiene sano el propio EYAS** | Sí | Nombre visible del agente que mantiene el propio EYAS (p. ej. R2D2). Nivel: principal, tipo: ingeniero. Vinculado al tipo de proyecto **eyas**. |

Para cada uno se crea:

- una fila en `agent_definitions` (modelo, herramientas, ruta del espacio de trabajo, …)
- un árbol de espacio de trabajo en `data/agents/<id>/` (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- un registro vinculado de **usuario agente** (`is_agent = 1`) para permisos y direccionamiento

Puedes renombrarlos y reconfigurarlos más tarde en **Agentes**. Tras el asistente, ábrelos desde la lista **Colegas** de la barra lateral. El Asistente coordina y no edita código fuente; el Ingeniero se encarga de la plataforma y el código. Ver [Equipos y delegación](/docs/es/agents/teams/).

## Agentes de equipo (opcional)

**Propósito:** activar **colegas** adicionales (nivel equipo) y **especialistas** (grupo compartido que cualquier colega puede lanzar). Los agentes principales no necesitan tarjeta de propuesta para llamar a un especialista activado.

| Control | Descripción |
|---------|-------------|
| **Recomendados** | Conjunto de plantillas destacado para una instalación típica. |
| **Especialistas** | Catálogo completo de plantillas de agente opcionales. |
| **Seleccionar todo / Deseleccionar todo** | Selección en bloque. |
| *N seleccionados* | Número de plantillas elegidas. |
| **Omitir / Continuar** | Terminar sin especialistas, o aplicar la selección. |

La selección se guarda como ids de plantilla y se convierte en agentes reales (con el mismo patrón de espacio de trabajo que los principales). Cámbiala más tarde en **Ajustes → Agentes**.

## Proveedor de IA

**Propósito:** asegurar que haya al menos un backend de modelos disponible.

### CLI del equipo anfitrión (si se detectan)

| Control | Descripción |
|---------|-------------|
| Distintivo (*Claude Code detectado y configurado* / *Grok CLI …* / *Kimi Code CLI …*) | CLI local encontrada y utilizable — **sin clave de API**. En Claude, *detectado y configurado* significa que el entorno de Claude Code arranca **y tiene la sesión iniciada** (inicio de sesión de claude.ai, `ANTHROPIC_API_KEY` o una configuración de Bedrock/Vertex); que `claude` esté en el PATH no basta. Ver [Proveedores — Entorno de Claude Code](/docs/es/ai/providers/#claude-code-runtime). |
| **Iniciar sesión para EYAS** (Grok / Kimi) | Aparece siempre que se detecta Grok CLI o Kimi Code CLI. EYAS ejecuta estas CLI en su propio directorio y no usa su inicio de sesión en este equipo, así que inicia sesión una vez para EYAS aquí: **Iniciar sesión con un código de dispositivo** (ambas) — abre el enlace en cualquier dispositivo y confirma el código, sin navegador en el servidor — o **Usar una clave de API en su lugar** (Grok, una clave de API de xAI). Ver [Proveedores — Iniciar sesión en Grok y Kimi para EYAS](/docs/es/ai/providers/#sign-in-grok-and-kimi-for-eyas). |
| **CLI principal** | Aparece cuando se detectan varias CLI: cuál es la predeterminada para agentes y enrutamiento. Pasa a ser el proveedor y el modelo predeterminados de la instalación, que también responden a las llamadas internas que no nombran modelo cuando no hay nivel Estándar configurado — ver [Enrutado y presupuesto](/docs/es/ai/routing-budget/#default-binding). |
| **Usar otro proveedor** | Cambiar a la configuración de una API en la nube o local. |
| **Volver a los CLI detectados** | Volver a la vista de CLI. |

### Proveedores manuales / de API

| Control | Descripción |
|---------|-------------|
| Lista de proveedores | Backends conocidos (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Activo / Inactivo** | Si el proveedor está activado para el enrutamiento. |
| **Configurar / Cambiar clave** | Abrir la entrada de la clave de API. |
| Campo de clave de API (*Introduce la clave de API…*) | Secreto; se guarda en el almacén cifrado de Secrets. |
| **Guardar** | Guardar la clave y dejar el proveedor utilizable. |
| **Volver a comprobar** | Volver a sondear un endpoint local (p. ej. la URL de Ollama). |
| **Continuar / Finalizar configuración** | Avanzar aunque no haya ninguno activo (puedes terminar después en Ajustes → Proveedores) — ver la nota en pantalla. |

## Modelos de IA

**Propósito:** asignar un modelo concreto a cada agente cuando un proveedor está listo.

| Control | Descripción |
|---------|-------------|
| Columna **Agente** | Nombre del agente de los pasos anteriores. |
| Columna **Modelo** | Desplegable con los modelos de los proveedores activos, cada uno como *Proveedor / modelo* (el más adecuado preseleccionado); **— ninguno —** deja el modelo del agente como está. |
| **Aplicar** | Guardar las asignaciones. Cada una se envía y se guarda como el par proveedor + modelo que elegiste, así que un id de modelo que listan dos proveedores nunca es ambiguo; un par que no está en el catálogo de modelos se omite. |
| **Ir a Proveedores** | Saltar a la página completa de Proveedores si no hay nada configurado. |
| **Finalizar configuración** | Terminar el asistente y entrar en la aplicación principal. |

Si no se detecta ningún proveedor (*No se detectó ningún proveedor de IA*), configura uno en la página de Proveedores después del asistente.

## Después del asistente

| Destino | Por qué |
|---------|---------|
| [Tu primera hora](/docs/es/first-hour/) | Recorre la interfaz en vivo: Inicio, una conversación, Tablero, Memoria |
| [Inicio](/docs/es/daily/home/) | Recomendaciones de configuración para el trabajo opcional pendiente |
| [Proveedores](/docs/es/ai/providers/) | Añadir más backends, claves, modelos |
| [Agentes](/docs/es/agents/overview/) | Revisar colegas y especialistas |
| [Equipos y delegación](/docs/es/agents/teams/) | Cómo los colegas traspasan trabajo y lanzan especialistas |
| [Usuarios](/docs/es/admin/users/) | Añadir usuarios humanos (si es multiusuario) |

## Notas de seguridad

- La contraseña maestra protege los **secretos**; por sí sola no cifra el archivo SQLite en reposo — protege el disco del equipo y las copias de seguridad.
- La contraseña del propietario principal es independiente de la contraseña maestra.
- Los «usuarios» agente no son inicios de sesión interactivos para personas; existen para la identidad y el control de acceso.
