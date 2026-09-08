---
title: Asistente de configuración
description: Primer arranque — todos los pasos y campos.
---

**Para qué sirve.** Solo en el primer arranque. El asistente crea la contraseña maestra, el owner raíz, tus dos agentes primarios y un primer backend de modelo para desbloquear la app. Después, cambia eso en **Ajustes**, **Proveedores** y **Agentes** — no esperes volver a recorrer el asistente.

## Cuándo usarlo

- El navegador te envió a `/setup` porque la configuración está incompleta
- Omitiste un paso opcional y quieres la lista de campos
- Estás restaurando una instancia nueva

No para cambios del día a día una vez abierta la app.

El asistente corre **una vez** hasta completar los pasos obligatorios (`/setup`). Los opcionales se pueden posponer.

**Chrome:** idioma (`en` / `hu` / `de` / `es` / `fr` / `tlh`), apariencia, paso N de M, Continuar / Completar.

## Orden típico

1. **Contraseña maestra** (obligatorio) — cifra secrets  
2. **Owner raíz** — usuario, contraseña, nombre visible  
3. **Agentes primarios** — Asistente personal + Ingeniero de sistema  
4. **Agentes de equipo** (opcional) — plantillas especialistas  
5. **Proveedor de IA** — CLI local o API key  
6. **Modelos de IA** — modelo por agente  

### Contraseña maestra

| Campo | Oblig. | Significado |
|-------|--------|-------------|
| Contraseña maestra | Sí | Cifrado de secrets |
| Confirmar | Sí | Debe coincidir |

### Owner raíz

| Campo | Oblig. | Significado |
|-------|--------|-------------|
| Usuario | Sí | Login único |
| Contraseña | Sí | Hash en DB |
| Nombre visible | No | En la UI |

Credenciales en memoria para pasos opcionales; tras reload puede hacer falta login.

### Agentes primarios

| Campo | Oblig. | Significado |
|-------|--------|-------------|
| Asistente personal | Sí | Primary / assistant → tipo de proyecto general |
| Ingeniero de sistema | Sí | Primary / engineer → tipo eyas |

Cada uno: fila DB + workspace `data/agents/<id>/` + usuario agent.

### Equipo (opcional)

Plantillas recomendadas/especialistas, seleccionar todo, omitir/continuar.

### Proveedor de IA

CLIs detectados (sin API key) o proveedores cloud/locales con **clave API** cifrada. CLI primaria, activo/inactivo, guardar, re-comprobar.

### Modelos

Columna Agent + Model, Aplicar, Completar setup.

## Después

- [Tu primera hora](/docs/es/first-hour/) — UI en vivo: Inicio, una conversación, Tablero, Memoria
- [Inicio](/docs/es/daily/home/) · [Proveedores](/docs/es/ai/providers/) · [Agentes](/docs/es/agents/overview/)
