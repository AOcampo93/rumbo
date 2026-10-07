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

**Estado (2026-10-07).** Entregado:
- los fundamentos (paletas clara, oscura y «Sol», y la tipografía);
- el set de marcadores;
- el wordmark;
- las pantallas del flujo de recorrer rutas, con sus estados: S00 Idioma, S01, S03, S04 y S05–S10;
- el modo oscuro de S05–S08 y S10;
- el prototipo de los flujos A y B.

Falta, y se diseñará con este mismo sistema al construir cada pantalla:
- el onboarding y el consentimiento;
- S02 Mis rutas, S11 Recuperar recorrido y S12 Ajustes;
- el creador (C1–C5) y su flujo C;
- las variantes S06c, S06d y S06f;
- el panel de filtros completo;
- tablet y escritorio;
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
| `--color-warning` | `#8A5A00` sobre `#FFF1CC` | GPS débil, avisos |
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
  - Acciones: **Ver ficha** o **Ir a este punto** (solo en modo Libre).
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
| **PointListItem** | Burbuja de orden (color del estado), miniatura de 48 px, nombre, categoría · distancia. Estados: bloqueado (atenuado + candado), activo, **siguiente** (barra Terracota a la izquierda), completado (check + hora). Variante **arrastrable** (asa) para el creador |
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
| **Toast/Snackbar** | Info, éxito y aviso. Con acción opcional |
| **Banner** | Sin conexión · Modo simulación (morado) · Instala la app (iOS) · GPS débil |
| **PermissionRow** | Icono, título, descripción y estado (pendiente/concedido/denegado) + botón |
| **Stepper** | 4 pasos con nombre (paso actual, completado y pendiente) |
| **Inputs** | TextField, Select, SegmentedControl, Chip (filtro e interés, seleccionable), Toggle, Slider (radio con valor en metros) |
| **PlaceSearch** | Campo con sugerencias (icono de categoría, nombre, dirección). Estados: escribiendo, cargando, sin resultados, error |
| **EmptyState** | Ilustración/patrón, título, texto y llamada a la acción |
| **MiniRunBar** | Barra persistente sobre la navegación inferior cuando hay un recorrido activo y el usuario está en otra pantalla: "● Leiria histórica · Castelo 340 m" + botón para volver |
| **Dialog** | Confirmación destructiva |
| **FilterPanel / MapLegend** | Chips por ruta, categoría, modo y estado. Leyenda de colores e iconos |
| **SimControls** | Panel flotante morado: "Toca el mapa para moverte", "Caminar al siguiente punto", velocidad 1× / 5× / 20×, interruptor "GPS débil" |
| **AiBadge** | "✦ Generado con IA · Fuentes: Wikipedia" (pequeño, discreto) |
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
                           ├─► Crear: 1 Datos ► 2 Lugares ► 3 Contenido IA ► 4 Revisar y simular ► 5 Lista
                           └─► Ajustes (aquí se cambia el idioma después)
