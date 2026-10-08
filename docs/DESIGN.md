# Rumbo: propuesta de diseño

> PWA móvil de rutas guiadas por geolocalización: **la ruta cobra vida al llegar a cada lugar**.
> Este documento define la identidad visual, los componentes, las pantallas (con sus datos de entrada y acciones de salida), la navegación y los estados, para generar la propuesta gráfica completa.
> El plan técnico vive en `docs/PROJECT_PLAN.md`. Los nombres de estados, eventos y rutas de este documento coinciden con él.
> **Propuesta entregada (fase 1 de diseño):** los mockups están en `docs/design/mockup/` (abrir `Rumbo Mockup.dc.html`) y las capturas, en `docs/design/screens/`.
> **Idiomas:** español, inglés y portugués de Portugal ([ADR 0001](adr/0001-multilenguaje.md)).

---

## 0. Entregables de diseño

En orden de prioridad:

1. **Tokens y fundamentos:** color (claro, oscuro y alto contraste "Sol"), tipografía, espaciado, radios, sombras y movimiento.
2. **Set de marcadores del mapa:** todos los estados × categorías, el punto del usuario (normal y simulación), el trazado, la traza recorrida y el popup.
3. **Hoja de componentes** con variantes y estados (sección 7).
4. **Pantallas móviles a 390×844**, todas las de la sección 9 con sus estados: carga, vacío, error, sin conexión, GPS débil y permiso denegado.
5. **Modo oscuro** como mínimo para: Recorrido (S05), Llegada (S06), Interrupciones (S07) y Resumen (S10).
6. **Prototipo navegable de 3 flujos:**
   - **A.** Explorar → Detalle → Preparación → Recorrido → Llegada → Resumen.
   - **B.** Recorrido → Desvío → Pausar → Reanudar → Terminar.
   - **C.** Crear ruta (pasos 1 → 5) → Probar en simulación.
7. **Adaptación a escritorio y tablet** de Explorar (mapa) y del Creador (vista dividida).
8. **Exploración de marca:** logotipo/wordmark e icono de app (sección 4.4). Es provisional.

**Estado (2026-10-08).** Entregado:
- los fundamentos (paletas clara, oscura y «Sol», y la tipografía);
- el set de marcadores;
- el wordmark;
- las pantallas del flujo de recorrer rutas, con sus estados: S00 Idioma, S01, S03, S04 y S05–S10;
- el modo oscuro de S05–S08 y S10;
- el prototipo de los flujos A y B.

Construido con este mismo sistema en la fase 4, sin mockup propio: el onboarding y el consentimiento, S02 Mis rutas (estado vacío), S11 Recuperar recorrido, S12 Ajustes y el panel de filtros.

Construido con este mismo sistema en la fase 6, sin mockup propio: el creador (C1, C2, C4 y C5) y S02 Mis rutas completa (lista, editar, eliminar y estado de subida). El flujo C no tiene prototipo navegable.

Construido con este mismo sistema en la fase 7, sin mockup propio: C3 Fichas, los intereses y «Usar mi ubicación» de C1, la hoja «Sugerir lugares» de C2, la línea de fichas de C4 y la pregunta rápida de S06. El Stepper del creador pasó a 4 pasos.

Falta, y se diseñará con este mismo sistema al construir cada pantalla:
- el editor de fichas de C3 (texto, datos, carrusel de imágenes y URL de video; aplazado);
- el último recorrido de cada ruta en S02 (aplazado);
- las variantes S06c, S06d y S06f (hay una primera versión en código);
- tablet y escritorio, salvo el reparto en dos columnas de C2;
- el tema «Sol» aplicado a pantallas;
- el icono de la app.

---

## 1. El producto en 30 segundos

- **Qué hace:** el usuario elige una ruta (o la crea) y la recorre andando, corriendo o en bici. Cuando entra en la zona de un punto, el móvil vibra o suena y se abre una experiencia: una ficha del lugar, un video, un quiz o una web.
- **Modo Libre:** visitar puntos en cualquier orden. Turismo, museos, ciudad.
- **Modo Reto:** orden obligatorio, checkpoints, cronómetro y meta. Hiking, running, ciclismo.
- **Rutas curadas:** experiencias diseñadas por nosotros, con interacciones variadas.
- **Rutas del usuario (planificador de viaje):** el usuario elige lugares y orden, y la IA prepara la ficha de cada uno a partir de fuentes reales.
- **Durante el recorrido** pueden ocurrir: **llegada**, **desvío**, **mucho tiempo quieto**, **punto fuera de orden** y **tiempo agotado**. Cada interrupción ofrece **Continuar · Pausar · Terminar**.

---

## 2. Usuarios y contexto de uso

| Perfil | Necesita |
|---|---|
| Turista o visitante de una ciudad | Saber adónde ir y qué está viendo sin leer una guía |
| Familia o grupo | Algo entretenido y fácil de seguir; algún quiz o juego |
| Planificador de viaje | Montar su propio itinerario rápido y que funcione como guía en el sitio |
| Deportista (hiking, running, bici) | Checkpoints claros, tiempo, distancia, avisos sin mirar la pantalla |

**Condiciones reales de uso** (condicionan todo el diseño):

- **Exterior y a pleno sol:** contraste alto y textos grandes.
- **En movimiento:** lectura en ~2 segundos, una mano, pulgar.
- **Atención dividida:** el usuario mira la calle, no el móvil. La app debe avisar con vibración y sonido.
- **Red intermitente:** hay que mostrar con claridad qué funciona sin conexión.
- **Batería:** las pantallas de recorrido usan fondos sobrios y no tienen animaciones permanentes, salvo el pulso del siguiente punto.
- **Bici o guantes:** los controles críticos del recorrido miden 56 px como mínimo.

---

## 3. Principios de diseño

1. **El mapa manda.** Durante el recorrido, el mapa ocupa la pantalla y la información flota encima.
2. **Legible de un vistazo.** Tres datos importan en movimiento: **adónde voy, cuánto falta y cuánto llevo**.
3. **Una acción principal por pantalla.**
4. **La llegada es el momento estrella.** Tiene que sentirse como un pequeño premio (animación breve, hápticos, contenido que entra con gracia).
5. **Interrupciones amables, nunca culpables:** "Te alejaste de la ruta", no "Error: fuera de ruta".
6. **Nunca solo color.** Cada estado de un punto tiene también forma o icono (candado, check, anillo).
7. **Honestidad:** contenido de IA etiquetado, fuentes visibles, créditos de las imágenes y atribución del mapa siempre presente.

---

## 4. Marca

### 4.1 Nombre provisional

**Rumbo.** Funciona en español y portugués (rumo): dirección, curso, ir hacia algún sitio.

### 4.2 Personalidad

Un guía local con curiosidad: cálido, seguro y discreto. Mezcla de **revista de viajes** (fotografía y títulos con carácter) y **herramienta de navegación** (precisión y claridad).

### 4.3 Tono de voz (español, tuteo)

- **Breve, cercano y en positivo:** "Llegaste a Castelo de Leiria", "Te faltan 340 m".
- **Celebra sin exagerar:** "¡Ruta completada!".
- **En lo técnico, explica qué hacer:** "Señal GPS débil. Sal a un espacio abierto."
- **Formato de números:** "3,4 km", "340 m", "~2 h", "1:05:23". Por debajo de 1 km, en metros redondeados a 10.

**En inglés:** el mismo tono, en segunda persona y con frases cortas: "You've arrived at Castelo de Leiria", "340 m to go". Decimales con punto: "3.4 km".

**En portugués de Portugal:** trato de «tu» y vocabulario europeo, como en el mockup de S00 («Escolhe o teu idioma», «Definições», «ecrã», «telemóvel»). Decimales con coma, como en español: "3,4 km".

Los nombres propios de los lugares (Castelo de Leiria, Sé de Leiria…) no se traducen.

### 4.4 Exploración de logotipo (provisional)

- **Wordmark** "rumbo" en minúsculas (serif editorial, Fraunces SemiBold). La "o" final se convierte en un **pin/brújula**: un círculo con una aguja. Diseño original.
- **Icono de app:** cuadrado azul Azulejo con una línea de ruta color Arena que termina en un pin Terracota.
- **Motivo gráfico opcional:** patrón geométrico **original** inspirado en baldosas (azulejo), para el onboarding, los estados vacíos y la cabecera del resumen. Nunca dentro de las pantallas de recorrido.

---

## 5. Sistema visual

### 5.1 Paleta: "Atlántico, Azulejo y Terracota"

La paleta toma referencias de Portugal (punto de partida en Leiria) pero sirve para cualquier ciudad. Hay que evitar el look de "SaaS azul genérico".

**Tema claro (por defecto):**

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#F7F3EC` (Arena) | Fondo general |
| `--color-surface` | `#FFFFFF` | Tarjetas, hojas, HUD |
| `--color-surface-2` | `#EFE9DE` | Fondos secundarios, skeletons |
| `--color-border` | `#E2DACB` | Bordes y separadores |
| `--color-text` | `#16191D` (Tinta) | Texto principal |
| `--color-text-muted` | `#5B6470` | Texto secundario (≥ 5,4:1 sobre Arena) |
| `--color-primary` | `#1E4FA3` (Azulejo) | Acciones principales, enlaces, traza recorrida (7,8:1 con blanco) |
| `--color-primary-hover` | `#183F82` | Hover/pressed |
| `--color-secondary` | `#0B7A75` (Atlántico) | Modo Libre, trazado planificado (5,2:1 con blanco) |
| `--color-accent` | `#C4491F` (Terracota) | **Siguiente punto**, llegada, modo Reto (4,9:1 con blanco) |
| `--color-accent-soft` | `#F6D3C4` | Fondos suaves de acento |
| `--color-success` | `#1A7F45` | Punto completado (5,0:1 con blanco) |
| `--color-warning` | `#8A5A00` sobre `#FFF1CC` | GPS débil, avisos. Los símbolos del mapa usan `#B07400` (§6.1) |
| `--color-danger` | `#C0362C` | Terminar, errores (5,5:1 con blanco) |
| `--color-locked` | `#8A94A0` | Puntos bloqueados (solo iconos y rellenos, nunca texto) |
| `--color-user` | `#2F80ED` | Punto "estás aquí" |
| `--color-sim` | `#7C3AED` | Todo lo relativo al modo simulación |

**Tema oscuro:**

| Token | Valor |
|---|---|
| `--color-bg` | `#0F1318` |
| `--color-surface` | `#171C22` |
| `--color-surface-2` | `#1F262E` |
| `--color-border` | `#2C343E` |
| `--color-text` | `#EEF1F4` |
| `--color-text-muted` | `#A3ADB8` |
| `--color-primary` | `#8DB0F2` (texto encima: `#0F1318`) |
| `--color-secondary` | `#3FC1B7` |
| `--color-accent` | `#F2875A` |
| `--color-success` | `#4CC38A` |
| `--color-warning` | `#F2C14E` |
| `--color-danger` | `#FF7A6E` |
| `--color-locked` | `#6B7581` |
| `--color-user` | `#4A9BFF` |
| `--color-sim` | `#A78BFA` |

