---
title: Nodos remotos
description: Otras máquinas a las que EYAS llega (SSH, WebSocket, Tailscale) para que los agentes no trabajen solo en esta caja.
---

**Para qué sirve.** Nodos remotos es el inventario de otras máquinas que esta instancia de EYAS puede alcanzar. Registras nombre, host y tipo de conexión para que los agentes ejecuten trabajo fuera de esta caja — normalmente por SSH. La salud es **online**, **offline** o **unknown**. Esta página es el registro; no es telemetría de Observabilidad ni una Mano (emparejamiento de escritorio/CLI).

## Cuándo usarlo

- Quieres que un agente ejecute un comando en otro host, no solo en esta instancia.
- Añades una máquina a la que llegas por **SSH**, **WebSocket** o **Tailscale**.
- Necesitas ver cuándo se vio un nodo por última vez, o renombrarlo / redirigirlo / quitarlo.
- Necesitas un invoke SSH vigilado (patrones destructivos bloqueados salvo forzar) — es una API en nodos SSH, no un botón en esta página.

## Flujo típico

1. Abre en la barra lateral **Ajustes** → grupo **Infraestructura** → **Nodos** (`/nodes`).
2. **Añadir nodo**.
3. **Nombre** (marcador `my-node`), **Host** (marcador `192.168.1.100:3100`) y **Tipo** (**SSH**, **WebSocket** o **Tailscale**).
4. **Guardar**. La tarjeta aparece con punto de estado e insignia de tipo.
5. El lápiz edita nombre, host y tipo. La papelera elimina el nodo.

Vacío: *No hay nodos remotos configurados*. Tras guardar, el host en monoespaciado y, si se conoce, **Visto por última vez**.

## Funciones

Cada tarjeta muestra **Nombre**, punto de estado, insignia de **Tipo**, **Host** y **Visto por última vez** si hay marca de tiempo.

Colores: **online** (verde), **offline** (rojo), **unknown** (ámbar). Los nodos nuevos empiezan **offline** hasta que algo los marca como vistos.

**Tipo** en el diálogo: **SSH**, **WebSocket** o **Tailscale**. El diálogo no recoge una lista de capacidades; el registro igual puede guardar capacidades para los agentes.

Los nodos SSH se pueden invocar con un ejecutor vigilado (`POST` invoke). Patrones como `rm -f` / `rm -r`, `mkfs`, `dd if=` y bombas fork se rechazan salvo que `forceDestructive` sea verdadero. Los tipos no SSH responden «no implementado» al invoke. Las credenciales (usuario, contraseña o clave privada) vienen del cuerpo del invoke o de la config guardada — nunca se registran en el log.

WebSocket y Tailscale son inventario + salud en esta página; no ganan un botón de invoke aquí.

## Campos y controles

<h2 id="add-node">Añadir / editar nodo</h2>

| Control | Significado |
|---------|-------------|
| **Añadir nodo** | Abrir el diálogo de alta |
| Recuento de nodos | Insignia de cabecera si hay al menos uno |
| **Nombre** | Etiqueta humana. Marcador `my-node` |
| **Host** | Dirección. Marcador `192.168.1.100:3100` |
| **Tipo** | **SSH**, **WebSocket** o **Tailscale** |
| **Guardar** / **Guardando…** | Persistir (desactivado hasta que nombre y host no estén vacíos) |
| Lápiz | **Editar nodo** — mismos campos |
| Papelera | Borrar el nodo |

<h2 id="health">Salud</h2>

| Control | Significado |
|---------|-------------|
| Punto de estado | **online** / **offline** / **unknown** |
| Insignia de tipo | Tipo de conexión en la tarjeta |
| **Visto por última vez** | Marca de tiempo en la que el registro lo marcó como visto |

## Relacionado

- [Resumen de ajustes](/docs/es/admin/settings/)
- [Manos](/docs/es/admin/hands/)
- [Notificaciones](/docs/es/admin/notifications/)
- [Extensiones](/docs/es/admin/extensions/)
- [Ingress](/docs/es/admin/ingress/)
- [Observabilidad y ops](/docs/es/admin/observability/)
- [Secretos](/docs/es/admin/secrets/)
