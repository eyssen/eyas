---
title: Asistente de configuración
description: Primer arranque — todos los pasos y campos.
---

El asistente corre **una vez** hasta completar los pasos obligatorios (`/setup`). Los opcionales se pueden posponer.

**Chrome:** idioma, apariencia, paso N de M, Continuar / Completar.

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

[Panel](/docs/es/daily/dashboard/) · [Proveedores](/docs/es/ai/providers/) · [Agentes](/docs/es/agents/overview/)
