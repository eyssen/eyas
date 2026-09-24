---
title: Conceptos básicos
description: Modelo mental de EYAS.
---

Léelo una vez después de [Tu primera hora](/docs/es/first-hour/). Vuelve cuando un capítulo posterior use una palabra que no reconozcas. Esto es el modelo mental, no una guía pantalla a pantalla.

EYAS es un **sistema operativo de IA personal** en tu máquina.

## Bloques

| Concepto | Significado |
|----------|-------------|
| Agente | Persona de IA con modelo, tools, skills, voz, workspace |
| Colega | Agente primary o team con el que hablas — hilo de inicio, SOUL. El setup crea dos (Asistente personal + Ingeniero de sistema). |
| Especialista | Trabajador estrecho de un pool compartido; cualquier colega puede lanzar uno activo (`run_specialist`) |
| Conversación | Hilo con tools y runs |
| Tarjeta del tablero | Trabajo rastreable |
| Proyecto / etapa | Estructura de entrega |
| Skill / Tool | Conocimiento / acción invocable |
| Memoria | Working → episodic → vault → archive |
| Knowledge / Documents | Wiki vs archivos |
| Canal | Mensajería externa |
| Proveedor | Backend LLM |
| Security gate / Forge | Política / cambios de soul aprobados |

## Flujo

Setup → conversación o tablero → tools/memoria/handoff o especialista → resultado.

## Memoria vs conocimiento vs documentos

| Almacén | Quién lo escribe | Para qué |
|---------|------------------|----------|
| **Niveles de memoria** | Sistema / agentes durante el trabajo | Recuerdo automático, episodios, procedimientos |
| **Markdown del vault** | Importación / agentes / tú / **auto-captura tras un turno de conversación** (activada por defecto desde 0.8.16-beta) | Notas semánticas y procedimentales duraderas |
| **Base de conocimiento** | Tú (editor) | Wiki curada |
| **Documentos** | Subida | PDF, office, dumps de código |

Un hecho duradero dicho en el chat puede convertirse en una nota del vault sin que nadie lo pida. La captura corre después de entregar la respuesta; una captura fallida cuesta una nota, nunca la respuesta. Detalles: [Memoria](/docs/es/knowledge/memory/).

## Orchestration

| Control | Significado |
|---------|-------------|
| **Modelo** | Qué modelo responde: un modelo fijo, Auto-routing o el predeterminado del colega |
| **Effort** | Profundidad del razonamiento frente a coste/velocidad. Lista solo los niveles que ofrece el modelo de la conversación; **Automático** hereda (Deep → Máximo, el esfuerzo del colega, el de la conversación que delega) o usa el predeterminado del modelo |
| **Orchestration: Solo** | Sin especialistas, traspasos ni propuestas de equipo |
| **Orchestration: Auto** | El modelo decide el reparto |
| **Orchestration: Deep** | Reparto multiagente agresivo; esfuerzo predeterminado Máximo |

Detalles: [Conversaciones](/docs/es/daily/conversations/).

## Siguiente

- [Tu primera hora](/docs/es/first-hour/)
- [Primeros pasos](/docs/es/getting-started/)
- [Agentes](/docs/es/agents/overview/)
- [Equipos y delegación](/docs/es/agents/teams/)
- [Memoria](/docs/es/knowledge/memory/)
