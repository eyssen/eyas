---
title: Bienvenida
description: Manual de EYAS — sistema operativo de IA personal autoalojado, en tu máquina, con tus reglas.
---

**EYAS** es un sistema operativo de IA personal autoalojado. Agentes con nombre, memoria duradera, un tablero de trabajo y canales corren en **tu** máquina — no como producto en la nube de otro.

Este libro es para el **operador** que instala y mantiene la instancia, y para el **usuario cotidiano** que habla con agentes, sigue el trabajo y lee lo que el sistema recuerda. Las specs de arquitectura profundas viven en `docs/` del repositorio (véase [Arquitectura](/docs/es/reference/architecture/)).

## Cómo leer este libro

La barra lateral sigue el producto, no un manual partido en tutoriales / cómo hacerlo / referencia. Tienes cuatro trabajos; viven en este orden:

| Necesitas… | Ve aquí |
|------------|---------|
| **Aprender haciendo** | Inicio: [Primeros pasos](/docs/es/getting-started/), [Asistente](/docs/es/setup-wizard/), [Tu primera hora](/docs/es/first-hour/) |
| **Entender por qué** | [Conceptos básicos](/docs/es/concepts/) y el *Para qué sirve* al inicio de cada capítulo |
| **Hacer un trabajo** | Trabajo diario, Agentes, Skills y automatización, Conocimiento, Comunicación, IA, Administración |
| **Consultar un dato** | Despliegue y CLI, [Glosario](/docs/es/reference/glossary/), [FAQ](/docs/es/reference/faq/), tablas de campos al final de las páginas how-to |

**Camino recomendado:** [Primeros pasos](/docs/es/getting-started/) → [Asistente](/docs/es/setup-wizard/) → **[Tu primera hora](/docs/es/first-hour/)** → [Conceptos básicos](/docs/es/concepts/) → luego el área que realmente necesitas.

En el producto, los iconos **?** abren el capítulo correspondiente en **`/docs/`** en el mismo host, en el idioma que estás usando.

## Mapa del manual

| Sección | Empieza aquí |
|---------|--------------|
| **Inicio** | [Primeros pasos](/docs/es/getting-started/) · [Asistente](/docs/es/setup-wizard/) · [Tu primera hora](/docs/es/first-hour/) · [Conceptos](/docs/es/concepts/) |
| **Trabajo diario** | [Inicio](/docs/es/daily/home/) · [Conversaciones](/docs/es/daily/conversations/) · [Tablero](/docs/es/daily/board/) · [Proyectos](/docs/es/daily/projects/) · [Búsqueda](/docs/es/daily/search/) |
| **Agentes** | [Resumen](/docs/es/agents/overview/) · [Voz](/docs/es/agents/voice/) · [Equipos](/docs/es/agents/teams/) · [Ejecuciones](/docs/es/agents/runs/) |
| **Skills y automatización** | [Skills](/docs/es/automation/skills/) · [Programador](/docs/es/automation/scheduler/) · [Pipelines](/docs/es/automation/pipelines/) |
| **Conocimiento y memoria** | [Memoria](/docs/es/knowledge/memory/) · [Base de conocimiento](/docs/es/knowledge/knowledge-base/) · [Diseño](/docs/es/knowledge/design/) · [Documentos](/docs/es/knowledge/documents/) |
| **Comunicación** | [Canales](/docs/es/communication/channels/) · [Telegram](/docs/es/communication/telegram/) |
| **IA y prompts** | [Proveedores](/docs/es/ai/providers/) · [Enrutado y presupuesto](/docs/es/ai/routing-budget/) · [Prompts](/docs/es/ai/prompts/) · [MCP](/docs/es/ai/mcp/) |
| **Administración** | [Usuarios](/docs/es/admin/users/) · [Notificaciones](/docs/es/admin/notifications/) · [Extensiones](/docs/es/admin/extensions/) · [Nodos](/docs/es/admin/nodes/) · [Manos](/docs/es/admin/hands/) · [Backup](/docs/es/admin/backup/) · [Seguridad](/docs/es/admin/security-privacy/) |
| **Despliegue y CLI** | [Docker](/docs/es/deploy/docker/) · [CLI](/docs/es/deploy/cli/) · [Configuración](/docs/es/deploy/configuration/) |
| **Referencia** | [Glosario](/docs/es/reference/glossary/) · [FAQ](/docs/es/reference/faq/) |

Cada capítulo abre con **para qué sirve** y **cuándo usarlo**, luego el flujo, luego los campos cuando ayudan.

## Idiomas

Inglés, húngaro, alemán, español, francés, klingon (tlhIngan Hol) — cámbialo en la cabecera. El texto que falte cae al inglés.

## En el producto

El mismo sitio lo sirve el proceso principal EYAS en **`/docs/`** (no hace falta un servidor de docs aparte).

## Patrocinio

EYAS se desarrolla con los mismos modelos de IA que orquesta, y esa inferencia es el
mayor coste corriente del proyecto. El **[patrocinio](https://github.com/sponsors/eyssen)**
lo cubre; el objetivo actual son **1.000 $/mes** para la factura de los modelos.

Todo lo que publica EYAS sigue siendo MIT y autoalojable, con patrocinio o sin él, y
ningún nivel es un contrato de soporte. Niveles y lista completa:
[SPONSORS.md](https://github.com/eyssen/eyas/blob/main/SPONSORS.md).