**Tokens de apoyo** (salen de los mockups):

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--color-on-primary` | `#FFFFFF` | `#0F1318` | Texto sobre el primario |
| `--color-on-accent` | `#FFFFFF` | `#0F1318` | Texto sobre el acento |
| `--color-accent-soft` | `#F6D3C4` | `#3A2219` | Fondos suaves de acento (consejo de la ficha, HUD) |
| `--color-free-soft` / `--color-free-text` | `#D7ECEA` / `#0B6B66` | `#12302E` / `#3FC1B7` | Badge del modo Libre |
| `--color-challenge-soft` / `--color-challenge-text` | `#F6D3C4` / `#A33A12` | `#3A2219` / `#F2875A` | Badge y caja de reglas del modo Reto |
| `--color-success-soft` | `#DDF0E4` | `#12301F` | Respuesta correcta del quiz |
| `--color-danger-soft` | `#F8DEDB` | `#3A1A17` | Respuesta incorrecta del quiz |
| `--color-warning-bg` | `#FFF1CC` | `#2E2610` | Fondo de los avisos (GPS débil, sin conexión) |
| `--color-scrim` | `rgba(22,25,29,.45)` | `rgba(0,0,0,.6)` | Velo bajo hojas y diálogos |

**Alto contraste "Sol"** (para exterior, se activa en Ajustes):

- Fondo `#FFFFFF`, texto `#000000`, primario `#0B3A80`, acento `#A33A12`.
- Bordes de 2 px en todos los controles.
- HUD dos pasos más grande.
- Marcadores un 20 % más grandes y con contorno más grueso.

**Colores por ruta en el mapa Explorar** (cuando conviven varias rutas): Azulejo `#1E4FA3`, Atlántico `#0B7A75`, Terracota `#C4491F`, Uva `#6D4AA8`, Pinar `#1A7F45`. El color de una ruta va siempre acompañado de la leyenda.

### 5.2 Tipografía

Las dos son fuentes abiertas (licencia OFL). Van alojadas en la propia app (`@fontsource`), no se cargan desde Google Fonts: así funcionan sin conexión y no envían la IP del usuario a terceros.

- **Fraunces** (serif con carácter): nombres de rutas, títulos de fichas, momentos editoriales.
- **Inter** (UI): todo lo demás. Cifras **tabulares** (`font-feature-settings: "tnum"`) en distancias y tiempos.

| Estilo | Fuente | Peso | Tamaño/interlínea | Uso |
|---|---|---|---|---|
| `display` | Fraunces | 600 | 30/36 | Onboarding, cabecera del resumen |
| `h1` | Fraunces | 600 | 26/32 | Nombre de la ruta en el detalle, título de la ficha |
| `card-title` | Fraunces | 600 | 19/24 | Nombre de la ruta en la tarjeta |
| `h2` | Inter | 700 | 20/26 | Secciones |
| `title` | Inter | 600 | 17/22 | Elementos de lista, nombre del punto en el HUD |
| `body` | Inter | 400 | 16/24 | Texto general |
| `body-strong` | Inter | 600 | 16/24 | Énfasis |
| `small` | Inter | 400 | 14/20 | Metadatos |
| `caption` | Inter | 600 | 12/16 | Etiquetas en mayúsculas (+0,04 em) |
| `hud-distance` | Inter | 700 | 34/38 | Distancia al objetivo (tabular) |
| `hud-label` | Inter | 600 | 13/16 | "SIGUIENTE · 3/8" en mayúsculas |

### 5.3 Espaciado, radios, sombras y movimiento

- **Espaciado** (base 4): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48. Margen lateral de 16 px en móvil y 24 px en tablet.
- **Radios:**
  - `xs` 6: badges.
  - `sm` 10: chips e inputs.
  - `md` 14: tarjetas.
  - `lg` 20: esquinas superiores de las hojas.
  - `pill` 999.
- **Sombras:**
  - `e1`: tarjetas, `0 1px 2px rgba(22,25,29,.08)`.
  - `e2`: HUD y botones flotantes sobre el mapa, `0 6px 18px rgba(22,25,29,.12)`.
  - `e3`: modales, `0 16px 40px rgba(22,25,29,.18)`.
- **Movimiento:**
  - Duraciones: `fast` 120 ms, `base` 200 ms, `slow` 320 ms.
  - Hojas: 360 ms con `cubic-bezier(.2,.8,.2,1)`.
  - Llegada: 700 ms.
  - Pulso del siguiente punto: 2 s en bucle.
  - Con `prefers-reduced-motion`, todo pasa a fundidos simples y sin pulso; el siguiente punto se distingue entonces por el anillo estático.
- **Iconos:** Lucide, 24 px, trazo de 2 px. Categorías:

| Categoría | Icono |
|---|---|
| `monument` | castle |
| `museum` | landmark |
| `church` | church |
| `viewpoint` | binoculars |
| `nature` | trees |
| `food` | utensils |
| `culture` | drama |
| `checkpoint` | flag |
| `start` | circle-play |
| `finish` | bandera a cuadros (personalizada) |
| `other` | map-pin |

---

## 6. El mapa

El mapa es **ArcGIS** (Esri). Hay que diseñar sobre sus mapas base, no inventar uno.

- **Mapas base:**
  - Ciudad: estilo calles/navegación, claro.
  - Naturaleza o bici: topográfico.
  - Modo oscuro: el mapa base oscuro.
- **La atribución de Esri es obligatoria y visible** (esquina inferior). Ningún control flotante ni el *peek* de la hoja pueden taparla: hay que reservarle una franja de 20 px.
- **Controles:** sin botones de zoom en móvil (se usa pellizco). Botones flotantes de 48 px a la derecha: Recentrar, Capas/Filtro y, en modo demo, Simulación.

### 6.1 Marcadores de puntos

Base común:

- Círculo de 36 px con aro blanco de 2,5 px y sombra `e1`.
- Icono de categoría blanco de 18 px.
- Badge de orden (círculo de 18 px, Inter 700 de 11 px) arriba a la derecha.

| Estado visual | Origen (datos) | Aspecto |
|---|---|---|
| **Activo** | `state: 'active'` (Libre) | Relleno Azulejo, icono de categoría |
| **Siguiente / objetivo** | `target.pointId` | Relleno Terracota, **44 px**, halo pulsante (Terracota 40 % → 0), etiqueta con el nombre debajo a zoom ≥ 16 |
| **Bloqueado** | `state: 'locked'` (Reto) | Relleno gris (`--color-locked`), **candado** de 14 px, 30 px, sin etiqueta |
| **Llegando** | `target.dwellProgress` entre 0 y 1 | Anillo de progreso alrededor del marcador objetivo |
| **Alcanzado** | `state: 'reached'` | Terracota con anillo girando (la acción está abierta) |
| **Completado** | `state: 'completed'` | Relleno Pinar (éxito) con **check**; mantiene el badge de orden |
| **Opcional** | `required: false` | Aro blanco **discontinuo** |
| **Meta** | `category: 'finish'` | Relleno Tinta, bandera a cuadros, 44 px |

- **Zona del objetivo:** cuando faltan ≤ 150 m, se dibuja el círculo del radio en Terracota al 10 % con borde del 40 %. Comunica "entra aquí".
- **Mapa Explorar:** el relleno es el **color de la ruta** (no el estado), con el icono de categoría.
- **Solapamiento (creador):** un lugar cuya zona se solapa con la de otro lleva un **aro ámbar** alrededor del marcador y una **insignia triangular «!»** arriba a la izquierda, frente a la insignia de orden, así que no depende solo del color (§12). Su círculo de radio se dibuja en el mismo ámbar (relleno al 20 %, borde al 90 %, 2 px). Los demás círculos del creador usan el estilo de la zona del objetivo (Terracota al 10 %, borde al 40 %).
  - El ámbar del mapa es `#B07400`, no `--color-warning` (`#8A5A00`). Los símbolos del mapa son imágenes y no leen variables CSS, y `#8A5A00` queda por debajo de 3:1 sobre un gris oscuro como el del mapa base oscuro. `#B07400` da 3,9:1 con blanco y se distingue sobre el mapa claro y el oscuro.

### 6.2 Usuario, trazado y traza

- **Usuario:**
  - Punto de 18 px `--color-user` con aro blanco de 3 px.
  - Halo de precisión del mismo color: relleno al 15 % y borde al 35 %.
  - Cono de rumbo de 60° en degradado.
  - **Simulación:** todo en `--color-sim` con la etiqueta "SIM".
- **Trazado planificado (`path`):** Atlántico, 4 px, discontinuo 8/6, al 80 %.
- **Traza recorrida (`track`):** Azulejo, 5 px, sólida, extremos redondeados.

### 6.3 Popup al tocar un marcador (requisito del proyecto)

- **Siempre existe y siempre es un popup** (no se sustituye por otra cosa). Es una tarjeta compacta dentro del popup de ArcGIS, estilizada con CSS:
  - Imagen 16:9, si la hay.
  - Nombre (Fraunces 17).
  - Chips de categoría y estado.
  - Distancia ("a 340 m").
  - Acciones: **Ver ficha** o **Ir a este punto** (solo en modo Libre). En el recorrido, **Ver ficha** solo sale en los puntos ya visitados que tienen una ficha o una hoja con algo que mostrar, y la abre en vista previa (S05).
- **En Explorar** muestra además el nombre de la ruta y la acción **Ver ruta**.

---

## 7. Componentes

