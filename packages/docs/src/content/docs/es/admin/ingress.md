---
title: Túnel de ingress
description: Alcanza esta EYAS fuera de la LAN con un túnel Cloudflare — sin puertos de entrada.
---

**Para qué sirve.** Ingress arranca un **túnel Cloudflare** (`cloudflared`) para que el teléfono, otra oficina o un proveedor de webhooks lleguen a esta instancia sin abrir puertos. Es acceso remoto *a esta caja*, no un [nodo remoto](/docs/es/admin/nodes/) ni una [Mano](/docs/es/admin/hands/).

**Ruta:** `/ingress`. Barra: **Ingress**.

## Cuándo usarlo

- `https://eyas.example.com` sin port-forward.
- Webhooks de Telegram/WhatsApp/Teams necesitan HTTPS público.
- Viajas y quieres la UI, Cloudflare delante.

## Flujo típico

1. Instala [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) en el `PATH`.
2. Crea un túnel en Zero Trust.
3. Copia solo el token `eyJ…` después de `--token`.
4. Apunta a `http://127.0.0.1:3100` (**3100**, no 3000).
5. **Token del túnel** + **Hostname**, **Guardar ajustes**, **Iniciar**.

**Iniciar** reutiliza el token guardado si el campo está vacío.

## Relacionado

- [Ajustes](/docs/es/admin/settings/)
- [Secretos](/docs/es/admin/secrets/)
- [Observabilidad](/docs/es/admin/observability/)
- [Seguridad](/docs/es/admin/security-privacy/)
- [Canales](/docs/es/communication/channels/)
- [Nodos](/docs/es/admin/nodes/)
