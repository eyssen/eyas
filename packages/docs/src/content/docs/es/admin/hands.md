---
title: Manos
description: Empareja una «mano» local para que EYAS use CLIs y automatización de escritorio en una máquina que controlas.
---

**Para qué sirve.** Manos es el centro de emparejamiento de clientes EYAS Hand: máquinas que controlas y que exponen herramientas CLI, automatización del SO y/o uso del ordenador a este servidor. Un código de emparejamiento de corta vida vincula el dispositivo; las hands conectadas informan plataforma, arquitectura, SO, capacidades y cuántas herramientas CLI/app descubrieron. No es un nodo SSH remoto ni Observabilidad.

## Cuándo usarlo

- Quieres que el agente ejecute un CLI o una acción de escritorio en *tu* Mac, Windows o Linux, no solo dentro del proceso del servidor.
- Estás emparejando un cliente Hand nuevo y necesitas un código que caduca en cinco minutos.
- Necesitas ver si una hand está conectada, qué puede hacer (**CLI**, **Automatización del SO**, **Uso del ordenador**) y cuántas herramientas encontró.
- Quieres desconectar un dispositivo en el que ya no confías.

## Flujo típico

1. Abre en la barra lateral **Ajustes** → grupo **Infraestructura** → **Manos** (`/hands`).
2. **Generar código de emparejamiento**. Aparece un **Código de emparejamiento** grande; **Caduca en 5 minutos — introduce este código en tu dispositivo Hand**.
3. Introduce el código en el cliente Hand. El código desaparece de esta página al caducar.
4. **Actualizar** si la tarjeta nueva aún no se ve.
5. Confirma plataforma · arch · SO, insignias de capacidad y recuento de herramientas; quédate con la hand o **Desconectar**.

Vacío: *No hay hands conectadas* / *Genera un código de emparejamiento y conecta un cliente EYAS Hand*. Tras emparejar, punto verde y el id corto.

## Funciones

Los códigos duran **300 segundos** (cinco minutos) y luego desaparecen. Un fallo al generar muestra un banner de error.

Cada hand conectada muestra: nombre, id corto, `platform · arch · osVersion`, **N herramientas**, versión de protocolo, **Visto por última vez** relativo e insignias de capacidad. Iconos de plataforma: Darwin, Windows, Linux (genérico en otro caso).

Capacidades que informa el cliente:

| Insignia | Significado |
|----------|-------------|
| **CLI** | Herramientas de línea de comandos en esa máquina |
| **Automatización del SO** | Automatización a nivel de SO |
| **Uso del ordenador** | Escritorio / computer-use |

Las herramientas descubiertas son **cli** o **app** (id, nombre, ruta, versión opcional). Esta página muestra el **recuento**, no una lista por herramienta.

**Desconectar** da de baja la hand (y tira el transporte MCP si así estaba conectada). **Actualizar** recarga la lista.

## Campos y controles

<h2 id="pairing">Código de emparejamiento</h2>

| Control | Significado |
|---------|-------------|
| **Generar código de emparejamiento** / **Generando…** | Emitir un código para el usuario actual |
| **Código de emparejamiento** | Código grande en monoespaciado para el Hand |
| Caduca en *n* minutos | Texto de TTL; la tarjeta se borra al vencer |
| **Actualizar** | Recargar hands conectadas |

<h2 id="connected-hands">Hands conectadas</h2>

| Control | Significado |
|---------|-------------|
| Nombre + id corto | Etiqueta y los ocho primeros caracteres de `handId` |
| platform · arch · osVersion | Identidad de la máquina |
| **N herramientas** | Cuántas herramientas CLI/app informó la hand |
| Protocolo v*n* | Versión del protocolo Hand |
| **Visto por última vez** | Tiempo relativo (*ahora mismo*, *hace N min*, *hace N h*, *hace N d*) |
| **CLI** / **Automatización del SO** / **Uso del ordenador** | Insignias de capacidad |
| Punto conectado | Verde mientras está en la lista |
| **Desconectar** / **Desconectando…** | Dar de baja esta hand |

## Relacionado

- [Resumen de ajustes](/docs/es/admin/settings/)
- [Nodos remotos](/docs/es/admin/nodes/)
- [Notificaciones](/docs/es/admin/notifications/)
- [Extensiones](/docs/es/admin/extensions/)
- [Herramientas](/docs/es/automation/tools/)
- [Servidores MCP](/docs/es/ai/mcp/)
