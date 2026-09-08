---
title: Secretos y claves de API
description: Vault cifrado para claves de proveedor/canal, más claves de máquina para la API de EYAS.
---

**Para qué sirve.** Dos tipos. **Secretos** (`/secrets`) es el almacén cifrado: claves de proveedor, tokens de canal, destinos de backup. Los valores nunca salen en logs. **Claves de API** (`/api-keys`) llaman *a EYAS*, no a Anthropic. La contraseña maestra del setup cifra los payloads.

## Cuándo usarlo

- La tarjeta dice **Sin clave API**.
- Un token de canal no debe vivir en YAML ni en el historial del shell.
- CI necesita acceso programático — copia la clave una vez, revócala después.
- Ámbito **Sistema / Usuario / Agente**.

## Flujo típico

1. **Secretos** — pestaña de ámbito, **Añadir secreto**.
2. **Claves de API** — **Crear clave de API**, caducidad opcional.
3. Copia el banner de inmediato.
4. **Revocar** las no usadas.

Las claves de [Proveedores](/docs/es/ai/providers/) y [Canales](/docs/es/communication/channels/) aterrizan aquí. Las de backup pueden ser un valor *o* un nombre de env (`BACKUP_S3_ACCESS_KEY`). La semilla TOTP de 2FA también (p. ej. `github-totp`, ámbito **System**) o el Llavero de macOS (`-s <nombre>` / `eyas-totp-<nombre>`). `browser_totp` solo devuelve el código de 6 dígitos; va a `browser_fill`. La semilla no entra en la caché de acciones. [Browser Use](/docs/es/automation/browser-use/).

## Relacionado

- [Setup — contraseña maestra](/docs/es/setup-wizard/)
- [Proveedores](/docs/es/ai/providers/)
- [Copia de seguridad](/docs/es/admin/backup/)
- [Canales](/docs/es/communication/channels/)
- [Browser Use](/docs/es/automation/browser-use/) (`browser_totp`)
