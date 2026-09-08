---
title: "Lienzos de diseño"
description: "Dibuja UI, landing, impresión o deck — luego adjúntalos a una conversación o proyecto."
---

**Para qué sirve.** Un diseño es un conjunto de mesas de trabajo en un lienzo con panorámica y zoom. Lo creas, importas o pides a un agente; lo editas a mano, en el lienzo o por IA; lo versionas y lo adjuntas para que la conversación lo vea. El formato de archivo es el de Claude Design; el runtime es el de EYAS.

## Cuándo usarlo

- Diseñas una UI, un landing, una pieza impresa o un deck y lo quieres en EYAS, no solo en una herramienta externa.
- Quieres que un agente lea mesas con nombre (tokens, components, page) en vez de adivinar un look.
- Importar un lienzo Claude Design publicado, o exportar PNG/PDF.
- Una conversación o proyecto debe llevar el lienzo en cada turno.

## Flujo típico

1. Abre **Diseño** en la barra lateral (**Contenido**) — ruta `/design`.
2. Escribe un nombre y pulsa **New** (o **Import** del HTML publicado).
3. Edita en el lienzo, en **Source** o en el panel **AI**. **Save** (una versión por guardado).
4. En una conversación, el icono **Diseños** para adjuntarlo. El agente debería poder pedir partes; el lienzo aparece con visto.

Un diseño es un conjunto de mesas de trabajo dispuestas en un lienzo con
desplazamiento y zoom. Cada mesa es un archivo `.dc.html`; `canvas.json` registra
dónde está cada una, a qué página pertenece y en qué vista aterriza una apertura
nueva. Las imágenes viven en el lienzo con su propio nombre de archivo.

El formato de archivo es el de Claude Design: un lienzo creado allí se importa y
se representa aquí, y uno exportado desde aquí se vuelve a generar allí. EYAS lo
representa con su propio motor — las dos herramientas comparten un formato, no
código.

## Crear un diseño

En `/design`, escribe un nombre y pulsa **Nuevo**. Obtienes una mesa de arranque
para sustituir.

**Importar** acepta el HTML completo de una página de lienzo publicada. Se rechaza
una página cuyo contenido vive en el almacén de la plataforma anfitriona en vez de
en la propia página: su copia incrustada es solo una instantánea obsoleta de la
primera apertura, e importarla te daría en silencio una versión vieja.

También puede crearlo un agente. Todo lo que produce un agente pasa por las mismas
comprobaciones que tus propias ediciones.

## Moverse por el lienzo

Arrastra el fondo. La rueda desplaza, **Mayús**+rueda en horizontal y
**Ctrl/⌘**+rueda hace zoom, anclado en el puntero: lo que está bajo el cursor se
queda ahí. **Fit** encuadra todo lo de la página.

El desplazamiento funciona en el espacio *alrededor* de las mesas, no encima. Una
mesa es un marco aislado que conserva sus propios eventos de ratón: eso es
justamente lo que permite que un prototipo interactivo funcione.

Si el lienzo tiene varias páginas, los botones aparecen en la cabecera.

## Abrir una sola mesa de trabajo

Junto a cada nombre hay un control de apertura — o haz doble clic en el nombre. La
mesa ocupa la vista ella sola, y **Esc** te devuelve donde estabas.

Cómo se abre es una propiedad suya: por defecto se reduce entera para caber; una
mesa marcada para rellenar se ensancha al ancho de la vista a escala natural y se
desplaza, que es lo que quiere un diseño de ancho fluido.

## Tres formas de editar

**Sobre el lienzo.** Abre **Editar** y haz clic en un elemento. El panel de
propiedades cambia su tipografía, color, caja, borde y disposición; una cuadrícula
de columnas todas iguales se edita como un simple número de columnas. El texto se
edita en el sitio salvo que provenga de la lógica de la mesa — el panel lo dice en
vez de sobrescribir el vínculo.

Cmd/Ctrl+Z deshace, con Mayús rehace, y nada se guarda hasta que guardas: una
versión por guardado, no por pulsación.

Una mesa marcada como interactiva conserva sus controles y se edita en el panel de
código: seleccionar elementos se tragaría los clics que necesita su prototipo.

**En el código.** El panel de código enumera todos los archivos del lienzo y los
edita directamente.

**Con IA.** Abre el panel de IA, describe el cambio, aplícalo.

Sea cual sea el resultado y venga de donde venga, se comprueba contra las reglas
del lienzo antes de guardarlo: una mesa sin elemento raíz, una entrada de
disposición que apunta a un archivo inexistente, una referencia de imagen sin nada
detrás o un atributo de estilo con una condición fuera de las llaves: todo eso se
rechaza y la versión anterior queda exactamente como estaba. Si el primer intento
del modelo falla, EYAS le muestra los problemas concretos y le pregunta una vez
más.

Funciona igual con cualquier proveedor configurado. EYAS no delega el trabajo en
las herramientas de un fabricante solo porque ese esté configurado: el prompt, las
comprobaciones y el resultado guardado son idénticos en ambos casos.