| Componente | Variantes y estados |
|---|---|
| **Button** | `primary` (Azulejo), `accent` (Terracota, solo momentos de llegada o reto), `secondary` (contorno), `ghost`, `danger` (texto rojo). Tamaños: L 56 px (recorrido), M 48 px, S 40 px (solo escritorio). Estados: hover, pressed, disabled, loading |
| **IconButton flotante** | Círculo de 48 px sobre el mapa, `surface` + `e2`. Estado activo (p. ej. seguir posición) |
| **ModeBadge** | **Libre** (fondo Atlántico suave + brújula) · **Reto** (fondo Terracota suave + bandera) |
| **ActivityBadge** | A pie · Correr · Bici |
| **StatChip** | Icono + valor + etiqueta ("3,4 km", "~2 h", "12 puntos", "Límite 1 h 30") |
| **RouteCard** | Portada 16:9, ModeBadge sobre la imagen, título Fraunces, fila de stats, etiqueta "Creada por ti" (rutas de usuario). Estados: normal, sin portada (patrón de marca), skeleton |
| **PointListItem** | Burbuja de orden (color del estado), miniatura de 48 px, nombre, categoría · distancia. Estados: bloqueado (atenuado + candado), activo, **siguiente** (barra Terracota a la izquierda), completado (check + hora). En el recorrido, un punto visitado con ficha lleva a la derecha un botón secundario «Ver ficha». La variante del creador es la **PlaceListItem** (abajo) |
| **HudTarget** | Tarjeta flotante superior: flecha de 40 px que **gira hacia el objetivo**, etiqueta "SIGUIENTE · 3/8", nombre, **distancia grande** + ETA. Estados: normal · acercándose (borde Terracota pulsante) · **confirmando llegada** (anillo de progreso + "Confirmando llegada…") · sin rumbo (punto cardinal "NE" en vez de flecha) · GPS débil (franja ámbar) · en pausa (atenuado) · modo Libre ("MÁS CERCANO", tocable para elegir otro) |
| **GpsIndicator** | Chip: `good` (oculto o punto verde) · `weak` (ámbar "GPS débil") · `lost` (rojo "Sin señal") · `denied` (rojo + icono) · `waiting` ("Buscando señal…") |
| **BottomSheet** | Puntos de anclaje: *peek* (96 px), medio y completo. Asa visible y cabecera fija |
| **ProgressBar** | Segmentada, un segmento por punto (≤ 15 puntos; continua si hay más), con los colores de estado |
| **ContentSheet** | Ficha del lugar (ver S06) |
| **DecisionSheet** | Icono, título, texto y 3 acciones apiladas (principal, secundaria, terminar) |
| **QuizCard** | Pregunta, 2-4 opciones grandes, estados correcto e incorrecto, explicación, "+50 pts" |
| **VideoCard** | Miniatura + play + título + duración. Error ("Video no disponible") |
| **ExternalLinkCard** | Dominio, título y aviso "Se abrirá en el navegador" |
| **CheckpointToast** | "✅ Checkpoint 3 · 00:42:10 · +50 pts". Se cierra solo a los 3 s |
| **Toast/Snackbar** | Info, éxito y aviso. Con acción opcional («Deshacer» al eliminar un lugar): el aviso con acción dura 6 s en vez de 3,5 s |
| **Banner** | Sin conexión · Modo simulación (morado) · Instala la app (iOS) · GPS débil |
| **PermissionRow** | Icono, título, descripción y estado (pendiente/concedido/denegado) + botón |
| **Stepper** | Pasos con nombre (actual, completado y pendiente), compacto en móvil. En el creador son 4: Datos · Lugares · Fichas · Revisar |
| **Inputs** | TextField, Select, SegmentedControl, Chip (filtro e interés, seleccionable), Toggle, Slider (radio con valor en metros) |
| **PlaceSearch** | Combobox accesible (WAI-ARIA 1.2) con sugerencias: icono de categoría, nombre, descripción y distancia. Estados: en reposo, cargando, con resultados, sin resultados, error y sin conexión. En móvil la lista puede abrirse **hacia arriba**, sobre el mapa, para que el teclado no la tape |
| **PlaceListItem** | Fila del creador, en dos líneas. Primera: asa de arrastre (48×48 px, no enfocable), burbuja de orden, nombre (hasta 2 líneas) y menú ⋯. Segunda, con sangría: dirección y chips que saltan de línea (radio, «Opcional», aviso de solapamiento con su texto). Se adapta al texto al 200 % |
| **OverflowMenu** | Botón ⋯ con menú (`role="menu"`, foco con las flechas; Escape o tocar fuera lo cierra). Se dibuja en una capa aparte para que ninguna lista lo recorte, y se abre hacia arriba cerca del borde inferior |
| **PlaceEditorSheet** | Hoja **no modal** del creador: sin velo, para que el mapa siga visible y vivo (el círculo cambia mientras se mueve el slider del radio) |
| **RangeSlider** | Slider con etiqueta y el valor escrito («60 m») |
| **EmptyState** | Ilustración/patrón, título, texto y llamada a la acción |
| **MiniRunBar** | Barra persistente sobre la navegación inferior cuando hay un recorrido activo y el usuario está en otra pantalla: "● Leiria histórica · Castelo 340 m" + botón para volver |
| **Dialog** | Confirmación destructiva |
| **FilterPanel / MapLegend** | Chips por ruta, categoría, modo y estado. Leyenda de colores e iconos |
| **SimControls** | Panel flotante morado: "Toca el mapa para moverte", "Caminar al siguiente punto", velocidad 1× / 5× / 20×, interruptor "GPS débil" |
| **AiBadge** | "✦ Generado con IA · Fuentes: Wikipedia" (pequeño, discreto) |
| **TriviaCard** | «Pregunta rápida» dentro de la ficha de llegada (S06): pregunta, 2-4 opciones grandes, un solo intento, ✓ o ✕ con texto, explicación y «+10 pts». No es el QuizCard de la acción `quiz` |
| **CardStatusRow** | Fila de C3: nombre del lugar, estado de su ficha («Ficha lista · 3 fuentes», «Preparando la ficha…», error…) y sus acciones. Nunca enseña el texto de la ficha |
| **SuggestSheet** | Hoja de C2 para pedir ideas a la IA: tiempo (chips), intereses, lista de lugares sugeridos con casilla, anécdota y distancia, y «Añadir N lugares» |
| **ImageCredit** | Superposición mínima con autor y licencia de la imagen |
| **Skeletons** | Tarjetas, listas y ficha |

---

## 8. Navegación

### 8.1 Mapa de pantallas

```
Idioma ─► Onboarding ─► Inicio (Explorar) ─► Detalle de ruta ─► Preparación ─► RECORRIDO ─► Resumen
                           │    ▲                                               │   ▲
                           │    └── MiniRunBar (si hay recorrido activo) ◄──────┤   │
                           │                                                    ▼   │
                           │                                    Hojas: Llegada · Interrupción · Pausa
                           │                                    (Continuar · Pausar · Terminar)
                           ├─► Mis rutas ─► Detalle de ruta
                           ├─► Crear: 1 Datos ► 2 Lugares ► 3 Fichas ► 4 Revisar y simular ► 5 Lista
                           └─► Ajustes (aquí se cambia el idioma después)
```

Idioma y Onboarding solo aparecen en el primer arranque.

El Stepper del creador muestra cuatro pasos (Datos ► Lugares ► Fichas ► Revisar) y «Lista» queda fuera de él. Las pantallas se llaman C1 a C5, y C3 es «Fichas».

### 8.2 Rutas (URL) y navegación global

| Ruta | Pantalla | Navegación inferior |
|---|---|---|
| `/welcome` | S00 Idioma (solo el primer arranque) | No |
| `/onboarding` | S00b Onboarding | No |
| `/` | S01 Inicio · Explorar | **Sí** |
| `/my-routes` | S02 Mis rutas | **Sí** |
| `/routes/:routeId` | S03 Detalle de ruta | No (flecha atrás) |
| `/routes/:routeId/prepare` | S04 Preparación | No |
| `/run` | S05 Recorrido (inmersivo) | No |
| `/run/summary` | S10 Resumen | No |
| `/create/details` · `/create/places` · `/create/content` · `/create/review` · `/create/done` | C1, C2, C3, C4 y C5 Creador | No (flecha atrás + Stepper) |
| `/settings` | S12 Ajustes | **Sí** |

- **Navegación inferior** (4 elementos): **Explorar** (brújula) · **Mis rutas** (marcador) · **Crear** (+, destacado) · **Ajustes** (engranaje).
- **Las hojas no son pantallas:** llegada, decisión y pausa se apilan sobre `/run`. El gesto atrás cierra la hoja superior.
- **Salir de `/run`:** con el gesto atrás aparece "¿Salir del mapa? La ruta sigue activa." Al salir, se muestra la **MiniRunBar** en el resto de pantallas.
- **Desde una notificación:** abre `/run` con la ficha del punto ya desplegada. Tocar un recordatorio push («¿Seguimos?») abre `/run`; un anuncio, la dirección que traiga o `/`.
- **Creador:**
  - `/create` retoma el borrador en el primer paso con algo pendiente. Cada paso exige los anteriores: sin nombre no se llega a Lugares, y sin 2 lugares no se llega a Fichas ni a Revisar.
  - `/create/content` (Fichas) nunca bloquea el paso siguiente. `/create` lo abre mientras algún lugar no tenga ficha, esté pendiente o espere conexión.
  - La flecha atrás lleva al paso anterior. En Datos sale del creador (el borrador queda guardado), y en Lista lleva a Mis rutas.
  - El gesto atrás cierra primero el editor de lugar si está abierto, como con las hojas de `/run`.
  - Editar una ruta no lleva parámetros en la URL (nada de `?edit=`): Mis rutas y el detalle de la ruta cargan la ruta en el borrador y abren `/create/details`, y «Editar ruta» del recorrido abre `/create/places` (S05).

---

## 9. Pantallas

Cada pantalla indica **Entradas** (datos que recibe), **Salidas** (acciones del usuario y su efecto), **Layout** y **Estados**.

### S00 · Idioma (primer arranque, `/welcome`)

Diseñada en el mockup (`docs/design/mockup/Idioma.dc.html`).

- **Entradas:** los idiomas del navegador (`navigator.languages`), para preseleccionar. Si ninguno es es, en o pt, español.
- **Salidas:** idioma elegido → `settings.locale` → Onboarding. No vuelve a mostrarse: después el idioma se cambia en Ajustes.
- **Layout:**
  - Cabecera con el patrón de azulejos y el icono `languages` en una tarjeta blanca.
  - Título en el idioma seleccionado («Elige tu idioma») y, debajo, el mismo título en los otros dos idiomas, para que cualquiera lo entienda.
  - Tres tarjetas de opción, de 72 px de alto. Cada una lleva una burbuja con el código (ES, EN, PT), el nombre nativo («Español», «English», «Português») y, debajo, el nombre en el idioma seleccionado.
  - Nota: «Puedes cambiarlo después en Ajustes».
  - CTA fija: **Continuar**.
- **Comportamiento:** al tocar una opción, toda la pantalla cambia de idioma al instante: título, nota, CTA y nombres de los idiomas. Es la primera muestra del cambio en vivo.
- **Accesibilidad:** `role="radiogroup"` en el grupo; cada tarjeta con `role="radio"` y `aria-checked`; `lang` en cada nombre nativo.

### S00b · Onboarding (primera vez)

- **Entradas:** plataforma (iOS/Android), si la PWA está instalada.
- **Salidas:** consentimiento de estadísticas (sí/no) → `settings.analyticsConsent`; terminar → `/`.
- **Layout:** 3 diapositivas a pantalla completa, con el patrón de marca de fondo y la tipografía `display`:
  1. "Elige una ruta"
  2. "Camina: te avisamos al llegar"
  3. "Cada lugar cobra vida"
- **Hoja de consentimiento (RGPD):** "Ayúdanos a mejorar con estadísticas anónimas. Nunca guardamos tu ubicación." [Aceptar] [No, gracias].
- **iOS sin instalar:** tarjeta "Instala Rumbo para recibir avisos al llegar", con los pasos ilustrados (Compartir → "Añadir a pantalla de inicio").
- **Estados:** con o sin el paso de iOS.

### S01 · Inicio, Explorar (`/`)

- **Entradas:** `RouteSummary[]` (nombre, resumen, modo, actividad, portada, nº de puntos, distancia, minutos estimados); para la vista Mapa, los puntos de todas las rutas curadas y de las creadas en este dispositivo (nombre, categoría, ruta, posición, imagen). Las tuyas llevan la etiqueta «Creada por ti».
- **Salidas:** abrir ruta → `/routes/:routeId`; filtrar (Libre/Reto/A pie/Bici); alternar Lista/Mapa; tocar un marcador → popup → "Ver ruta".
- **Layout:**
  - Cabecera con wordmark, chip de ciudad ("Leiria ▾") y búsqueda.
  - **SegmentedControl Lista | Mapa.**
  - Chips de filtro: Todas · Libre · Reto · A pie · Bici.
  - **Lista:** RouteCards apiladas.
  - **Mapa:** mapa a pantalla completa con **más de 20 marcadores** (color por ruta + icono de categoría), botón Filtro que abre el FilterPanel (por ruta, categoría y modo, con leyenda) y popup al tocar.
