---
title: Copia de seguridad y restauración
description: Archivo de restauración completa en local, luego subida opcional (S3/B2, FTP, Dropbox, SSH).
---

**Para qué sirve.** El backup construye un **paquete de restauración completo** para una máquina vacía: `data/` (DB, `master.key`, agentes, vault…), `config/`, `.env`, `version.json` — no `backups/`, tmp ni logs de runtime. Restaura en la **misma versión de producto**. Primero local; el destino **primario** lo sube después.

**Ruta:** `/backup`. Barra: **Copia de seguridad**.

## Cuándo usarlo

- Un tarball para una instalación vacía de la **misma** versión.
- Offsite: S3 compatible (AWS, Backblaze B2, R2, MinIO), FTP/FTPS, Dropbox, SSH/SFTP.
- La autoactualización exige un Backup que funcione.

## Flujo típico

1. **Copia de seguridad**.
2. Opcional **Añadir destino**, tipo, ajustes, secretos (clave *o* nombre de env), **Usar para subidas**.
3. **Crear copia**. Fila: nombre, versión, tamaño, **Subido** / **Solo local**.
4. Restaurar: instala la versión de la tabla, para el servidor, `tar -xzf`, `chmod 600 data/master.key .env`, `eyas start`.

**Los inicios de sesión de los CLI van en el archivo.** Los inicios de sesión de Grok CLI y Kimi Code CLI para EYAS viven en `data/cli-homes/grok-cli/.grok/auth.json` y `data/cli-homes/kimi-cli/.kimi/credentials/kimi-code.json`, así que una copia del directorio de datos los contiene. Trata el archivo como una credencial, igual que `master.key`. Ver [Proveedores — Iniciar sesión de Grok y Kimi para EYAS](/docs/es/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Qué deja fuera el archivo

| Fuera del archivo | Por qué / qué hacer |
|-------------------|---------------------|
| `backups/`, tmp, pid y log de runtime | No hacen falta para reconstruir |
| Almacenes de sesión de los CLI en `data/cli-homes/*/sessions` | Transcripciones desechables de los CLI que EYAS nunca reanuda (además, EYAS las borra tras cada turno) |
| Workspaces de conversación fuera del directorio de datos | En una instalación desde el código fuente ejecutada desde un clon de git, o con `EYAS_WORKSPACES_DIR` definido, los workspaces viven fuera de `data/` (ver [Configuración — Workspaces de conversación](/docs/es/deploy/configuration/#conversation-workspaces)). Los archivos de salida de los agentes se conservan igualmente: se copian a Documentos como adjuntos de la conversación, que sí entran en la copia. |
| Un directorio de datos movido con `EYAS_DATA_DIR` | El archivo cubre `<EYAS home>/data`. Si `EYAS_DATA_DIR` apunta a otro sitio, incluye esa carpeta — contiene la base de datos y el vault de memoria — en tus propias copias. |

## Relacionado

- [Primeros pasos](/docs/es/getting-started/)
- [Actualización del sistema](/docs/es/admin/settings/)
- [Secretos](/docs/es/admin/secrets/)
- [Importación de datos](/docs/es/admin/data-port/)