Una edición por IA en un proveedor CLI y un lienzo grande puede tardar varios
minutos. El panel cuenta el tiempo transcurrido mientras dura, y salir de la
página no la cancela. Cada intento queda registrado, así que el panel sigue
informando del último después — aplicada, fallida con su motivo, o interrumpida
por un reinicio del servidor — aunque la página se recargara o la conexión se
cortara a mitad. Mientras una edición está en curso no puede iniciarse otra
sobre el mismo lienzo.

## Ajustes

Las fichas de ajuste vienen de las opciones que la propia mesa declara. Cambiar
una vuelve a representar al instante; fijarla escribe el valor como nuevo valor
por defecto de la mesa.

## Versiones

Cada cambio es una versión, con quién lo hizo, qué fue y si vino de una persona,
una importación o la IA. Restaurar una versión antigua la copia hacia delante como
nueva, así que nunca se pierde nada.

## Nombrar las mesas para que se puedan encontrar

Tus agentes no leen el lienzo entero — mira la sección siguiente. Leen un índice
que clasifica cada mesa por el papel que cumple, y una mesa bien nombrada la
encuentran. El vocabulario:

| Papel | Qué le corresponde |
|---|---|
| **tokens** | La paleta, los espaciados, los radios: los valores a los que todo lo demás se refiere |
| **typography** | La escala tipográfica, los pesos, las familias |
| **components** | Botones, campos, distintivos: las piezas, en sus estados |
| **patterns** | Esas piezas compuestas: tarjetas, listas, barras de herramientas |
| **page** | Una pantalla completa o una página impresa |

El papel se lee del título en `canvas.json` y después del nombre del archivo. Un
diseño con *Tokens*, *Tipografía* y *Componentes* se puede navegar; cinco mesas
llamadas *Frame 1* a *Frame 5* hay que abrirlas al azar. Los diseños generados por
la IA ya vienen nombrados así.

Un lienzo de sistema de diseño debería llevar al menos una mesa tokens y una
typography.

## Adjuntar un diseño

**A una conversación.** El icono **Diseños** de la cabecera adjunta un lienzo. El
número indica cuántos están en juego; el desplegable enumera todos con una marca
en los adjuntos. Los agentes también pueden adjuntar y quitar.

**A un proyecto.** En **Proyectos → editar**. Una conversación creada en el
proyecto empieza con los diseños del proyecto y a partir de ahí son suyos: quitar
uno afecta solo a esa conversación. Si están puestos en el proyecto, las nuevas
conversaciones los reciben; si no, no. Cambiarlos después no alcanza a las
conversaciones existentes.

Es el mismo comportamiento que las fuentes de código y las carpetas de trabajo.

## Qué ve un agente de un diseño adjunto

El lienzo no: serían decenas de miles de caracteres por turno. Y sus valores
tampoco: un **aviso**. El diseño dice que está adjunto y qué TIPO de datos
contiene cada una de sus partes — tokens (colores, espaciados, radios),
tipografía, componentes, patrones. Para el diseño Odoo de cinco mesas y 46 KB
son **652 caracteres**, y se mantiene así aunque el diseño crezca.

El agente pide después solo lo que necesita: `design_read` con `part` devuelve
los valores derivados de una parte; `design_read` con `file`, el marcado
completo de una mesa.

**¿Por qué no incluir la paleta sin más?** Estuvo incluida un tiempo. El bloque
se paga en **cada turno**; una consulta, **una vez**. A partir de dos turnos la
consulta ya sale más barata, y es la única forma cuyo coste no crece con el
lienzo — por eso incluso un diseño pequeño se avisa en lugar de incrustarse.

El bloque además le indica que siga el diseño, en vez de limitarse a señalar que
hay uno adjunto.

## Exportar e imprimir

El menú de exportación ofrece dos cosas.

**Archivos** entrega el lienzo en sí: una página HTML autónoma que se abre en
cualquier navegador, o un documento de lienzo portátil desde el que otra
herramienta puede volver a generar.

**Impresión** representa el diseño a través de un navegador real: PNG de la mesa
seleccionada en resolución normal o doble, PDF de esa mesa, o un único PDF de todo
el lienzo.

Cómo se imprime una mesa es una propiedad suya. Una mesa **fija** —la opción por
defecto, y lo que es un cartel, un folleto o una página de catálogo— sale como
exactamente una página con exactamente su tamaño en el lienzo. Una mesa **con
flujo** —una nota, un informe— se pagina en A4 o Carta según elijas; una columna
más ancha que la página se reduce, y una más estrecha se queda en el ancho para el
que se diseñó en lugar de ampliarse.

El PDF del lienzo completo coloca cada mesa en su propia página, en el orden en
que las leerías: página por página, luego de arriba abajo, luego de izquierda a
derecha. Las páginas conservan su tamaño, así que un folleto con mesas de
distintos tamaños se exporta correctamente en vez de forzarse a un único tamaño.

Imprimir requiere un navegador instalado junto a EYAS. Si no lo hay, las opciones
de impresión se desactivan y el menú indica qué instalar. Todo lo que está bajo
**Archivos** funciona igual.

## Cambiar el nombre y borrar

Haz clic en el título de la cabecera, escribe y pulsa Intro. Esc cancela.

El icono de papelera a la derecha de la cabecera borra el diseño entero.
Pregunta antes, y la pregunta nombra lo que se va con él: cada versión guardada
y cada conversación o proyecto al que el diseño esté vinculado. No hay deshacer
ni papelera de la que recuperarlo.
