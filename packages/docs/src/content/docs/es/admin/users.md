---
title: Usuarios y permisos
description: Humanos, identidades de agente, roles, archivar y restaurar.
---

**Para qué sirve.** Directorio de humanos que inician sesión e identidades **agente** sin login. CASL en cada API protegida. Modelo/herramientas están en [Configurar](/docs/es/agents/configure/). **Nuevo agente** crea la identidad y salta al editor.

**Ruta:** `/users`. Barra: **Usuarios**.

## Cuándo usarlo

- Un segundo humano (operador/visor).
- Nueva identidad de agente sin pasar primero por Agentes.
- Alguien se va — **Archivar** (suave). El root owner y los usuarios agente no se archivan desde aquí.
- **Activos** vs **Archivados**.

## Flujo típico

1. **Usuarios**.
2. **Activos / Archivados**.
3. **Nuevo agente** → `/agents/<id>`.
4. Humanos vía setup/aprovisionamiento; roles CASL.
5. Archivar (confirmar). Restaurar desde **Archivados**.

Archivar = `DELETE /users/:id`; restaurar `POST /users/:id/restore`.

**Terminal de OpenCode:** solo el propietario y los administradores (el permiso de gestión de OpenCode), porque la terminal ejecuta comandos como el usuario propio del servidor. El rol user ve la página de OpenCode, y las tareas `opencode_run` de los colegas corren en sus conversaciones. Los permisos de los roles integrados son fijos; a quien necesite la terminal, dale el rol admin. Bajar el rol de una persona, suspenderla o archivarla termina al instante sus terminales abiertas — ver [OpenCode — Quién puede abrir una terminal](/docs/es/automation/opencode/#who-can-open-a-terminal).

## Relacionado

- [Setup — propietario raíz](/docs/es/setup-wizard/)
- [Claves de API](/docs/es/admin/secrets/)
- [Agentes](/docs/es/agents/overview/)
- [Seguridad](/docs/es/admin/security-privacy/)