```

Idioma y Onboarding solo aparecen en el primer arranque.

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
| `/create/details` · `/create/places` · `/create/content` · `/create/review` · `/create/done` | C1-C5 Creador | No (flecha atrás + Stepper) |
| `/settings` | S12 Ajustes | **Sí** |

- **Navegación inferior** (4 elementos): **Explorar** (brújula) · **Mis rutas** (marcador) · **Crear** (+, destacado) · **Ajustes** (engranaje).
- **Las hojas no son pantallas:** llegada, decisión y pausa se apilan sobre `/run`. El gesto atrás cierra la hoja superior.
- **Salir de `/run`:** con el gesto atrás aparece "¿Salir del mapa? La ruta sigue activa." Al salir, se muestra la **MiniRunBar** en el resto de pantallas.
- **Desde una notificación:** abre `/run` con la ficha del punto ya desplegada.

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

- **Entradas:** `RouteSummary[]` (nombre, resumen, modo, actividad, portada, nº de puntos, distancia, minutos estimados); para la vista Mapa, los puntos de todas las rutas curadas (nombre, categoría, ruta, posición, imagen).
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

- **Entradas:** rutas creadas por el usuario (resumen + estado local/sincronizada), último recorrido de cada una.
- **Salidas:** abrir → detalle; Iniciar; Editar (→ creador); Eliminar (diálogo destructivo).
- **Layout:** lista de RouteCards con etiqueta "Creada por ti" y menú ⋯.
- **Estados:** vacío ("Crea tu primera ruta" + ilustración + botón Crear), carga y sin conexión.

### S03 · Detalle de ruta (`/routes/:routeId`)

- **Entradas:** `RouteBundle` (spec: nombre, modo, actividad, puntos con orden, categoría y posición, `path`, `timeLimit`; contents: miniaturas), resumen (distancia, duración) y estado de la descarga offline.
- **Salidas:** **Iniciar ruta** → `/routes/:routeId/prepare`; tocar un punto → el mapa se centra y abre su popup; mapa a pantalla completa; "Probar en simulación" (solo en modo demo).
- **Layout:**
  - Mapa arriba (≈45 % de la altura) con los puntos numerados y el trazado.
  - Debajo, una hoja con:
    - Título `h1`.
    - ModeBadge + ActivityBadge.
    - Fila de StatChips: distancia, duración, nº de puntos y, en reto, límite de tiempo.
    - Descripción expandible.
    - **Caja de reglas en modo Reto:** "Orden obligatorio · Límite 1 h 30 · Pasa por los 9 checkpoints".
    - **Lista ordenada de puntos** (PointListItem con la distancia desde el anterior).
  - **CTA fija abajo:** "Iniciar ruta". Debajo, en pequeño: "✓ Disponible sin conexión", o el progreso de la descarga.
- **Estados:** carga, error, ruta sin portada.

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
  - Tocar un marcador → popup.
  - Abrir la lista de puntos.
  - En modo demo: controles de simulación.
- **Layout:**
  - Mapa a pantalla completa, siguiendo al usuario.
  - **HudTarget** flotante arriba (márgenes de 16 px).
  - GpsIndicator bajo el HUD.
  - Botones flotantes a la derecha (Recentrar, Filtro y, en demo, Simulación).
  - **BottomSheet:**
    - *Peek*: ProgressBar + "2 de 8 · 1:05:23 · 150 pts" + botón **⏸ Pausar** (56 px).
    - Medio: lista de puntos con estados.
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
  - `sources[]`.
  - `generated.by`.
  - Además: orden del punto, total de puntos y puntuación.
- **Salidas:** **Continuar ruta** → completa el punto; menú ⋯ → **Pausar** / **Terminar recorrido**; reproducir el video; abrir las fuentes.
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
  - Fuentes (enlaces pequeños).
  - **AiBadge** si `generated.by === 'ai'`.
  - Pie fijo: **Continuar ruta** (primario) + ⋯.
- **Variantes** (mismo marco de hoja):
  - **S06b Quiz:** pregunta, opciones grandes, feedback de correcto o incorrecto con explicación y puntos.
  - **S06c Video:** reproductor que se puede ampliar a pantalla completa.
  - **S06d Web externa:** "Vas a abrir una web externa: visitleiria.pt" [Abrir] [Ahora no].
  - **S06e Checkpoint de reto sin contenido:** CheckpointToast (no bloquea).
  - **S06f Experiencia 3D/RA** *(futuro)*: pantalla completa con un botón de cerrar. En v1 solo se diseña el placeholder "Próximamente".
- **Estados:** carga de la imagen (skeleton), sin imagen (patrón de marca), video no disponible, ficha mínima (solo nombre + texto).

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

- **Entradas:** borrador guardado (si existe).
- **Salidas:** `name`, zona/ciudad, `mode`, `activity`, `interests[]` y `timeLimit` (reto) → Siguiente. El `locale` de la ruta es el idioma de la app.
- **Layout:**
  - Stepper (1/4).
  - Campo "Nombre de la ruta".
  - Búsqueda de ciudad o zona.
  - **Dos tarjetas grandes de modo:** **Libre** ("Visita a tu ritmo, en el orden que quieras") / **Reto** ("Orden obligatorio, checkpoints y cronómetro").
  - SegmentedControl A pie · Correr · Bici.
  - Sin selector de idioma: una línea informa «Las fichas se generarán en {idioma}», que es el de la app.
  - Chips de intereses: Historia, Arte, Arquitectura, Gastronomía, Naturaleza, Religión, Curiosidades (la IA los usa).
  - Límite de tiempo, solo en Reto.
- **Estados:** validación en línea (nombre obligatorio).

### C2 · Crear: Lugares (`/create/places`)

- **Entradas:** sugerencias de búsqueda (nombre, dirección, categoría, posición), lugares del borrador y resumen calculado (distancia total, duración estimada).
- **Salidas:**
  - Añadir lugar (desde la búsqueda o con pulsación larga en el mapa: "Punto personalizado" + nombre).
  - **Reordenar arrastrando.**
  - Editar radio (slider de 20 a 200 m con el círculo visible en el mapa) y obligatoriedad.
  - Eliminar.
  - Siguiente (mínimo 2 lugares).
- **Layout móvil:**
  - Mapa arriba (50 %) con los marcadores numerados y una línea en el orden actual.
  - **PlaceSearch** fijo.
  - Lista arrastrable abajo, con asa, número, nombre, dirección, icono, chip de radio y menú.
  - Barra de resumen: "6 lugares · 3,1 km · ~1 h 50".
  - Chip de aviso ⚠ "2 zonas se solapan", que resalta las afectadas.
- **Escritorio:** vista dividida, con la lista a la izquierda y el mapa a la derecha.
- **Estados:** búsqueda sin resultados, error de búsqueda y lista vacía ("Busca un lugar o mantén pulsado el mapa").

### C3 · Crear: Contenido IA (`/create/content`)

- **Entradas:** `PointContent` en borrador por lugar y estado de generación (`pending` · `generating` · `ready` · `error`).
- **Salidas:**
  - **Generar todo** o por lugar.
  - Abrir el editor de un lugar: título, resumen, datos curiosos (añadir/quitar), elegir imagen en el carrusel de candidatas con licencia, URL de video y consejo.
  - Regenerar.
  - Aprobar.
  - **"Usar ficha básica sin IA".**
  - Siguiente.
- **Layout:**
  - Stepper (3/4).
  - Texto explicativo: "Preparamos una ficha de cada lugar con información de Wikipedia. Revísala antes de guardar."
  - Lista de tarjetas: miniatura, título, primeras líneas del resumen y chip de estado. Mientras se genera: shimmer.
  - El **editor** es una hoja a pantalla completa con vista previa en vivo de la ficha (S06).
  - AiBadge visible.
- **Estados:** generando, error ("No pudimos preparar esta ficha" [Reintentar] [Usar básica]), límite diario alcanzado ("Has alcanzado el límite de hoy: usa fichas básicas o vuelve mañana").

### C4 · Crear: Revisar y simular (`/create/review`)

- **Entradas:** spec construido (modo, puntos, distancia y duración), resultado de la validación (errores y avisos).
- **Salidas:** **Probar ruta** → `/run` en **modo simulación**; editar → volver al paso; **Guardar ruta**.
- **Layout:**
  - Mapa con la ruta completa.
  - Resumen (ModeBadge, stats).
  - Checklist: ✓ "Todos los lugares tienen ficha" · ⚠ "2 zonas se solapan" (con enlace para arreglarlo).
  - Botones: Probar ruta (secundario) y **Guardar ruta** (primario).

### C5 · Crear: Lista (`/create/done`)

- "Tu ruta está lista" + RouteCard.
- [Iniciar ahora] → `/routes/:routeId/prepare` · [Ver mis rutas] · Compartir enlace *(futuro)*.

### S12 · Ajustes (`/settings`)

- **Secciones:**
  - **Avisos:** sonido, vibración (oculto si no hay soporte), notificaciones (estado + botón).
  - **Pantalla:** tema (Sistema/Claro/Oscuro) y **alto contraste "Sol"**.
  - **General:** idioma y unidades (km/mi). El idioma usa las mismas tarjetas que S00 y el cambio se aplica al instante, sin recargar. Las fichas ya generadas por IA se quedan en su idioma.
  - **Privacidad:** estadísticas anónimas (toggle) y "Borrar mis datos locales".
  - **Demo:** **Modo simulación**.
  - **Acerca de:** versión y créditos (Esri/ArcGIS, Wikipedia/Wikimedia, fuentes).

### Modo simulación (overlay en `/run` y C4)

- Banner superior morado: "Modo simulación: tu ubicación es simulada".
- Punto de usuario morado con la etiqueta "SIM".
- Panel SimControls plegable.
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
| `create.mode.free` | Visita a tu ritmo, en el orden que quieras |
| `create.mode.challenge` | Orden obligatorio, checkpoints y cronómetro |
| `create.places.empty` | Busca un lugar o mantén pulsado el mapa |
| `create.places.overlap` | {n} zonas se solapan |
| `create.content.intro` | Preparamos una ficha de cada lugar con información de Wikipedia. Revísala antes de guardar. |
| `create.content.basic` | Usar ficha básica sin IA |
| `create.review.test` | Probar ruta |
| `create.review.save` | Guardar ruta |
| `create.done.title` | Tu ruta está lista |
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
| `create.details.aiLanguage` | Las fichas se generarán en {language} |

---

## 12. Accesibilidad

- **WCAG 2.2 AA:** texto con contraste ≥ 4,5:1, y ≥ 3:1 para texto grande y componentes. Los tokens de 5.1 ya cumplen.
- **Zonas táctiles:** ≥ 48 px, y ≥ 56 px en los controles del recorrido (Pausar, Continuar ruta y las acciones de decisión).
- **Estados de los puntos con forma o icono**, nunca solo con color.
- **Alternativa al mapa:** la lista de puntos (en S03 y en la hoja de S05) contiene la misma información para lectores de pantalla.
- **Región `aria-live`:**
  - Anuncia "Llegaste a {name}", las interrupciones y los cambios de distancia **cada 50 m**, nunca en cada actualización.
  - El orden de foco de las hojas empieza en el título, y el foco vuelve al cerrar.
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
  - Creador: vista dividida (lista | mapa), con el Stepper arriba.
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