- **Estados:** carga (skeletons), sin conexión (rutas guardadas + banner), vacío ("Aún no hay rutas en esta zona" + "Crea la tuya") y error.
- Si hay un recorrido activo: **MiniRunBar** encima de la navegación.

### S02 · Mis rutas (`/my-routes`)

- **Entradas:** las rutas creadas por el usuario, que viven en el dispositivo (resumen + estado de subida). El **último recorrido de cada una** queda aplazado: no entra en la fase 6.
- **Salidas:** abrir → detalle; Iniciar; **Nueva ruta** (→ creador); **Editar** (→ creador, con la ruta cargada), un botón a la vista en cada tarjeta; Eliminar (diálogo destructivo, en el menú ⋯).
- **Layout:**
  - Cabecera con «Nueva ruta».
  - Lista de RouteCards, la más nueva primero, con la etiqueta "Creada por ti", su línea de estado, un botón secundario **Editar** (con lápiz; `aria-label` «Editar: {nombre}») y un menú ⋯ (Editar, Eliminar), los dos fuera del enlace de la tarjeta. Una tarjeta cuya subida falló lleva en su lugar el botón de estado (Reintentar o Editar), así que nunca tiene dos botones. Una ruta ilegible solo ofrece Eliminar.
- **Estado de subida** (una línea bajo la tarjeta):
  - ya subida: sin línea de estado;
  - pendiente: «Solo en este dispositivo · se subirá al conectar»;
  - con error: el motivo según el código («El servidor rechazó la ruta. Edítala y guárdala de nuevo.», «Has llegado al máximo de rutas en el servidor.» o «No se pudo subir») y [Reintentar] o, si el servidor rechazó la ruta, [Editar].
- **Editar:** si hay otro borrador con contenido, pide confirmar que se descarta («Tienes un borrador sin guardar»). Si la ruta es el recorrido en curso, avisa de que se actualizará con los cambios y conservará lo que ya visitaste (S05).
- **Eliminar:** diálogo destructivo («Se borrará de este dispositivo y del servidor. No se puede deshacer.»). Si la ruta es el recorrido en curso, avisa de que lo termina. Borra también la copia descargada y el último resumen de esa ruta, y confirma con el aviso «Ruta eliminada».
- **Estados:**
  - vacío ("Crea tu primera ruta" + ilustración + botón Crear);
  - carga, con esqueleto: la lista sale del dispositivo, así que no espera a la API;
  - sin conexión: la misma lista, con las pendientes marcadas;
  - ruta ilegible («No podemos abrir esta ruta») con [Eliminar].

### S03 · Detalle de ruta (`/routes/:routeId`)

- **Entradas:** `RouteBundle` (spec: nombre, modo, actividad, puntos con orden, categoría y posición, `path`, `timeLimit`; contents: miniaturas), resumen (distancia, duración) y estado de la descarga offline.
- **Salidas:** **Iniciar ruta** → `/routes/:routeId/prepare`; tocar un punto → el mapa se centra y abre su popup; mapa a pantalla completa; "Probar en simulación" (solo en modo demo); **Editar ruta** y **Eliminar ruta** (solo en las rutas propias).
- **Layout:**
  - Mapa arriba (≈45 % de la altura) con los puntos numerados y el trazado.
  - Debajo, una hoja con:
    - Título `h1`.
    - ModeBadge + ActivityBadge.
    - Fila de StatChips: distancia, duración, nº de puntos y, en reto, límite de tiempo.
    - **Solo en rutas propias:** una fila con dos botones de borde, **Editar ruta** (lápiz) y **Eliminar ruta** (papelera, texto rojo). Se apilan a 320 px y se desactivan mientras corre una acción. Van a la vista y no en un menú ⋯ porque en la prueba con un iPhone no se encontraba, y no en el pie fijo, para que la barra de «Iniciar ruta» siga siendo fina.
    - Descripción expandible.
    - **Caja de reglas en modo Reto:** "Orden obligatorio · Límite 1 h 30 · Pasa por los 9 checkpoints".
    - **Lista ordenada de puntos** (PointListItem con la distancia desde el anterior).
  - **CTA fija abajo:** "Iniciar ruta". Debajo, en pequeño: "✓ Disponible sin conexión", o el progreso de la descarga.
- **Editar ruta:** como en Mis rutas (S02): si hay otro borrador con contenido, pide confirmar que se descarta, y abre el creador (C1). La flecha atrás del creador vuelve al detalle.
- **Eliminar ruta:** diálogo destructivo con el nombre de la ruta, como en S02. Si la ruta es el recorrido en curso, lo termina. Confirma con «Ruta eliminada» y vuelve a Mis rutas (con atrás en el historial si venía de ahí; si no, lo reemplaza), sin pasar por «No encontramos esta ruta.».
- **Estados:** carga, error, ruta sin portada y ruta curada o desconocida (sin los dos botones).

### S04 · Preparación y permisos (`/routes/:routeId/prepare`)

- **Entradas:** estado de los permisos (ubicación, notificaciones), si la PWA está instalada (iOS), progreso de la descarga y soporte de vibración y wake lock.
- **Salidas:** pedir cada permiso; "Probar sonido" (desbloquea el audio); interruptor "Mantener pantalla encendida"; **Empezar** → crea el recorrido → `/run`.
- **Layout:** título "Antes de empezar" y una lista de PermissionRows:
  1. **Ubicación** (obligatorio): "Para saber cuándo llegas a cada lugar."
  2. **Avisos** (recomendado): "Te avisamos aunque tengas la app minimizada." En iOS sin instalar, se sustituye por la tarjeta de instalación.
  3. **Sonido:** botón "Probar sonido".
  4. **Pantalla encendida** (toggle, activado por defecto): "La ubicación solo funciona con la pantalla encendida."
  5. **Contenido descargado** (progreso → ✓).
  - CTA **Empezar**, desactivada hasta tener ubicación y la descarga completa.
- **Estados:** ubicación denegada (pasos para activarla en el navegador, según la plataforma, y "Reintentar"), descarga fallida (reintentar).

### S05 · Recorrido en curso (`/run`), la pantalla central

- **Entradas** (flujo `EngineState`):
  - `status`, `gps`.
  - `user` (posición, precisión, rumbo).
  - `target` (`pointId`, `order`, `distance`, `bearing`, `etaSeconds`, `inZone`, `dwellProgress`). El nombre del objetivo se resuelve por `pointId`, en el idioma activo.
  - `progress` (`completed`, `total`, `percent`, `score`).
  - `points[]` (estado, distancia, `completedAt`).
  - `flags` (`offRoute`, `idle`, `overtime`).
  - `elapsedMs`, `track`.
  - Además, del spec: categorías, nombres y `path`.
- **Salidas:**
  - **Pausar** → `engine.pause()`.
  - Elegir objetivo (Libre) → `setTarget(pointId)`.
  - Recentrar (solo UI).
  - **"Estoy aquí"** → `manualCheckIn(pointId)` (solo Libre, si el GPS está débil y el punto está cerca).
  - Tocar un marcador → popup (con **Ver ficha** si el punto está visitado y tiene ficha, §6.3).
  - Abrir la lista de puntos, que ofrece:
    - **Editar ruta**, junto al título, solo en las rutas propias y nunca en una prueba: abre el creador en Lugares sin terminar el recorrido, que sigue activo debajo. Si hay otro borrador, pide confirmar que se descarta, y no sale «¿Salir del mapa?». Al guardar, el recorrido toma los cambios: lo visitado se mantiene, los lugares nuevos empiezan pendientes, el tiempo y la pausa siguen igual y sale el aviso «Ruta actualizada: lo que ya visitaste se mantiene». Si los cambios no dejan nada que visitar, el recorrido termina y va al resumen (S10);
    - **Ver ficha**, en cada punto visitado que tenga una ficha o una hoja con algo que mostrar (`aria-label` «Ver la ficha de {nombre}»): la abre en vista previa, sin puntuar ni cambiar nada. Una pregunta, un video, un enlace o un aviso no se reabren.
  - En modo demo: controles de simulación.
- **Layout:**
  - Mapa a pantalla completa, siguiendo al usuario.
  - **HudTarget** flotante arriba (márgenes de 16 px).
  - GpsIndicator bajo el HUD.
  - Botones flotantes a la derecha (Recentrar, Filtro y, en demo, Simulación).
  - **BottomSheet:**
    - *Peek*: ProgressBar + "2 de 8 · 1:05:23 · 150 pts" + botón **⏸ Pausar** (56 px).
    - Medio: lista de puntos con estados, con **Editar ruta** y **Ver ficha** (ver arriba).
    - Completo: detalles de la ruta.
  - Botón "Estoy aquí" (Libre), que solo aparece cuando aplica.
- **Microinteracciones:**
  - **Aproximación** (≤ 100 m): el HUD pulsa en Terracota y aparece el toast "Estás cerca de Castelo de Leiria".
  - **En la zona:** el HUD muestra el anillo de progreso y "Confirmando llegada…" (unos 5 s), y el marcador objetivo muestra el mismo anillo.
- **Estados:** buscando señal (`waiting`), GPS débil (banner ámbar: "Señal GPS débil. Sal a un espacio abierto."), sin señal, modo simulación (banner morado y usuario morado), sin conexión (el mapa base puede quedar en fondo neutro con los puntos y la traza visibles).

### S06 · Llegada: ficha del lugar (hoja sobre `/run`)

Se abre con el evento `enter` y el handler `ai_template` o `info_sheet`.

- **Entradas:** `PointContent`:
  - `title`, `subtitle`, `summary`.
  - `facts[]`.
  - `images[]` (con `credit` y `license`).
  - `video`, `tip`.
  - `quiz` (la trivia, opcional).
  - `sources[]`.
  - `generated.by`.
  - Además: orden del punto, total de puntos y puntuación.
- **Salidas:** **Continuar ruta** → completa el punto; menú ⋯ → **Pausar** / **Terminar recorrido**; reproducir el video; abrir las fuentes; responder la pregunta rápida (la respuesta sale con Continuar, Pausar o Terminar, y una correcta suma 10 puntos).
- **Al salir de la zona:** si el usuario se aleja del lugar (su radio más 10 m de margen) sin cerrar la hoja de llegada, la hoja se cierra sola y el punto cuenta como visitado, igual que con **Continuar ruta**. Sin aviso ni sonido. Lo que esté a medias (una trivia respondida, pero sin Continuar ruta) no suma puntos. Solo se cierra la hoja de llegada de ese lugar: una interrupción u otra hoja no. Si se cierra antes de tiempo, se puede volver a ver desde la lista de puntos (S05).
- **Momento de llegada:**
  - Ondas que salen del marcador (700 ms) y vibración + sonido.
  - La hoja sube al 85 %.
  - Con movimiento reducido: un fundido simple.
