---
title: Proveedores
description: Backends de IA — tarjetas, panel, modelos.
---

**Ruta:** `/providers`. Tabs: Routing Tiers · Providers · Budget · AI Analysis.

## Tarjeta

On/Off · N/M models · CLI not found · No API key · Auth error.

Ejemplos: Anthropic, OpenAI, OpenRouter, Gemini, Kimi, Claude/Grok/Kimi CLI (tools vía [puente CLI MCP](/docs/es/ai/mcp/)), Ollama, LM Studio, vLLM, xAI, Mistral, Groq, …

## Panel

Authentication (API key o sesión CLI) · lista de modelos enable/disable · claves en Secrets.

**Configuración Claude del host (Claude Code CLI).** Por defecto, EYAS aísla las conversaciones de la configuración Claude de la máquina host — sin settings.json (hooks, reglas de permisos), sin archivos CLAUDE.md, sin skills del host ni servidores .mcp.json del proyecto —, de modo que la memoria propia de EYAS es la única fuente de verdad. El interruptor «Cargar configuración Claude del host» del panel del proveedor la reactiva. Las CLI de Grok y Kimi siempre cargan su propia configuración de máquina; EYAS no puede desactivarlo. Los ajustes de política administrados por la empresa, donde existan, siguen aplicándose — ese nivel no puede desactivarse desde EYAS.
