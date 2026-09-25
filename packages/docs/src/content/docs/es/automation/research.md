---
title: Investigación
description: Lanza un trabajo superficial o profundo, sigue el estado y lee el informe más las fuentes.
---

**Para qué sirve.** Investigación ejecuta un trabajo de búsqueda web a partir de una pregunta o tema, evalúa fuentes y escribe un informe estructurado que puedes abrir después. Los agentes pueden reutilizar el resultado. Úsalo cuando quieras un briefing con fuentes en lugar de un solo turno de chat. Superficial es más rápido; profundo expande más consultas y retiene más fuentes.

## Cuándo usarlo

- Quieres un informe con URLs citadas, no solo una respuesta del modelo.
- Necesitas un pase rápido (**Superficial (más rápida)**) o uno más amplio (**Profunda (exhaustiva)**).
- Quieres ver un trabajo pasar por **Pendiente** → **Buscando** → **Evaluando** → **Sintetizando** → **Completa**.
- Un trabajo falló y necesitas el texto de error a la derecha.

## Flujo típico

1. Abre **Investigación** en la barra lateral (`/research`).
2. En **Nueva investigación**, escribe un tema (marcador *Introduce el tema de investigación…*).
3. Elige **Superficial (más rápida)** o **Profunda (exhaustiva)**.
4. **Investigar**. El trabajo aparece en la lista izquierda y queda seleccionado.
5. Espera mientras el panel derecho muestra **Investigando…** y el estado actual. Los trabajos activos se refrescan unos cada dos segundos.
6. En **Completa**, lee las secciones y **Fuentes**. Un clic en el título de la fuente abre la URL.

Lista vacía: *Aún no hay informes de investigación*. Sin selección: *Selecciona un informe o inicia una nueva investigación*.

## Funciones

Los trabajos empiezan **Pendiente**, luego **Buscando** (expansión de consultas + búsqueda web), **Evaluando** (relevancia), **Sintetizando** (secciones + cruce), después **Completa** o **Error**.

**Qué modelo hace el trabajo.** La expansión de consultas, la puntuación de fuentes, la redacción de secciones y el cruce corren en el modelo en segundo plano de EYAS: primero el nivel de enrutado **Standard**, luego el modelo por defecto, luego los proveedores de API, luego las CLIs que pueden hacer llamadas aisladas — nunca el proveedor que el gateway elija al azar. Cada llamada es una llamada única y aislada (sin herramientas, sin memoria del proveedor ni del host, un turno), aparece en el tracing y cuenta para el presupuesto. Ver [Enrutado y presupuesto — El modelo en segundo plano](/docs/es/ai/routing-budget/#background-model).

**El contenido web es un dato, no una instrucción.** Los títulos de búsqueda, fragmentos, URLs, extractos de página y las secciones que el modelo escribió a partir de ellos se pasan al modelo dentro de un bloque delimitado con su propio marcador aleatorio en cada llamada. Al modelo se le dice que lo que hay dentro es un dato, nunca una instrucción, así que una página hostil no puede cerrar el bloque ni dar órdenes.

**Informes sin modelo.** Un informe se completa aunque ningún modelo en segundo plano pueda escribirlo: ningún proveedor puede hacer llamadas aisladas en segundo plano (por ejemplo, una instalación solo con Grok o solo con Kimi antes de verificar su aislamiento), el presupuesto está detenido, o la llamada al modelo falló o devolvió una respuesta inservible. Entonces solo se busca el tema original; las fuentes se ordenan por el orden de búsqueda (se conservan las primeras); el cuerpo tiene una sección por fuente principal con su título, fragmento y URL; no hay cruce; y las páginas no se descargan cuando no hay modelo. Ese informe muestra un aviso sobre las secciones: *Elaborado sin modelo: ningún modelo en segundo plano pudo sintetizar este informe (ninguno puede ejecutar llamadas aisladas en segundo plano, el presupuesto está detenido o la llamada falló), así que se listan las fuentes principales con sus fragmentos.* La herramienta de agente `research` devuelve `degraded: true` para esos informes. Antes, un fallo del modelo terminaba el trabajo como **Error**. Los informes existentes no cambian.

**Superficial** expande menos consultas relacionadas y retiene menos aciertos; **Profunda** expande más, pide más resultados por consulta y retiene más fuentes con relevancia de al menos 0,5.

La búsqueda usa Brave si existe el secreto `brave-search-api-key`; si no, un proveedor simulado (vale para comprobar la UI, no para la web real). Guarda la clave en [Secretos](/docs/es/admin/secrets/).

Un informe terminado muestra la consulta como título, **Completa**, profundidad (*superficial* / *profunda*), recuento de fuentes y hora de fin. El cuerpo son **secciones** escritas por el modelo (título + prosa). **Fuentes** lista `[n]` título (enlace) y **N % relevante**.

Los fallos — los que no son del modelo, por ejemplo de la propia búsqueda — muestran **La investigación falló** y el texto de error. En esta página no hay borrar ni exportar.

## Campos y controles

<h2 id="new-job">Nueva investigación</h2>

| Control | Significado |
|---------|-------------|
| **Nueva investigación** | Encabezado del formulario |
| Campo de tema | Marcador *Introduce el tema de investigación…* |
| Profundidad | **Superficial (más rápida)** o **Profunda (exhaustiva)** |
| **Investigar** | Lanzar el trabajo (desactivado si está vacío o se está enviando) |

<h2 id="statuses">Lista y estados</h2>

| Control | Significado |
|---------|-------------|
| Lista izquierda | Consulta, insignia de estado, fecha de creación. Clic carga el informe |
| **Pendiente** | En cola, aún no busca |
| **Buscando** | Expansión de consultas y búsqueda web |
| **Evaluando** | Puntuar y filtrar fuentes |
| **Sintetizando** | Escribir y cruzar secciones |
| **Completa** | Informe listo |
| **Error** | El flujo falló (un fallo del modelo ya no termina así el trabajo — el informe se completa sin modelo) |

<h2 id="report">Panel del informe</h2>

| Control | Significado |
|---------|-------------|
| **Investigando…** | Marcador en curso con la insignia de estado actual |
| **La investigación falló** | Título de error; el cuerpo es el texto |
| Profundidad / recuento de fuentes / completado | Meta de cabecera de un informe acabado |
| Título de sección + contenido | Bloques de briefing generados |
| Aviso *Elaborado sin modelo: …* | El informe se construyó sin modelo en segundo plano — una sección por fuente principal, sin cruce |
| **Fuentes** | Enlaces numerados con **N % relevante** |

## Relacionado

- [Memoria](/docs/es/knowledge/memory/)
- [Documentos](/docs/es/knowledge/documents/)
- [Búsqueda](/docs/es/daily/search/)
- [Secretos](/docs/es/admin/secrets/)
- [Resumen de ajustes](/docs/es/admin/settings/)
