---
title: Perfiles de voz
description: Cómo habla un agente por dentro vs por fuera — seis dimensiones, presets, AUTO.
---

**Para qué sirve.** La voz es *cómo* habla el agente, no *qué* sabe. Cada agente tiene dos perfiles: **Internal communication** (tú y el equipo) y **External communication** (clientes, extraños, canales públicos). El runtime elige **AUTO** salvo que anules el alcance en una conversación.

## Cuándo usarlo

- Un tono distinto con el equipo que con un cliente.
- Partir de un preset (Jarvis, Diplomat, Coach, …) y ajustar una dimensión.
- Frases bloqueadas (disculpas vacías) o una **Signature**.
- Una conversación debe forzar Internal o External, da igual el valor por defecto.

## Flujo típico

1. Abre **Agentes** → el agente → pestaña **Voice** — ruta `/agents/:id`.
2. Elige **Internal preset** y **External preset**, o deja **Custom** tras editar un campo.
3. Ajusta las seis dimensiones en cada bloque, más **Blocked phrases** y **Signature**. **Save voice profile**.
4. En la conversación, **Voice · INTERNAL / EXTERNAL / AUTO** debe coincidir; anúlalo ahí si este hilo es la excepción.

## Funciones

Internal vs External. Presets Jarvis…Tutor. Dimensiones (×2): Address, Tone, Verbosity, Directness, Humor, Emoji. Frases bloqueadas, firma, Save. Override en conversación AUTO/INTERNAL/EXTERNAL.
