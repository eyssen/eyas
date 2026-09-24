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

Las claves de [Proveedores](/docs/es/ai/providers/) y [Canales](/docs/es/communication/channels/) aterrizan aquí. Las de backup pueden ser un valor *o* un nombre de env (`BACKUP_S3_ACCESS_KEY`).

La clave de API de Grok CLI vive aquí como `grok-cli-api-key` (ámbito **System**) cuando eliges **Usar una clave de API en su lugar** en la tarjeta de inicio de sesión de Grok CLI. EYAS solo la pasa a las ejecuciones de Grok CLI, como `XAI_API_KEY`; también puedes añadirla aquí con ese nombre, y **Cerrar sesión** en el panel del proveedor la borra. Ver [Proveedores — Iniciar sesión de Grok y Kimi para EYAS](/docs/es/ai/providers/#sign-in-grok-and-kimi-for-eyas). Los inicios de sesión por código de dispositivo de Grok y Kimi no son secretos de este almacén: son archivos en los directorios personales de CLI propios de EYAS.

La semilla TOTP de 2FA también vive aquí (p. ej. `github-totp`, ámbito **System**), o en el Llavero de macOS (`-s <nombre>` / `eyas-totp-<nombre>`). `browser_totp` solo devuelve el código de 6 dígitos; va a `browser_fill`. La semilla no entra en la caché de acciones. [Browser Use](/docs/es/automation/browser-use/).

## Relacionado

- [Setup — contraseña maestra](/docs/es/setup-wizard/)
- [Proveedores](/docs/es/ai/providers/)
- [Copia de seguridad](/docs/es/admin/backup/)
- [Canales](/docs/es/communication/channels/)
- [Browser Use](/docs/es/automation/browser-use/) (`browser_totp`)
