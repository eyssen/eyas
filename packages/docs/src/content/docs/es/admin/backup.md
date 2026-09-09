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

## Relacionado

- [Primeros pasos](/docs/es/getting-started/)
- [Actualización del sistema](/docs/es/admin/settings/)
- [Secretos](/docs/es/admin/secrets/)
- [Importación de datos](/docs/es/admin/data-port/)