- **Layout de la hoja:**
  - Imagen héroe con ImageCredit.
  - Etiqueta "📍 LLEGASTE · PUNTO 3 DE 12".
  - Título `h1` (Fraunces) y subtítulo.
  - Resumen.
  - Sección **"Datos curiosos"** (viñetas).
  - VideoCard.
  - Tarjeta **"Consejo"**.
  - Sección **«Pregunta rápida»** (solo si la ficha trae `quiz`), entre el consejo y las fuentes:
    - la pregunta y de 2 a 4 opciones grandes (≥ 48 px; el texto largo salta de línea);
    - un solo intento: al responder, todas las opciones se bloquean;
    - la correcta lleva ✓ y la elegida, si falla, ✕, además del texto «¡Correcto! +10 pts» o «No es esa. La correcta: {respuesta}», y debajo la explicación, si la hay. Nunca solo color;
    - el veredicto se anuncia en una región `aria-live`, y la hoja se desplaza para que se vea.
  - Fuentes (enlaces pequeños).
  - **AiBadge** si `generated.by === 'ai'`.
  - Pie fijo: **Continuar ruta** (primario) + ⋯.
- **Variantes** (mismo marco de hoja):
  - **S06b Quiz:** pregunta, opciones grandes, feedback de correcto o incorrecto con explicación y puntos.
  - **S06c Video:** reproductor que se puede ampliar a pantalla completa.
  - **S06d Web externa:** "Vas a abrir una web externa: visitleiria.pt" [Abrir] [Ahora no].
  - **S06e Checkpoint de reto sin contenido:** CheckpointToast (no bloquea). También es el aviso «Llegaste a {nombre}» de «Solo un aviso».
  - **S06f Experiencia 3D/RA** *(futuro)*: pantalla completa con un botón de cerrar. En v1 solo se diseña el placeholder "Próximamente".
  - **Vista previa (desde C3 y desde la lista de puntos de S05):** el mismo marco sin la etiqueta «LLEGASTE» y con un solo botón **Cerrar**, que cierra sin resultado. La pregunta rápida funciona, pero no puntúa ni se registra.
  - **Lo que elige el creador en «Al llegar» (C2):** «Tu propia pregunta» usa S06b (10 puntos por acertar), «Un video de YouTube» usa S06c, «Un enlace web» usa S06d (con el texto del enlace y su dominio) y «Solo un aviso» usa S06e: un aviso y la ruta sigue, sin hoja.
- **Estados:** carga de la imagen (skeleton), sin imagen (patrón de marca), video no disponible, ficha mínima (solo nombre + texto) y ficha breve de la IA (sin datos, consejo ni pregunta: «no hemos encontrado información fiable»).
- **Límite conocido:** si se cierra la hoja con el gesto de deslizar o con Escape después de responder, la respuesta no se puntúa.

### S07 · Interrupciones (DecisionSheet sobre `/run`)

Las interrupciones comparten estructura: icono grande, título, texto con el dato concreto y acciones apiladas: **principal** · **Pausar** · **Terminar recorrido** (texto rojo).

| Evento | Título | Texto (entrada: `event.data`) | Acción principal |
|---|---|---|---|
| `deviation` | "Te alejaste de la ruta" | "Estás a 220 m del camino hacia Castelo de Leiria." (`distanceToRoute`) | **Volver a la ruta** (recentra) |
| `idle` | "¿Sigues ahí?" | "Llevas 10 min en el mismo sitio." (`idleSeconds`) | **Continuar** |
| `out_of_order` | "Este no es el siguiente punto" | "Primero tienes que pasar por el Checkpoint 2." (`expectedPointId`) | **Ir al Checkpoint 2** |
| `timeout` | "Se acabó el tiempo" | "Puedes seguir sin cronómetro oficial." (`timeLimit`) | **Seguir sin tiempo** |

- **Salidas:** `continue` → sigue (o reanuda); `pause` → `engine.pause()`; terminar → diálogo S09.

**Avisos que no son hoja:**

- **GPS débil:** banner ámbar con "Estoy aquí" (modo Libre).
- **Permiso de ubicación revocado:** hoja de error con los pasos para reactivarlo; el recorrido queda en pausa.
- **De vuelta en la ruta** (`back_on_track`): toast "¡De vuelta en la ruta!".

### S08 · Pausa (estado de `/run`)

- **Entradas:** `status: 'paused'`, `elapsedMs` congelado, progreso.
- **Salidas:** **Reanudar** → `engine.resume()`; **Terminar** → S09.
- **Layout:** mapa atenuado al 40 % y desaturado. Tarjeta central: "En pausa · 1:05:23 · 5 de 12" [Reanudar] [Terminar recorrido]. El HUD queda atenuado.

### S09 · Confirmar terminar (diálogo)

- "¿Terminar el recorrido?" · "Guardaremos lo que llevas hecho." [Terminar] (danger) [Seguir].
- **Salida:** `engine.cancel()` → S10 en variante "no completada".

### S10 · Resumen (`/run/summary`)

- **Entradas:** resumen (`elapsedMs`, `distanceMeters`, completados/total, `score`, velocidad media), `track`, puntos con `completedAt`, estado final (`finished` o `cancelled`).
- **Salidas:** **Ver otras rutas** → `/`; **Repetir** → `/routes/:routeId/prepare`; Compartir *(futuro)*.
- **Layout:**
  - Cabecera con el patrón de marca.
  - **Completada:** "¡Ruta completada!" en `display`, con una animación breve.
  - **Terminada antes:** "Recorrido terminado" (tono neutro).
  - Mapa con la traza y los puntos (completados en verde).
  - Cuadrícula de 4 stats: tiempo, distancia, puntos visitados X/Y y puntuación (en reto) o velocidad media.
  - Lista de puntos con su hora de llegada.

### S11 · Recuperar recorrido (hoja al abrir la app)

- **Entradas:** snapshot guardado (nombre de la ruta, progreso, tiempo).
- **Salidas:** **Continuar** → `/run` en pausa, listo para reanudar; **Descartar**.
- **Copy:** "Tienes un recorrido a medias · Leiria histórica · 3 de 12 · 0:42:10".
- **Variante "ruta cambiada":** "Esta ruta se actualizó. Empieza de nuevo para ver los cambios."

### C1 · Crear: Datos (`/create/details`)

- **Entradas:** borrador guardado (si existe) o la ruta que se edita.
- **Salidas:** `name`, zona/ciudad, `mode`, `activity`, `timeLimit` (reto) e `interests[]` (opcional) → Siguiente. El `locale` de la ruta es el idioma de la app (al editar, el de la ruta).
- **Layout:**
  - Stepper (1/4).
  - Campo "Nombre de la ruta": obligatorio, hasta 80 caracteres, con contador.
  - Búsqueda de ciudad o zona («Centra el mapa y busca lugares cerca»). La zona elegida queda como un chip que se puede quitar. Solo orienta el mapa y la búsqueda: no se guarda en la ruta.
  - Botón **«Usar mi ubicación»**, bajo la búsqueda: lee la posición una sola vez, al pulsar («Buscando tu ubicación…»), la redondea a 3 decimales (unos 110 m) y la pone como zona («Tu ubicación»). No se ve si el navegador no tiene geolocalización o si ya hay una zona.
  - **Dos tarjetas grandes de modo:** **Libre** ("Visita a tu ritmo, en el orden que quieras") / **Reto** ("Orden obligatorio, checkpoints y cronómetro").
  - SegmentedControl A pie · Correr · Bici.
  - Límite de tiempo, solo en Reto: chips «Sin límite» y los límites de 30, 60, 90, 120 y 180 minutos.
  - **Intereses** (opcional): chips que se activan y se desactivan, de varios en varios: Historia, Arte, Arquitectura, Gastronomía, Naturaleza, Religión, Curiosidades. Ayuda: «Opcional. La IA adapta las sugerencias y las fichas a lo que te interesa.»
  - Una línea informa «Las fichas se generarán en {idioma}.», que es el de la app (al editar, el de la ruta). No hay selector de idioma.
  - Pie fijo con **Siguiente**.
- **Estados:**
  - validación en línea: el error del nombre aparece al salir del campo o al pulsar Siguiente;
  - ubicación denegada («No podemos ver tu ubicación. Activa el permiso en el navegador o busca una ciudad.») o que falla («No pudimos obtener tu ubicación. Inténtalo de nuevo o busca una ciudad.»).

### C2 · Crear: Lugares (`/create/places`)

- **Entradas:** sugerencias de búsqueda (nombre, descripción, categoría, posición, distancia), lugares del borrador y resumen calculado (distancia total, duración estimada).
- **Salidas:**
  - **Añadir un lugar**, de tres maneras:
    - desde la búsqueda (se resuelve su dirección antes de añadirlo);
    - con una **pulsación larga** en el mapa;
    - con el botón **«Añadir el centro del mapa»**, que añade el punto bajo una mira situada en el centro del mapa. Es la alternativa para quien no puede mantener pulsado, por ejemplo con lector de pantalla.
  - Un punto personalizado se llama «Punto personalizado {n}» (categoría «otro») y se abre en el editor, con un marcador provisional en el mapa que se quita si se cancela.
  - **«Sugerir lugares»** (IA), un botón bajo la búsqueda: abre la hoja de sugerencias (más abajo) y añade los lugares elegidos, en el orden sugerido.
  - **Reordenar:** arrastrando el asa, o con **Subir** y **Bajar** en el menú ⋯ de cada lugar. Se anuncia «{nombre}: posición 2 de 5» y el foco vuelve al lugar movido.
  - **Editar un lugar** en una hoja no modal: nombre, tipo (solo en puntos personalizados; el de Wikidata ya viene puesto), radio (slider de 20 a 200 m, de 5 en 5, con el círculo cambiando en el mapa mientras se mueve), obligatoriedad y **«Al llegar»** (más abajo). Pie con [Cancelar] y [Guardar] o [Añadir], más [Eliminar] en un lugar que ya está en la lista. Al abrirla, el mapa se centra en el lugar, por encima de la hoja.
  - **«Al llegar»** (fase 7.1): un apartado de la hoja del lugar para elegir lo que verá quien llegue, con un botón de radio por opción (icono, nombre y ayuda). Los campos de la elegida salen debajo:
    - **Ficha del lugar** (por defecto): «La ficha con IA si está lista; si no, el nombre y la dirección.»
    - **Nombre y dirección:** «Una hoja sencilla, sin IA.»
    - **Tu propia pregunta:** «Una pregunta con respuestas y puntos, escrita por ti.» Campos: la pregunta, de 2 a 4 respuestas («De 2 a 4. Toca el círculo de la correcta.»; Añadir respuesta y Quitar la respuesta n) y una explicación opcional («Se muestra después de responder.»). «Una respuesta correcta suma 10 puntos.»
    - **Un video de YouTube:** «Se reproduce en la hoja de llegada.» Campos: un enlace o un ID de YouTube («Pega el enlace del video o su ID de 11 caracteres.»; al reconocerlo, «Video encontrado: {id}») y un título opcional.
    - **Un enlace web:** «Se abre en el navegador, siempre tras confirmar.» Campos: la dirección (empieza por `https://`) y el texto del enlace.
    - **Solo un aviso:** «Un breve «Llegaste a…» y la ruta sigue, sin ficha.»
    - Los errores salen al pulsar [Guardar] (o al salir del campo del enlace o del video), con el foco en el primer campo mal. Una elección incompleta no se guarda. Lo escrito bajo otra opción se conserva mientras la hoja sigue abierta.
  - **Eliminar:** sin confirmación, pero con el aviso «{nombre} eliminado» y [Deshacer], que lo devuelve a su posición.
  - Siguiente (mínimo 2 lugares, máximo 30).
