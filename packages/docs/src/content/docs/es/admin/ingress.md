---
title: Túnel Ingress
description: Exponer EYAS en remoto con un túnel de Cloudflare.
---

**Ruta:** `/ingress`.

Ingress arranca un **Cloudflare Tunnel** (`cloudflared`) para alcanzar esta instancia fuera de la red local sin abrir puertos de entrada.

| Control | Significado |
|---------|-------------|
| **Estado** | Conectado o desconectado; URL pública si el túnel está activo |
| **Iniciar / Detener** | Lanza o termina `cloudflared` |
| **Token del túnel** | Token del túnel de Cloudflare Zero Trust — **Guardar ajustes** lo guarda en el almacén |
| **Hostname** | Nombre público del túnel en Cloudflare (p. ej. `eyas.ejemplo.com`) |
| **Guardar ajustes** | Hostname + token de forma persistente. Iniciar reutiliza el token guardado si el campo está vacío |

## Requisitos

1. Instala [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) y déjalo en el `PATH`.
2. Crea un túnel en el [panel de Cloudflare Zero Trust](https://one.dash.cloudflare.com/) y copia el token.
3. Apunta el túnel a esta instancia (normalmente `http://127.0.0.1:3100`).

El token es un secreto: mejor el almacén de secretos o una variable de entorno que el historial del shell.

## Relacionado

- [Ajustes](/docs/es/admin/settings/)
- [Secretos](/docs/es/admin/secrets/)
- [Observabilidad y ops](/docs/es/admin/observability/)
- [Seguridad](/docs/es/admin/security-privacy/)
