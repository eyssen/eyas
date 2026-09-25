---
title: Docker
description: Compose un contenedor (más Ollama GPU opcional). Puerto 3100. Persiste data/.
---

**Para qué sirve.** Segundo camino: un servicio `eyas`, volumen `data/`, perfil **gpu** opcional para Ollama. Cuando ya hay Docker y no quieres Bun en el host. La imagen incluye backend, frontend dist y docs en `/docs/`. El contenedor escucha en **3100**.

## Cuándo usarlo

- El servidor ya tiene Docker.
- Un segundo stack (`-p eyas-dev` + `EYAS_PORT=3200`).
- Ollama local con NVIDIA (`--profile gpu`).

## Flujo típico

1. Clona. `.env` opcional.
2. `docker compose up -d`. **http://localhost:3100**.
3. Volumen `eyas-data`. `./config` de solo lectura.
4. `docker compose logs -f` / `down`.
5. GPU: `docker compose --profile gpu up -d`.

Mapeo `"${EYAS_PORT:-3100}:3100"` — 3100 para no chocar con Grafana/CRA en :3000. Ver [Varias instancias](/docs/es/deploy/multi-instance/).

### Claude Code en un contenedor

La imagen no contiene el CLI de Claude Code. Sin él, EYAS recurre a la copia más antigua incluida en su dependencia Agent SDK (hoy 2.1.89) y `eyas doctor` avisa de ello. Para ejecutar un Claude Code actual, instálalo en una imagen derivada o móntalo, y define `EYAS_CLAUDE_CODE_BIN` con su ruta absoluta. Inicia sesión con `ANTHROPIC_API_KEY` o con un login provisionado: el proveedor solo está disponible cuando ese binario tiene la sesión iniciada. Ver [Proveedores — Runtime de Claude Code](/docs/es/ai/providers/#claude-code-runtime).

### Grok y Kimi en un contenedor

Grok CLI y Kimi Code CLI se ejecutan en el directorio personal propio de EYAS dentro del volumen de datos (`data/cli-homes/…`), así que inician sesión **para EYAS**, no con un login incluido en la imagen. Usa **Iniciar sesión con un código de dispositivo** en el panel del proveedor: EYAS muestra un enlace y un código, y lo confirmas en un navegador de cualquier otro dispositivo — el contenedor no necesita navegador. Grok también acepta una clave de API de xAI, guardada en Secretos. Los inicios de sesión viven en el volumen `eyas-data` y sobreviven a los reinicios del contenedor. Para un binario que no está en el PATH del contenedor, usa `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`. Ver [Proveedores — Iniciar sesión de Grok y Kimi para EYAS](/docs/es/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Sandbox de archivos del kernel en un contenedor

La imagen de EYAS **no** incluye bubblewrap: es LGPL, así que instalarlo es decisión tuya. Sin él, las herramientas propias de los proveedores CLI (el shell de Claude Code, las herramientas de Grok CLI) se ejecutan sin el sandbox de archivos del kernel; EYAS sigue rechazando cada petición que ve, el panel del proveedor muestra el sandbox como *No disponible en este servidor* y, con `security.cliSandbox: required`, los turnos de CLI con herramientas se rechazan. Para tener la capa del kernel, instala bubblewrap (`bwrap`) — más `socat` para Claude Code — en una imagen derivada y ejecuta el contenedor con los user namespaces sin privilegios habilitados. `eyas doctor` (`docker compose exec eyas eyas doctor`) muestra el resultado en su línea **CLI sandbox**. Ver [Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox).

### Zona horaria

Los contenedores suelen correr en UTC. La fecha y la hora que EYAS le dice al modelo siguen `i18n.timezone` o, si no, el `TZ` del contenedor — ver [Configuración — Zona horaria](/docs/es/deploy/configuration/#time-zone-of-the-models-clock).

## Relacionado

- [Nativo](/docs/es/deploy/native/)
- [Kubernetes](/docs/es/deploy/kubernetes/)
- [Varias instancias](/docs/es/deploy/multi-instance/)