- **Layout móvil** (la pantalla no se desplaza entera):
  - Mapa fijo arriba (≈ 38 % de la altura, mínimo 220 px) con los marcadores numerados en el orden de la lista, la línea del recorrido y la zona de cada lugar. Mientras se escribe en la búsqueda, el mapa se encoge (≈ 140 px). La mira y el botón «Añadir el centro del mapa» solo aparecen con el mapa listo.
  - Debajo, una sola columna con scroll: **PlaceSearch** primero (sus resultados se abren hacia arriba, sobre el mapa), la barra de resumen y la lista arrastrable, con el pie fijo «Siguiente» dentro de la columna.
  - Barra de resumen: "6 lugares · 3,1 km · ~1 h 50" (sin la duración cuando no hay lugares).
  - Chip de aviso ⚠ "2 zonas se solapan", que cuenta los lugares afectados, resalta las zonas y abre el primero. Avisa, no bloquea. La ayuda: «Reduce su radio (mínimo 20 m) o elimina uno de los dos».
- **Escritorio** (≥ 1024 px): vista dividida, con una columna de 420 px a la izquierda (búsqueda, resumen y lista) y el mapa a la derecha, a toda la altura.
- **Búsqueda:** da prioridad a lo que está cerca del centro del mapa; si el mapa no está listo, de la zona de C1, y si no hay zona, del centro de los lugares ya añadidos. Al elegir un resultado se añade, el mapa se centra en él, se anuncia en una región `aria-live` (no con un aviso, que taparía la flecha atrás), se vacía el campo y el foco se queda en él.
- **Hoja «Sugerir lugares»** (SuggestSheet, sobre C2):
  - **Entradas:** la posición (el centro del mapa, o la zona, o el centro de los lugares ya añadidos, tal como están al abrir la hoja), los intereses del borrador y los lugares que la ruta ya tiene (no se vuelven a sugerir).
  - **Pedir:** chips de tiempo (30 min · 1 h · 2 h · 3 h · 4 h; 2 h por defecto) y los intereses (los de C1: lo que cambies se guarda en el borrador). «Dinos cuánto tiempo tienes y qué te interesa. La IA propone lugares reales de la zona que estás viendo.» → **Sugerir**.
  - **Esperar:** «Buscando ideas…» y «Puede tardar unos segundos» (suele tardar de 6 a 9 s; la web espera 60 s como máximo).
  - **Resultado:**
    - una «Idea de ruta» (título y resumen sugeridos) con **«Usar el título sugerido»**, que rellena el nombre y el resumen de la ruta una sola vez («Título aplicado»);
    - la lista «Lugares sugeridos»: casilla (todos marcados, hasta los que caben en la ruta), nombre, anécdota (por qué ir, nunca qué vas a aprender) y distancia.
  - **Salidas:** **«Añadir N lugares»** los añade en el orden sugerido y salta los repetidos («{n} lugares añadidos»); **«Cambiar»** vuelve a elegir tiempo e intereses. Atrás cierra la hoja antes de salir del paso, y cerrarla cancela la petición.
  - **Estados:** sin resultados («No encontramos lugares que sugerir por aquí. Prueba con más tiempo u otra zona.»), ruta casi llena («La ruta solo admite {n} lugares más.») y los errores de la IA con los textos de `errors.ai.*` (sin conexión, no disponible, límite de hoy y fallo).
- **Estados:**
  - búsqueda sin resultados («No encontramos "x" cerca. Prueba con otro nombre o mantén pulsado el mapa.») y error de búsqueda;
  - sin conexión: la búsqueda no funciona, y el aviso remite al mapa («mantén pulsado el mapa para añadir lugares») solo si el mapa está disponible;
  - lista vacía ("Busca un lugar o mantén pulsado el mapa");
  - mapa no disponible: caja atenuada «El mapa no está disponible ahora.» con [Reintentar]. La búsqueda y la lista siguen funcionando;
  - 30 lugares: la búsqueda y el añadir quedan desactivados.
  - «Sugerir lugares» desactivado mientras no haya mapa, zona ni lugares: «Elige una ciudad o zona en el primer paso, o espera a que cargue el mapa, para recibir sugerencias.»
- **Límite conocido:** un lugar ya añadido no se puede mover. Para cambiar su posición hay que eliminarlo y volver a añadirlo.

### C3 · Crear: Fichas (`/create/content`)

La app prepara con la IA una ficha de cada lugar y **no la enseña**: lo bueno de un lugar es descubrirlo al llegar (sin spoilers). Esta pantalla solo cuenta cómo va cada ficha.

- **Entradas:** los lugares del borrador y, de cada uno, el estado de su ficha: en espera · preparándose · lista (con su número de fuentes) · breve (la IA no encontró información fiable) · básica (nombre y dirección) · error. El texto y las imágenes de la ficha **no se muestran** en ningún estado.
- **Salidas:**
  - **Siguiente**, siempre activo: un lugar sin ficha lista usa la ficha básica.
  - Por lugar: **Ver ficha**, **Regenerar**, **Usar ficha básica**, **Reintentar** y **Generar con IA**.
- **Layout:**
  - Stepper (3/4).
  - Texto explicativo: «Preparamos una ficha de cada lugar con información de Wikipedia o de la web. No la verás aquí: la descubrirás al llegar, y se guarda para que funcione sin conexión.» y una nota: «Las fichas las escribe una IA a partir de fuentes reales, que aparecen en cada ficha.»
  - Progreso: «Preparando fichas 2 de 5» con una barra. Al terminar, «5 de 5 fichas listas», y una región `aria-live` educada anuncia «Fichas preparadas: 5 de 5 con IA.»
  - Lista «Fichas de los lugares», con una fila por lugar (CardStatusRow): su nombre y su estado en texto: «En espera» · «Preparando la ficha…» · «**Ficha lista · 3 fuentes**» · «Ficha breve: no encontramos información fiable» · «Ficha básica: nombre y dirección» · el error.
  - Los lugares que no usan la ficha en «Al llegar» salen en la lista con lo que mostrarán: «Tu pregunta: «…»», «Video de YouTube» (o «Video de YouTube: «título»»), «Enlace: {texto} · {dominio}», «Solo un aviso al llegar» o «Nombre y dirección, sin IA». Solo los lugares con ficha cuentan en el progreso. Una nota lo explica («Los lugares con otra opción en «Al llegar» no llevan ficha con IA.»), y si ninguno usa la ficha: «Ningún lugar usa ficha con IA, así que no hay nada que preparar.»
  - Menú ⋯ de cada fila: **Regenerar** y **Usar ficha básica**. En una ficha básica, **Generar con IA**. En un error, **Reintentar** y **Usar ficha básica**.
  - Pie fijo con **Siguiente** y la pista «Los lugares sin ficha lista usarán la ficha básica.»
- **«Ver ficha» y los spoilers:** antes de abrirla sale un diálogo: «¿Ver la ficha? Te adelantará lo que descubrirás al llegar.» [Mejor no] [Ver ficha]. Si se confirma, se abre la hoja de llegada (S06) en vista previa, con un solo botón **Cerrar**.
- **Regenerar:** pide una ficha nueva y cuenta como una generación del día. Mientras llega, la fila dice «Actualizando la ficha…» y la anterior sigue valiendo; si falla, se queda la anterior («No pudimos regenerar la ficha. Conservamos la anterior.»).
- **Estados:**
  - sin conexión: «Se preparará cuando tengas conexión.», y se reintenta sola al volver;
  - error de una ficha: «No pudimos preparar esta ficha.» [Reintentar] [Usar ficha básica];
  - IA no disponible: «La IA no está disponible ahora. Puedes usar fichas básicas y seguir.»;
  - límite de uso del día: «Hoy hemos llegado al límite de uso de la IA. Usa fichas básicas o vuelve mañana.»;
  - límite del dispositivo: «Has alcanzado el límite de hoy: usa fichas básicas o vuelve mañana.»;
  - en estos tres últimos, un banner ofrece **«Usar fichas básicas»**, que lo aplica a todos los lugares sin ficha lista («{n} lugares con ficha básica»).
- **Aplazado:** el editor de la ficha (título, resumen, datos, carrusel de imágenes con licencia y URL de video). Por ahora una ficha se acepta, se regenera o se cambia por la básica.

### C4 · Crear: Revisar y simular (`/create/review`)

- **Entradas:** spec construido (modo, puntos, distancia y duración), resultado de la validación (errores y avisos).
- **Salidas:** **Probar ruta** → `/run` en **modo simulación**; editar → volver al paso; **Guardar ruta**.
- **Layout:**
  - Stepper (4/4).
  - Mapa con la ruta completa (con la misma caja de «mapa no disponible» que C2 si no carga).
  - Nombre de la ruta (`h1`), ModeBadge, ActivityBadge y StatChips.
  - Checklist «Comprobaciones»:
    - ✓ «{n} lugares, en el orden que quieras» (en Reto, «{n} checkpoints, en el orden de la lista»);
    - ✓ «Las zonas no se solapan» o ⚠ «{n} zonas se solapan», con [Corregir], que vuelve a Lugares;
    - ✓ «Cada lugar muestra su ficha con nombre y dirección» o ⓘ «{n} lugares sin dirección: sus fichas mostrarán solo el nombre» (solo cuenta los lugares que mostrarán la ficha básica);
    - una línea de fichas: «{n} fichas con IA · {m} básicas» o, si no hay ninguna con IA, «Sin fichas con IA: cada lugar mostrará su nombre y dirección.»;
    - si algún lugar muestra otra cosa que la ficha, «Al llegar: 1 pregunta propia · 1 aviso» (con las cuentas de nombre y dirección, preguntas propias, videos, enlaces y avisos);
    - ⚠ mientras haya fichas en preparación: «{n} fichas aún en preparación: si guardas ahora, usarán la ficha básica.», con [Ver fichas], que vuelve a Fichas;
    - en Reto, ⚠ si el límite de tiempo es menor que la duración estimada;
    - una línea de error bloqueante («La ruta tiene errores: revisa los pasos anteriores») si la ruta no se puede construir o sus acciones no son válidas.
  - Botones: **Probar ruta** (secundario, tono de simulación) con la ayuda «La recorres en simulación; no se guarda nada», y **Guardar ruta** (primario; «Guardando…» mientras se escribe en el dispositivo).
- **Probar ruta:**
  - Siempre en simulación, aunque Ajustes la tenga desactivada, y con la ruta tal como está en el borrador (con sus fichas), sin guardarla.
  - Si hay un recorrido real en curso, pide confirmar («Tienes un recorrido en curso · Lo pausamos para probar esta ruta y podrás continuarlo después» · [Pausar y probar]). Al terminar la prueba, ese recorrido vuelve a ofrecerse.
  - En `/run`, el banner morado de simulación lleva el chip **«Prueba»** y el botón **«Volver al editor»**, y el panel SimControls empieza desplegado. Una prueba no deja resumen, no cuenta en las estadísticas ni aparece en la MiniRunBar.
  - Al terminar, al pulsar «Volver al editor» o al salir de la pantalla, se vuelve a Revisar con un aviso: «Prueba completada: 3 de 4 lugares» o «Prueba terminada».
