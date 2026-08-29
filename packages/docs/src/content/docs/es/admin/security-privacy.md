---
title: Seguridad y privacidad
description: Gate de seguridad, flujo de eventos, auditoría y escaneo PII — antes y después de las herramientas.
---

**Para qué sirve.** Tres superficies. El **gate de seguridad** permite, niega o escala una llamada *antes* de ejecutarla. **Eventos de seguridad** (`/security`) es el flujo. **Auditoría** (`/audit`) el registro inmutable. **Privacidad** (`/privacy`) es PII — el mismo sanitizador que el capture de memoria durable corre *antes* de escribir el vault.

## Cuándo usarlo

- Una llamada se negó — checkpoint, riesgo, motivo.
- Las herramientas de navegador no deben tocar hosts privados/metadata (SSRF). El perfil headless es de EYAS (`data/browser/profile`), nunca el Chrome diario (Chrome 136+). Los índices mueren al navegar. `evaluate` solo en la página. `browser_totp` es amarillo (semilla en Secretos/Llavero; el código va a `browser_fill`). La caché de acciones guarda locators, no secretos.
- Vas a activar autonomía y quieres ver qué escala el gate.
- PII en logs, notas del vault o prompts de salida.

## Flujo típico

1. **Seguridad** (`/security`): Allow/Deny/Escalate.
2. **Auditoría** (`/audit`): quién, módulo, resultado, coste. Rollback con confirmación.
3. **Privacidad** (`/privacy`): estadísticas, **Probar escáner PII**.
4. Con [Autonomía](/docs/es/agents/autonomy/) y [Secretos](/docs/es/admin/secrets/).
5. SSH: [Nodos](/docs/es/admin/nodes/) — patrones destructivos piden force flag.

Interruptor de capture: `memory.capture.enabled` (por defecto **on**). Ver [FAQ](/docs/es/reference/faq/).

## Relacionado

- [Autonomía](/docs/es/agents/autonomy/)
- [Usuarios](/docs/es/admin/users/)
- [Herramientas](/docs/es/automation/tools/)
- [Observabilidad](/docs/es/admin/observability/)
- [Nodos](/docs/es/admin/nodes/)
- [Memoria](/docs/es/knowledge/memory/)
