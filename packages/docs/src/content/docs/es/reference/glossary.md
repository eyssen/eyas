---
title: Glosario
description: Términos del producto.
---

| Término | Definición |
|---------|------------|
| Agente | Actor de IA configurado |
| Primary | Compañeros always-on del setup |
| Skill | Paquete procedural markdown |
| Tool | Capacidad invocable |
| Coding surface | Tools de archivo independientes del modelo (`read_file`, `edit_file`, …) |
| Worktree | Working tree git aislado para agentes en paralelo |
| Verify commands | Lint/test tras el run, antes del critic |
| Tool hook | PreToolUse / PostToolUse en cada ejecución de tool |
| Board | Superficie de seguimiento |
| Conversación | Hilo de chat |
| Memory tier | Working→episodic→vault→archive |
| Memory block | Nota compartida con scope (company/agent/team/run) |
| Vault | Conocimiento markdown durable |
| Provider | Backend LLM |
| MCP | Model Context Protocol |
| Connection | Inventario nombrado de un sistema externo |
| Canal | Conector de mensajería |
| Grounding | Evidencia de retrieval antes de afirmar hechos |
| Hybrid search | FTS + vector (RRF) |
| Search source | Árbol indexado con nombre (ruta + label/version/family) |
| Pin de fuentes | Selección de conversation o proyecto de qué search sources puede usar el agente |
| needsPin | Respuesta de tool si hay varias versiones odoo-family ready sin pin |
| Prompt Enhancer | Coach de borradores de conversación (familia de modelo) |
| Prompt Coach | Coach de prompts duraderos de proyecto/agente |
| Forge | Cambios soul/identity aprobados |
| Security gate | Política pre-acción |
| CASL | Autorización |
| Orchestration | Solo/Auto/Deep |
| Effort | Profundidad de razonamiento |
| SLA breach | Señal overdue/stale del heartbeat proactivo |
| A2A | Protocolo agent-to-agent (card + ejecución de tareas) |