- **Guardar ruta:** guarda en el dispositivo (funciona sin conexión) y pasa a C5. Si no puede guardarla en el dispositivo, se queda en C4 con «No pudimos guardar la ruta en este dispositivo.».

### C5 · Crear: Lista (`/create/done`)

- "Tu ruta está lista" + RouteCard. Queda fuera del Stepper, y la flecha atrás lleva a Mis rutas.
- Una línea de estado, que cambia sola cuando termina la subida: «Guardada. Puedes recorrerla cuando quieras.» o, si aún no se ha subido, «Guardada en este dispositivo. La subiremos cuando vuelva la conexión.»
- [Iniciar ahora] → `/routes/:routeId/prepare` · [Ver mis rutas] · Compartir enlace *(futuro)*.
- **Si la ruta guardada es la del recorrido en curso** (se editó desde S05), el recorrido ya usa los cambios: sale la línea «Tu recorrido en curso ya usa estos cambios. Lo que visitaste se mantiene.» y el botón principal es **Volver al recorrido** (→ `/run`) en lugar de [Iniciar ahora]. Si guardar dejó el recorrido sin nada que visitar, este termina y la pantalla pasa directa al resumen (S10).

### S12 · Ajustes (`/settings`)

- **Secciones:**
  - **Avisos:** sonido, vibración (oculto si no hay soporte), notificaciones (estado + botón) y **Notificaciones push**: un interruptor con una línea de ayuda según el estado. Son recordatorios y novedades de Rumbo, incluso con la app cerrada. Nunca avisan de llegadas: el servidor no sabe dónde estás, y en la web el seguimiento fiable exige la pantalla encendida. Estados:
    - desactivadas: «Recordatorios y novedades de Rumbo, incluso con la app cerrada.»;
    - activadas: «Activadas en este dispositivo.»;
    - en iPhone o iPad sin instalar: «En iPhone y iPad, primero añade Rumbo a la pantalla de inicio: toca Compartir y después «Añadir a pantalla de inicio».» (iOS 16.4 o más; el interruptor no se puede usar hasta entonces);
    - bloqueadas: «Bloqueadas. Actívalas en los ajustes del navegador o del dispositivo.» (con la app instalada en un iPhone, están en los Ajustes de iOS). Al volver de allí, la fila lee el estado otra vez;
    - no disponibles (el servidor las tiene apagadas): «No disponibles ahora mismo.»;
    - sin soporte en el navegador: «Este navegador no admite notificaciones push.»
  - **Pantalla:** tema (Sistema/Claro/Oscuro) y **alto contraste "Sol"**.
  - **General:** idioma y unidades (km/mi). El idioma usa las mismas tarjetas que S00 y el cambio se aplica al instante, sin recargar. Las fichas ya generadas por IA se quedan en su idioma.
  - **Privacidad:** estadísticas anónimas (toggle) y "Borrar mis datos locales". El diálogo cuenta cuántas rutas creadas se borrarán también del servidor (las ya subidas, que la app intenta eliminar antes) y cuántas se perderán por no haberse subido. También cancela la suscripción push de este dispositivo.
  - **Demo:** **Modo simulación**.
  - **Acerca de:** versión y créditos (Esri/ArcGIS, Wikipedia/Wikimedia, fuentes).

### Modo simulación (overlay en `/run` y C4)

- Banner superior morado: "Modo simulación: tu ubicación es simulada".
- Punto de usuario morado con la etiqueta "SIM".
- Panel SimControls plegable.
- En «Probar ruta» (C4), el banner añade el chip «Prueba» y el botón «Volver al editor», y el panel empieza desplegado.
- Nunca debe poder confundirse con el GPS real.

---

## 10. Datos de ejemplo para los mockups

Los textos son de muestra: sirven para maquetar y no hay que tomarlos como contenido verificado.

**Ruta 1:** "Leiria histórica" · **Libre** · A pie · 12 puntos · 3,4 km · ~2 h.
Puntos: Castelo de Leiria, Sé de Leiria, Igreja de São Pedro, Praça Rodrigues Lobo, Museu de Leiria, m|i|mo – Museu da Imagem em Movimento, Santuário de N.ª Sr.ª da Encarnação, Moinho do Papel, Jardim Luís de Camões, Mercado de Sant'Ana, Teatro José Lúcio da Silva, Igreja da Misericórdia.

**Ruta 2:** "Reto Ribeira do Lis" · **Reto** · Correr · 9 checkpoints + Meta · 6,2 km · Límite 1 h 30.

**Estado de ejemplo del recorrido (S05):**

```json
{
  "status": "running", "gps": "good",
  "target": { "pointId": "castelo", "order": 3, "distance": 340, "bearing": 72, "etaSeconds": 262, "inZone": false, "dwellProgress": 0 },
  "progress": { "completed": 2, "total": 12, "percent": 17, "score": 150 },
  "elapsedMs": 3923000,
  "flags": { "offRoute": false, "idle": false, "overtime": false }
}
```

**Ficha de ejemplo (S06):** título "Castelo de Leiria" · subtítulo "Fortaleza medieval sobre la ciudad" · resumen de 3 frases · 4 datos curiosos · imagen con crédito "Foto: Autor / CC BY-SA 4.0" · consejo "Sube a la torre al atardecer" · fuentes "Wikipedia".

---

## 11. Microcopy (claves i18n · español)

Los catálogos `apps/web/src/i18n/{es,en,pt}.json` son la fuente de verdad; esta tabla es la referencia en español. Las últimas filas recogen textos que aparecen en los mockups.

Las claves que entrega el sistema de eventos (`run.*`, `decision.*`, `end.confirm.*`, `notify.*`, `redirect.*`) están en `UI_TEXT_KEYS` de `@rumbo/event-system`, y los tres catálogos deben tenerlas todas. Sus parámetros: `name` es el nombre del punto (un `LocalizedText` que la UI resuelve en el idioma activo), `distance` va en metros y `minutes` es un número; la UI los formatea según el idioma.

Los textos de la fase 7 (`create.details.*`, `create.interests.*`, `create.suggest.*`, `create.content.*`, `create.review.cards*`, `errors.ai.*` y `arrival.trivia.*`) ya están en los tres catálogos; la tabla recoge los principales. Lo mismo con los de la fase 7.1 (`create.arrival.*`, `create.done.*`, `route.edit`, `route.delete`, `run.editRoute`, `run.viewCard` y `settings.push.*`).

