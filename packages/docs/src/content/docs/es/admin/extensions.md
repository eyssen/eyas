---
title: Extensiones
description: Instala, activa y revisa paquetes de habilidades de terceros sin salir de licencias compatibles con MIT.
---

**Para qué sirve.** Extensiones es el catálogo de paquetes de habilidades y herramientas que no se pudieron incluir con EYAS por la licencia. EYAS sigue siendo MIT. GPL, LGPL, AGPL y SSPL (y copyleft similar) no van dentro del producto; aquí aceptas, paquete a paquete, tras leer el aviso. Así añades habilidades u herramientas compañeras sin mezclar licencias prohibidas en el árbol núcleo.

## Cuándo usarlo

- Quieres un paquete de habilidades que no está en el catálogo incluido.
- Necesitas un CLI o servicio compañero (conversión de documentos, antivirus, SAST) con el que EYAS habla como proceso aparte.
- Debes comprobar si un paquete es compatible con MIT, copyleft o propietario antes de instalarlo.
- Quieres desactivar un paquete sin desinstalarlo, o quitarlo del todo.

## Flujo típico

1. Abre en la barra lateral **Ajustes** → grupo **Módulos** → **Extensiones** (`/extensions`).
2. Lee **Paquetes de instalación automática** y **Herramientas de terceros compatibles**. Cada tarjeta muestra nombre, insignia de licencia, versión, autor y número de habilidades.
3. En un paquete automático, **Instalar**. Lee el **Aviso de licencia** y **Aceptar e instalar** (o **Cancelar**).
4. Tras instalar, el interruptor **Activar** / **Desactivar**; la papelera desinstala.
5. En un paquete de terceros, abre **GitHub**, sigue la **Guía de configuración** e instálalo tú bajo su licencia. EYAS no lo descarga por ti.

Debes ver la insignia **Instalado** y el recuento de instalados en la cabecera.

## Funciones

El subtítulo fija la regla: algunas herramientas y paquetes no se pudieron incluir; los automáticos los descarga EYAS con tu consentimiento; las de terceros hay que bajarlas de su fuente original bajo su licencia.

Insignias de licencia:

| Clase | Significado |
|-------|-------------|
| Compatible con MIT | MIT, Apache-2.0, BSD, ISC, Unlicense y similares — empaquetables en principio |
| Copyleft | GPL, LGPL, AGPL, MPL, CC-BY-SA y similares — no incluidos; instalar es un opt-in. Los copyleft que EYAS puede bajar corren como **proceso aparte**, no enlazados en EYAS |
| Propietario | EYAS no lo distribuye; lo bajas tú |
| Unknown | La cadena de licencia no clasificó |

Los **Paquetes de instalación automática** llegan como archivo (suma SHA-256 si está publicada), se extraen bajo el directorio de datos y se registran con la licencia aceptada. **Instalar** se rechaza si no aceptas el aviso. Los manuales no se autoinstalan.

Los paquetes activados aportan sus archivos de habilidad al catálogo de [Habilidades](/docs/es/automation/skills/). El recuento de la tarjeta es cuántas declara (cero en la mayoría de herramientas compañeras). Desactivar deja de cargarlas; desinstalar borra el directorio y la fila de la BD.

No instales un paquete cuya licencia no puedas cumplir. Que EYAS siga siendo MIT no anula los términos del paquete.

## Campos y controles

<h2 id="catalogue">Catálogo</h2>

| Control | Significado |
|---------|-------------|
| Recuento instalado | Cabecera: cuántos paquetes hay instalados |
| **Paquetes de instalación automática** | EYAS puede descargarlos tras el consentimiento |
| **Herramientas de terceros compatibles** | Las bajas de la fuente original |
| Nombre / descripción / versión / **por** autor | Identidad del paquete |
| Insignia de licencia | SPDX, coloreada por clase |
| **Instalado** | El paquete está en disco |
| Recuento de habilidades | Cuántas habilidades declara |
| Etiquetas | Chips de filtro si hay |

<h2 id="install">Instalar, activar, desactivar</h2>

| Control | Significado |
|---------|-------------|
| **Instalar** | Iniciar el consentimiento de un paquete automático |
| **Aviso de licencia** | Texto completo que debes aceptar |
| **Aceptar e instalar** | Licencia aceptada y descarga |
| **Cancelar** | Cerrar el aviso sin instalar |
| **Instalando…** | Descarga en curso |
| Interruptor | **Activar** / **Desactivar** un paquete automático instalado |
| Papelera | Desinstalar un paquete automático instalado |
| **GitHub** | Abrir la página origen de un paquete manual |
| **Guía de configuración** / **Ocultar detalles** | Expandir o plegar el texto de instalación manual |

<h2 id="recordly">Recordly (compañero AGPL)</h2>

Recordly es un grabador de pantalla de escritorio (zooms, cursor, webcam). **AGPL-3.0**: EYAS no lo incluye ni lo instala. La tarjeta está en **Herramientas de terceros**. Descárgalo de GitHub, exporta **MP4/GIF** en Recordly y adjunta el archivo en [Documentos](/docs/es/knowledge/documents/). No hay tool de agente `recordly_*`. Cortes posteriores en esta máquina: [Video Use](/docs/es/studio/videouse/). **No** es un motor de [Estudio](/docs/es/studio/).

## Relacionado

- [Resumen de ajustes](/docs/es/admin/settings/)
- [Notificaciones](/docs/es/admin/notifications/)
- [Nodos remotos](/docs/es/admin/nodes/)
- [Manos](/docs/es/admin/hands/)
- [Habilidades](/docs/es/automation/skills/)
- [Herramientas](/docs/es/automation/tools/)
- [Estudio](/docs/es/studio/)
- [Documentos](/docs/es/knowledge/documents/)