| Clave | Texto |
|---|---|
| `home.tabs.explore` | Explorar |
| `home.view.list` / `home.view.map` | Lista / Mapa |
| `mode.free` / `mode.challenge` | Libre / Reto |
| `activity.walk` / `.run` / `.bike` | A pie / Correr / Bici |
| `route.start` | Iniciar ruta |
| `route.offlineReady` | Disponible sin conexión |
| `route.rules.challenge` | Orden obligatorio · Límite {time} · Pasa por los {n} checkpoints |
| `prepare.title` | Antes de empezar |
| `prepare.location` | Para saber cuándo llegas a cada lugar. |
| `prepare.notifications` | Te avisamos aunque tengas la app minimizada. |
| `prepare.wakeLock` | La ubicación solo funciona con la pantalla encendida. |
| `prepare.go` | Empezar |
| `run.hud.next` | SIGUIENTE · {n}/{total} |
| `run.hud.nearest` | MÁS CERCANO |
| `run.approaching` | Estás cerca de {name} |
| `run.confirming` | Confirmando llegada… |
| `run.manualCheckIn` | Estoy aquí |
| `run.gps.waiting` | Buscando señal… |
| `run.gps.weak` | Señal GPS débil. Sal a un espacio abierto. |
| `run.gps.lost` | Sin señal GPS |
| `run.pause` | Pausar |
| `arrival.label` | LLEGASTE · PUNTO {n} DE {total} |
| `arrival.continue` | Continuar ruta |
| `arrival.facts` | Datos curiosos |
| `arrival.tip` | Consejo |
| `arrival.aiBadge` | Generado con IA · Fuentes: {sources} |
| `arrival.trivia.title` | Pregunta rápida |
| `arrival.trivia.correct` / `.wrong` | ¡Correcto! +{points} pts / No es esa. La correcta: {answer} |
| `decision.deviation.title` | Te alejaste de la ruta |
| `decision.deviation.body` | Estás a {distance} del camino hacia {name}. |
| `decision.deviation.primary` | Volver a la ruta |
| `decision.idle.title` | ¿Sigues ahí? |
| `decision.idle.body` | Llevas {minutes} min en el mismo sitio. |
| `decision.idle.primary` | Continuar |
| `decision.outOfOrder.title` | Este no es el siguiente punto |
| `decision.outOfOrder.body` | Primero tienes que pasar por {name}. |
| `decision.outOfOrder.primary` | Ir a {name} |
| `decision.timeout.title` | Se acabó el tiempo |
| `decision.timeout.body` | Puedes seguir sin cronómetro oficial. |
| `decision.timeout.primary` | Seguir sin tiempo |
| `decision.continue` | Continuar |
| `decision.pause` / `decision.end` | Pausar / Terminar recorrido |
| `run.backOnTrack` | ¡De vuelta en la ruta! |
| `pause.title` | En pausa |
| `pause.resume` | Reanudar |
| `end.confirm.title` | ¿Terminar el recorrido? |
| `end.confirm.body` | Guardaremos lo que llevas hecho. |
| `end.confirm.yes` / `end.confirm.no` | Terminar / Seguir |
| `summary.finished` | ¡Ruta completada! |
| `summary.cancelled` | Recorrido terminado |
| `recover.body` | Tienes un recorrido a medias |
| `notify.arrive` | 📍 Llegaste a {name} |
| `notify.tapToOpen` | Toca para ver |
| `notify.outOfOrder` | Este no es el siguiente punto |
| `notify.deviation` | Te alejaste de la ruta |
| `notify.idle` | ¿Sigues en la ruta? |
| `notify.timeout` | Se acabó el tiempo |
| `notify.finish` | 🏁 ¡Ruta completada! |
| `notify.generic` | Novedades en tu ruta |
| `redirect.title` | Vas a abrir una web externa |
| `redirect.body` | {label} · {host} |
| `redirect.open` / `redirect.later` | Abrir / Ahora no |
| `create.steps.details` / `.places` / `.content` / `.review` | Datos / Lugares / Fichas / Revisar |
| `create.mode.free` | Visita a tu ritmo, en el orden que quieras |
| `create.mode.challenge` | Orden obligatorio, checkpoints y cronómetro |
| `create.places.empty` | Busca un lugar o mantén pulsado el mapa |
| `create.places.overlap` | {n} zonas se solapan |
| `create.places.overlapRow` | Su zona se solapa con otra |
| `create.places.overlapHint` | Reduce su radio (mínimo 20 m) o elimina uno de los dos. |
| `create.places.addCenter` | Añadir el centro del mapa |
| `create.places.removed` / `create.places.undo` | {name} eliminado / Deshacer |
| `create.details.interests` / `.interestsHint` | Intereses / Opcional. La IA adapta las sugerencias y las fichas a lo que te interesa. |
| `create.interests.history` / `.art` / `.architecture` / `.food` / `.nature` / `.religion` / `.curiosities` | Historia / Arte / Arquitectura / Gastronomía / Naturaleza / Religión / Curiosidades |
| `create.details.cardsLanguage` | Las fichas se generarán en {language}. |
| `create.details.myLocation` / `.locationName` | Usar mi ubicación / Tu ubicación |
| `create.details.locationDenied` | No podemos ver tu ubicación. Activa el permiso en el navegador o busca una ciudad. |
| `create.suggest.open` | Sugerir lugares |
| `create.suggest.intro` | Dinos cuánto tiempo tienes y qué te interesa. La IA propone lugares reales de la zona que estás viendo. |
| `create.suggest.time` / `.interests` / `.submit` | ¿Cuánto tiempo tienes? / ¿Qué te interesa? / Sugerir |
| `create.suggest.searching` / `.searchingHint` | Buscando ideas… / Puede tardar unos segundos. |
| `create.suggest.useTitle` | Usar el título sugerido |
| `create.suggest.add` | Añadir {n} lugar \| Añadir {n} lugares |
| `create.suggest.empty` | No encontramos lugares que sugerir por aquí. Prueba con más tiempo u otra zona. |
| `create.content.intro` | Preparamos una ficha de cada lugar con información de Wikipedia o de la web. No la verás aquí: la descubrirás al llegar, y se guarda para que funcione sin conexión. |
| `create.content.progress` | Preparando fichas {n} de {total} |
| `create.content.waiting` / `.generating` | En espera / Preparando la ficha… |
| `create.content.ready` / `.sources` | Ficha lista · {sources} / {n} fuente \| {n} fuentes |
| `create.content.thin` | Ficha breve: no encontramos información fiable |
| `create.content.basic` | Ficha básica: nombre y dirección |
| `create.content.offline` | Se preparará cuando tengas conexión. |
| `create.content.failed` | No pudimos preparar esta ficha. |
| `create.content.blocked.unavailable` | La IA no está disponible ahora. Puedes usar fichas básicas y seguir. |
| `create.content.blocked.budget` | Hoy hemos llegado al límite de uso de la IA. Usa fichas básicas o vuelve mañana. |
| `create.content.blocked.deviceLimit` | Has alcanzado el límite de hoy: usa fichas básicas o vuelve mañana. |
| `create.content.view` / `.regenerate` / `.useBasic` / `.generate` | Ver ficha / Regenerar / Usar ficha básica / Generar con IA |
| `create.content.useBasicAll` | Usar fichas básicas |
| `create.content.spoilerTitle` / `.spoilerBody` | ¿Ver la ficha? / Te adelantará lo que descubrirás al llegar. |
| `create.content.spoilerConfirm` / `.spoilerCancel` | Ver ficha / Mejor no |
| `create.content.refreshing` / `.refreshFailed` | Actualizando la ficha… / No pudimos regenerar la ficha. Conservamos la anterior. |
| `create.review.cardsAi` / `.cardsBasic` | {n} ficha con IA \| {n} fichas con IA / {n} básica \| {n} básicas |
| `create.review.cardsNone` | Sin fichas con IA: cada lugar mostrará su nombre y dirección. |
| `create.review.cardsPreparing` / `.fixCards` | {n} ficha aún en preparación: si guardas ahora, usará la ficha básica. \| {n} fichas aún en preparación: si guardas ahora, usarán la ficha básica. / Ver fichas |
| `errors.ai.offline` | Sin conexión: no podemos usar la IA ahora. |
| `errors.ai.unavailable` | La IA no está disponible ahora. |
| `errors.ai.budgetExceeded` | Hoy hemos llegado al límite de uso de la IA. Vuelve mañana. |
| `errors.ai.deviceLimit` | Has alcanzado tu límite de hoy. Vuelve mañana. |
| `errors.ai.failed` | No pudimos obtener respuesta ahora. Inténtalo de nuevo. |
| `create.review.test` | Probar ruta |
| `create.review.save` | Guardar ruta |
| `create.review.testHint` | La recorres en simulación; no se guarda nada. |
| `create.review.noAddress` | {n} lugar sin dirección: su ficha mostrará solo el nombre \| {n} lugares sin dirección: sus fichas mostrarán solo el nombre |
| `create.trial.back` | Volver al editor |
| `create.trial.finished` | Prueba completada: {done} de {total} lugares |
| `create.done.title` | Tu ruta está lista |
| `create.done.synced` / `create.done.local` | Guardada. Puedes recorrerla cuando quieras. / Guardada en este dispositivo. La subiremos cuando vuelva la conexión. |
| `create.done.backToRun` / `create.done.runUpdated` | Volver al recorrido / Tu recorrido en curso ya usa estos cambios. Lo que visitaste se mantiene. |
| `route.edit` / `route.delete` | Editar ruta / Eliminar ruta |
| `run.editRoute` / `run.viewCard` | Editar ruta / Ver ficha |
| `run.routeUpdated` | Ruta actualizada: lo que ya visitaste se mantiene |
| `run.arrivedAt` | Llegaste a {name} |
| `myRoutes.activeRunEdit` | Tienes un recorrido en curso de esta ruta: se actualizará con tus cambios y conservará lo que ya visitaste. |
| `create.arrival.title` | Al llegar |
| `create.arrival.types.card` / `.basic` / `.quiz` / `.video` / `.link` / `.check` | Ficha del lugar / Nombre y dirección / Tu propia pregunta / Un video de YouTube / Un enlace web / Solo un aviso |
| `create.review.arrivalMix` | Al llegar: {mix} |
| `settings.push.label` | Notificaciones push |
| `settings.push.off` / `.on` | Recordatorios y novedades de Rumbo, incluso con la app cerrada. / Activadas en este dispositivo. |
| `settings.push.needsInstall` | En iPhone y iPad, primero añade Rumbo a la pantalla de inicio: toca Compartir y después «Añadir a pantalla de inicio». |
| `settings.push.denied` / `.unavailable` / `.unsupported` | Bloqueadas. Actívalas en los ajustes del navegador o del dispositivo. / No disponibles ahora mismo. / Este navegador no admite notificaciones push. |
| `myRoutes.sync.pending` | Solo en este dispositivo · se subirá al conectar |
| `sim.banner` | Modo simulación: tu ubicación es simulada |
| `consent.body` | Ayúdanos a mejorar con estadísticas anónimas. Nunca guardamos tu ubicación. |
| `ios.install` | Instala Rumbo para recibir avisos al llegar |
| `lang.title` | Elige tu idioma |
| `lang.hint` | Puedes cambiarlo después en Ajustes. |
| `lang.continue` | Continuar |
| `explore.offline` | Sin conexión. Te mostramos tus rutas descargadas. |
| `explore.empty.title` / `.body` | Aún no hay rutas en esta zona / Elige los lugares que quieres ver y preparamos la guía por ti. |
| `popup.distance` | a {distance} de ti |
| `route.downloaded` | Descargada |
| `prepare.ready` | Todo listo. Guarda el móvil y camina. |
| `prepare.needLocation` | Necesitas permitir la ubicación |
| `prepare.downloading` | Terminando la descarga… |
| `pause.body` | El cronómetro está detenido. No te avisaremos al llegar. |
| `quiz.correct` / `quiz.wrong` | ¡Correcto! / Casi. Era {answer}. |
| `content.fallbackLanguage` | Contenido disponible en {language} |

---

## 12. Accesibilidad

- **WCAG 2.2 AA:** texto con contraste ≥ 4,5:1, y ≥ 3:1 para texto grande y componentes. Los tokens de 5.1 ya cumplen.
- **Zonas táctiles:** ≥ 48 px, y ≥ 56 px en los controles del recorrido (Pausar, Continuar ruta y las acciones de decisión).
- **Estados de los puntos con forma o icono**, nunca solo con color.
- **Alternativa al mapa:** la lista de puntos (en S03 y en la hoja de S05) contiene la misma información para lectores de pantalla.
- **Región `aria-live`:**
  - Anuncia "Llegaste a {name}", las interrupciones y los cambios de distancia **cada 50 m**, nunca en cada actualización.
  - El orden de foco de las hojas empieza en el título, y el foco vuelve al cerrar.
- **Creador:**
  - al cambiar de paso, el foco va al título de la pantalla (un solo `h1` por paso), se actualiza el título del documento y una región `aria-live` anuncia «Paso 2 de 4 · Lugares»;
  - añadir un lugar y reordenar tienen alternativa sin gestos: «Añadir el centro del mapa» y «Subir» y «Bajar» en el menú del lugar;
  - la búsqueda es un combobox (WAI-ARIA 1.2) y los menús ⋯ se recorren con las flechas;
  - el aviso de solapamiento lleva icono y texto, nunca solo color;
  - los chips de intereses son botones con `aria-pressed` y un icono de visto cuando están activos;
  - el estado de cada ficha va siempre en texto, una región `aria-live` educada anuncia cuántas se han preparado y «Ver ficha» pide confirmación en un diálogo.
- **Pregunta rápida (S06):** botones nativos de al menos 48 px, agrupados y etiquetados por la pregunta. El veredicto va en una región `role="status"` que siempre está en el DOM, y lleva ✓ o ✕ y texto además del color. Tras responder el foco no se pierde: el siguiente Tab llega al primer enlace de debajo.
- **Tamaño de texto:** la UI soporta hasta el 200 % sin romperse. El HUD se reorganiza en dos líneas.
- **Movimiento reducido y hápticos** desactivables.
- **Videos** con subtítulos (los de YouTube).
- **Idioma:** `<html lang>` refleja siempre el idioma activo. Los textos en otro idioma, como los nombres nativos de S00, llevan su propio `lang`.

---

## 13. Responsive

- **Móvil (principal):** 390×844. Comprobar también en 360×780.
- **Tablet** (834×1194):
  - Inicio en cuadrícula de 2 columnas.
  - Detalle en vista dividida (mapa | información).
- **Escritorio** (1440×900):
  - Explorar: mapa a la izquierda (60 %) y lista a la derecha.
  - Creador: vista dividida (columna de 420 px con la lista | mapa a toda la altura, desde 1024 px), con el Stepper arriba.
  - Recorrido: panel de ancho móvil centrado sobre el mapa. En escritorio se usa sobre todo para demostraciones en simulación.
- **Textos más largos:** cada pantalla se revisa en los tres idiomas a 360 px. El español y el portugués ocupan en torno a un 30 % más que el inglés.
  - En el mockup, la etiqueta del HUD («MÁS CERCANO · 3/12») ya salta de línea a 390 px, y en portugués («MAIS PRÓXIMO») será peor.
  - Solución: la etiqueta va en una sola línea con elipsis y el contador, aparte.

---

## 14. Fuera de alcance de esta propuesta

- Logotipo final y manual de marca completo (solo exploración).
- Web de marketing.
- Panel B2B para negocios.
- Cuentas de usuario e inicio de sesión.
- Escenas 3D/RA (solo el placeholder de S06f).
