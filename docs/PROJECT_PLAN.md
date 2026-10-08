# Rumbo: motor de rutas con check-in por geolocalización

> **Nombre provisional:** Rumbo. **Estado:** fases 0 a 7 completadas (base, contratos, motor, sistema de eventos, la web para recorrer rutas, el backend mínimo, el creador de rutas y la guía con IA). Producción activa en https://rumbo.arturoocampo.com con todo lo anterior: la guía con IA (fase 7) desde el 2026-10-08, verificada con la IA real ([DEPLOY.md](DEPLOY.md)).
> **Idiomas:** español, inglés y portugués de Portugal ([ADR 0001](adr/0001-multilenguaje.md)).
> **Stack:** Vue 3 + Vite + TypeScript (PWA headless) · Node + Fastify + TypeScript + PostgreSQL (API en VPS propio) · ArcGIS Maps SDK for JavaScript.

---

## 0. Cómo usar este documento

1. **Lee el documento completo antes de escribir código.** Los contratos de las secciones 6 a 9 son la fuente de verdad.
2. **Primeros pasos en el repo:**
   - Guarda este documento como `docs/PROJECT_PLAN.md`.
   - Guarda la propuesta gráfica (`design.md`) como `docs/DESIGN.md`.
   - El `README.md` de la raíz **no es este documento**: debe seguir la plantilla del curso (sección 2.3), en inglés.
3. **Construye por fases** (sección 16). No pases de fase sin que los tests estén en verde y se cumpla su *Definition of Done*.
4. **Los contratos no se cambian sin actualizar la documentación.** Un cambio incompatible en `RouteSpec` sube `specVersion` e incluye una migración.
5. **Idiomas:** código, identificadores, comentarios y commits en **inglés**. La app es trilingüe (español, inglés y portugués de Portugal) según el [ADR 0001](adr/0001-multilenguaje.md). La documentación interna va en español.
6. Si una API externa (ArcGIS, Wikimedia, proveedor de IA) no se comporta como se describe aquí, **verifica la documentación oficial vigente** y documenta la diferencia en `docs/adr/`.

---

## 1. Visión

**Rumbo** es una PWA de rutas guiadas: la ruta **cobra vida al llegar a cada lugar**. El usuario elige o crea una ruta, camina (o corre, o pedalea) y, cuando entra en la zona de un punto, la app lo detecta por geolocalización y dispara una experiencia: una ficha con contenido, un video, un quiz, una web externa y, en el futuro, escenas 3D o RA.

Dos formas de uso, un solo motor:

| | Rutas precargadas (curated) | Rutas creadas por el usuario (planificador) |
|---|---|---|
| Quién la crea | Nosotros (JSON curado) | El usuario, con un formulario guiado |
| Contenido al llegar | Interacciones a medida: quiz, video, redirect, 3D/RA (futuro) | Plantilla generativa: ficha creada con IA a partir de fuentes reales (Wikipedia/Wikimedia o, si no hay artículo, la web), con una pregunta rápida |
| Modos | Libre o reto | Libre o reto |
| Valor | Experiencias diseñadas (turismo, museos, eventos, deporte) | **Planificador de viaje** cuya ruta funciona como guía en el sitio |

**Modos:**

- **Libre (`free`):** los puntos se visitan en cualquier orden. Es la ruta turística o de museo.
- **Reto (`challenge`):** orden obligatorio, checkpoints, desvíos, cronómetro y meta. Pensado para hiking, ciclismo y running.

**Diferencial de producto:** planificar ya lo hacen otras apps. Lo nuestro es que **cada punto se activa en el momento y el lugar exactos**.

---

## 2. Contexto académico: CSE 310, módulo GIS Mapping (BYU-Idaho)

El primer entregable de este proyecto es el módulo **GIS Mapping** de CSE 310 (sprint de 2 semanas). Después, el proyecto sigue como producto.

### 2.1 Requisitos del módulo (obligatorios)

- [x] Web o app móvil que genera un mapa con **ArcGIS** (obligatorio usar ArcGIS).
- [x] **Al menos 20 marcadores** con información útil en el mapa: 37 en Explorar.
- [x] Al hacer clic en un marcador se muestra un **popup** con su información.
- [ ] `README.md` raíz con la **plantilla GIS Mapping** del curso.
- [ ] **Un stretch challenge** como mínimo (cubrimos dos):
  - [x] Más de un tipo de dato en el mapa, con **gráficos de marcador distintos** (categorías y estados).
  - [x] **Filtro** en el mapa para mostrar solo algunos marcadores.
  - [ ] *(Extra)* Datos obtenidos automáticamente de un servidor público (nuestra API + contenido de Wikipedia).

### 2.2 Requisitos comunes del curso

- [ ] Software de creación propia (no copiado de un tutorial), con **más de 100 líneas** (sin contar el setup) y **comentarios útiles**.
- [ ] **Video de 4-5 minutos** en YouTube (público o no listado): demo y recorrido por el código. Enlace en el README.
- [ ] **Repositorio público en GitHub**, con nombre descriptivo (sugerido: `rumbo`). Nada de "Module1".
- [ ] No se acepta código de proyectos de otros cursos.

### 2.3 Plantilla del README raíz (en inglés)

Secciones: `# Overview`, `# Development Environment`, `# Useful Websites`, `# Future Work`.

- La plantilla pide **no decir en Overview que es una tarea universitaria**: hay que hablar del objetivo como ingeniero de software.
- Incluir: descripción del software y de su uso, fuente de los datos, propósito, enlace al video, herramientas, lenguaje y librerías, webs útiles y trabajo futuro.

### 2.4 Guion sugerido para el video (4-5 min)

1. **0:00** Problema y propuesta (rutas que cobran vida al llegar).
2. **0:30** Mapa *Explorar*: más de 20 marcadores, popups, iconos por categoría y filtro.
3. **1:15** Iniciar una ruta en **modo simulación**: aproximación, llegada y ficha de contenido.
4. **2:00** Desvío: decisión Continuar/Pausar/Cancelar. Reto: punto fuera de orden.
5. **2:45** Código: `route-spec` (contrato), `geo-engine` (algoritmo de check-in), `event-system` (registro de handlers) y la capa de ArcGIS.
6. **4:15** Tests del motor y cierre (trabajo futuro).

---

## 3. Principios de arquitectura

1. **Tres módulos núcleo, desacoplados por contratos:**
   - **Creador** → produce un `RouteSpec` válido.
   - **Motor de geolocalización** → consume `RouteSpec` + posiciones y emite **estado** y **eventos**.
   - **Sistema de eventos** → consume eventos y ejecuta **acciones** (handlers).
   - La UI y el mapa solo **escuchan** el estado y los eventos.
2. **El motor es TypeScript puro:** sin DOM, sin Vue, sin ArcGIS y sin red. Es determinista: el reloj, el planificador y la fuente de posición se inyectan, así que se prueba con trayectos simulados o grabados.
3. **El motor corre en el cliente.** No hay latencia de red por cada lectura de GPS y funciona sin cobertura.
4. **Las acciones no dependen del motor.** El motor solo dice *"evento X, trigger `id`"*. Qué pasa después lo decide un registro de handlers ampliable (patrón plugin, con carga diferida).
5. **Contratos versionados y validados** con Zod en cada frontera (cliente, servidor y CI).
6. **Frontend headless:** una PWA estática que solo habla con la API REST versionada.
7. **El backend en el VPS es el único con secretos:** claves de IA y geocodificación, persistencia, generación de contenido, métricas privadas y, en el futuro, cuentas.
8. **Offline durante un recorrido:** al iniciar se descargan la ruta y su contenido. El motor y las acciones funcionan sin red; el mapa base puede no cargar sin conexión.
9. **Privacidad por diseño (RGPD):** no se envían trazas GPS al servidor por defecto, y las métricas son anónimas y con consentimiento.

---

## 4. Arquitectura general

```
┌──────────────────────────────── Cliente (PWA headless · Vue 3) ────────────────────────────────┐
│                                                                                                 │
│  ┌──────────────┐  RouteSpec   ┌────────────────────┐  eventos + estado  ┌───────────────────┐  │
│  │ 1. CREADOR   │ ───────────► │ 2. MOTOR GEOLOC.   │ ─────────────────► │ 3. SISTEMA DE     │  │
│  │ route-builder│              │ geo-engine         │                    │ EVENTOS           │  │
│  │ + wizard UI  │              │ (TS puro)          │ ◄───────────────── │ event-system      │  │
│  └──────────────┘              └────────────────────┘  complete/pause/   │ + handlers (Vue)  │  │
│         │                          ▲          │        resume/cancel     └───────────────────┘  │
│         │                          │          │ estado                          │               │
│         │              PositionSource         ▼                                 ▼               │
│         │        GPS · simulación · replay   Mapa ArcGIS + HUD          ficha IA, video, quiz,  │
│         │                                                               redirect, 3D/RA...      │
└─────────┼───────────────────────────────────────────────────────────────────────────────────────┘
          │ REST /api/v1 (HTTPS)
┌─────────▼────────────────────── Servidor (VPS Contabo · Coolify + Traefik) ────────────────────┐
│  API Fastify (TS) ── PostgreSQL (+PostGIS)                                                      │
│   ├─ rutas y contenidos (CRUD)            ├─ búsqueda de lugares (Wikidata)                     │
│   ├─ sugerencias y fichas con IA          ├─ recorridos (runs) y analytics privados             │
│   └─ (futuro) cuentas, push, panel B2B                                                          │
│        │                     │                         │                                        │
│   Proveedor IA          Wikipedia / Wikidata /     ArcGIS Location Services                     │
│   (clave en servidor)   Wikimedia Commons          (geocoding)                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Stack y estructura del repositorio

### 5.1 Stack

| Capa | Tecnología |
|---|---|
| Monorepo | pnpm 12 workspaces (su configuración vive en `pnpm-workspace.yaml`), Node.js 24 LTS |
| Lenguaje | TypeScript 6.0 `strict` en todo el repo. La 7 (compilador nativo) aún no es compatible con vue-tsc ni con typescript-eslint |
| Validación | Zod (esquemas compartidos; generar JSON Schema desde Zod para la salida estructurada de la IA) |
| Web | Vue 3 + Vite 8 + Pinia + Vue Router + vue-i18n (catálogos es/en/pt) + vite-plugin-pwa (Workbox, estrategia `injectManifest`). Fuentes Fraunces e Inter alojadas en la app (`@fontsource`): funcionan sin conexión y no envían la IP del usuario a terceros |
| Mapa | ArcGIS Maps SDK for JavaScript (`@arcgis/core`, `MapView` + `GraphicsLayer`), encapsulado en un componente propio |
| UI | CSS propio con tokens (variables CSS) de `docs/DESIGN.md`; iconos Lucide; SortableJS (vía `vue-draggable-plus`) para reordenar |
| API | Fastify 5 + `fastify-type-provider-zod` + `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/swagger`. Sin CORS: la API comparte origen con la web |
| BD | PostgreSQL 17 + PostGIS 3.5 (imagen `postgis/postgis`; su uso es opcional en v1) + Drizzle ORM + drizzle-kit (migraciones) |
| IA | Interfaz `AiProvider` con una implementación por defecto, la API de Anthropic (`AI_PROVIDER=anthropic`, modelo `claude-sonnet-5-5` por defecto, configurable con `AI_MODEL`). Salida estructurada con una herramienta cuyo JSON Schema es la respuesta, validada con Zod |
| Tests | Vitest (unitarios y de escenario), Playwright (e2e con geolocalización simulada) |
| Calidad | ESLint 10 (flat config) + Prettier 3, Conventional Commits, GitHub Actions (formato, lint, typecheck, tests, build, imágenes Docker y escaneo de secretos con gitleaks) |
| Despliegue | Docker (un Dockerfile por app) en Coolify, Traefik con HTTPS (obligatorio para geolocalización y service worker). Detalle en [DEPLOY.md](DEPLOY.md) |

### 5.2 Estructura

```
rumbo/
├─ apps/
│  ├─ web/                    # PWA headless (Vue 3 + ArcGIS)
│  └─ api/                    # API REST (Fastify + Postgres)
├─ packages/
│  ├─ geo-utils/              # Matemática geográfica: haversine, rumbo, distancia a segmento/polilínea, bbox
│  ├─ route-spec/             # CONTRATO DE ENTRADA: tipos, esquemas Zod, validación, normalización, migraciones, PointContent
│  ├─ route-builder/          # MÓDULO 1 · CREADOR: RouteDraft → RouteSpec, resumen (distancia, duración)
│  ├─ geo-engine/             # MÓDULO 2 · MOTOR: reglas, estado, eventos, fuentes de posición
│  ├─ event-system/           # MÓDULO 3 · EVENTOS: handlers v1, cola, decisiones, feedback (sin UI)
│  └─ api-contract/           # DTOs Zod compartidos entre web y api
├─ data/
│  └─ routes/                 # Rutas precargadas (RouteBundle JSON), validadas en CI
├─ docs/
│  ├─ PROJECT_PLAN.md         # este documento
│  ├─ DESIGN.md               # propuesta gráfica
│  ├─ DEPLOY.md               # producción: Coolify, ramas y despliegue
│  ├─ SECURITY.md             # secretos, repositorio público y rutas de usuario
│  ├─ design/                 # mockups exportados y capturas de pantalla
│  └─ adr/                    # decisiones de arquitectura
├─ scripts/deploy-prod.sh     # promoción de main a production
├─ .github/workflows/ci.yml
└─ README.md                  # plantilla CSE 310 (inglés)
```

### 5.3 Reglas de dependencia

```
geo-utils ◄── route-spec ◄── route-builder
    ▲             ▲    ▲
    │             │    └──── api-contract
    └──── geo-engine ◄── event-system (solo tipos del motor)

apps/web → todos los paquetes      apps/api → route-spec, route-builder, api-contract, geo-utils
```

- Los paquetes **nunca** importan de `apps/`.
- `geo-engine` y `event-system` **no** importan DOM, Vue ni ArcGIS. Hazlo cumplir con `no-restricted-imports` de ESLint y `lib: ["ES2022"]` sin `DOM` en sus `tsconfig`.

---

## 6. Contrato de entrada: `RouteSpec` v1 (`@rumbo/route-spec`)

### 6.1 Tipos

Todas las coordenadas son objetos `{ lat, lng }` para evitar errores de orden; ArcGIS y GeoJSON usan lng/lat. Las distancias van en **metros**, los tiempos de configuración en **segundos** y las marcas de tiempo en **ms epoch**.

```ts
export type LatLng = { lat: number; lng: number };
export type RouteMode = 'free' | 'challenge';        // UI: "Libre" | "Reto"
export type Activity = 'walk' | 'run' | 'bike';      // UI: "A pie" | "Correr" | "Bici"
export type RouteSource = 'curated' | 'user';
export type Locale = 'es' | 'en' | 'pt';             // 'pt' = portugués de Portugal (pt-PT)
export type LocalizedText = string | Partial<Record<Locale, string>>;
                                     // un string está en spec.locale (ADR 0001)

export interface RouteSpec {
  specVersion: 1;
  id: string;                          // slug único ^[a-z0-9-]{3,64}$
  name: LocalizedText;                 // 1..80 por idioma
  summary?: LocalizedText;             // ≤280, para tarjetas
  description?: LocalizedText;         // markdown corto
  locale: Locale;                      // idioma de origen: el de los textos que son string
  mode: RouteMode;
  activity: Activity;                  // default 'walk'
  source: RouteSource;
  coverImage?: MediaRef;
  settings?: Partial<RouteSettings>;   // se completa con valores por defecto (normalización)
  points: RoutePoint[];                // 1..100
  path?: LatLng[];                     // trazado opcional (≥2): dibujo + cálculo de desvío
  actions: Record<string, ActionDef>;  // acciones referenciadas por los triggers
  triggers?: RouteTriggers;
  meta?: Record<string, unknown>;      // OPACO para el motor (lo usa la UI)
}

export interface RouteSettings {
  defaultRadius: number;               // m. Default 40. Rango 10..500
  exitHysteresis: number;              // m. Default 10. Salida = distancia > radio + histéresis
  dwellTime: number;                   // s. Default 5. Permanencia dentro de la zona para confirmar llegada
  minAccuracy: number;                 // m. Default 30. Lecturas peores no deciden zonas
  approachDistance: number;            // m. Default 100. 0 = desactivado
  deviation: { enabled: boolean; maxDistance: number; graceTime: number };
                                       // default: enabled = (mode === 'challenge' || !!path); 150 m; 30 s
  idle: { enabled: boolean; time: number; radius: number };
                                       // default: true; 600 s; 25 m
  timeLimit: number | null;            // s. Default null
  maxSpeed: number;                    // m/s. Filtro de saltos de GPS. Default por actividad: walk 7, run 10, bike 25
  expectedSpeed: number;               // m/s para ETA. Default por actividad: walk 1.3, run 2.8, bike 5
  autoCompleteWithoutAction: boolean;  // default true: un punto sin onEnter se completa al hacer check-in
  allowManualCheckIn: boolean;         // default: true en free, false en challenge (botón "Estoy aquí")
}

export type PointCategory =
  | 'monument' | 'museum' | 'church' | 'viewpoint' | 'nature' | 'food'
  | 'culture' | 'checkpoint' | 'start' | 'finish' | 'other';

export interface RoutePoint {
  id: string;                          // único en la ruta ^[a-z0-9_-]{1,64}$
  name: LocalizedText;
  position: LatLng;
  order: number;                       // 1..n, único y consecutivo
  radius?: number;                     // sobrescribe defaultRadius
  required?: boolean;                  // default true
  category?: PointCategory;            // icono y filtro en la UI
  triggers?: PointTriggers;
  contentRef?: string;                 // id de PointContent (ficha del lugar)
  meta?: Record<string, unknown>;      // OPACO para el motor
}

export interface PointTriggers {       // valores = id de una acción en RouteSpec.actions
  onApproach?: string | null;
  onEnter?: string | null;
  onExit?: string | null;
}

export interface RouteTriggers {
  onStart?: string | null;
  onDeviation?: string | null;
  onBackOnTrack?: string | null;
  onIdle?: string | null;
  onOutOfOrder?: string | null;
  onTimeout?: string | null;
  onFinish?: string | null;
  onCancel?: string | null;
}

export interface ActionDef {
  type: string;                        // clave del registro de handlers: 'ai_template', 'video', 'quiz'...
  params?: Record<string, unknown>;    // cada handler valida sus params con su propio esquema Zod;
                                       // sus textos son LocalizedText (pueden traer los 3 idiomas)
  presentation?: 'blocking' | 'toast'; // default 'blocking'
  feedback?: { vibrate?: boolean; sound?: string | null; notify?: boolean }; // sobrescribe el feedback por defecto
}

export interface MediaRef {
  url: string; alt: LocalizedText; credit?: string; license?: string; sourceUrl?: string;
}

export interface RouteBundle {          // lo que viaja entre API, caché y app
  spec: RouteSpec;
  contents: Record<string, Partial<Record<Locale, PointContent>>>;  // [contentRef][locale]
}
```

### 6.2 Ejemplo

```json
{
  "specVersion": 1,
  "id": "leiria-historica",
  "name": { "es": "Leiria histórica", "en": "Historic Leiria", "pt": "Leiria histórica" },
  "summary": {
    "es": "Castillo, catedral y plazas del centro en un paseo de 2 horas.",
    "en": "Castle, cathedral and town squares in a two-hour walk.",
    "pt": "Castelo, sé e praças do centro num passeio de duas horas."
  },
  "locale": "es",
  "mode": "free",
  "activity": "walk",
  "source": "curated",
  "settings": { "defaultRadius": 40, "dwellTime": 5 },
  "points": [
    {
      "id": "castelo",
      "name": "Castelo de Leiria",
      "position": { "lat": 39.7476, "lng": -8.8070 },
      "order": 1,
      "radius": 60,
      "category": "monument",
      "contentRef": "c-castelo",
      "triggers": { "onApproach": "near_toast", "onEnter": "castelo_ficha" },
      "meta": { "thumbnail": "castelo.jpg" }
    }
  ],
  "actions": {
    "near_toast":    { "type": "toast", "presentation": "toast", "params": { "messageKey": "run.approaching" } },
    "castelo_ficha": { "type": "ai_template", "params": { "contentRef": "c-castelo" } },
    "aviso_desvio":  { "type": "decision", "params": { "preset": "deviation" } }
  },
  "triggers": { "onDeviation": "aviso_desvio" }
}
```

> Las coordenadas del ejemplo son orientativas. Las rutas reales usan coordenadas verificadas (sección 15).
> El nombre del punto es un `string` simple: los nombres propios no se traducen.

### 6.3 Validación (`validateRouteSpec`)

`validateRouteSpec(input, opts?) → { ok, spec?: NormalizedRouteSpec, errors: Issue[], warnings: Issue[] }`, donde cada `Issue` lleva `{ path, code, message }`.

**Errores** (la ruta se rechaza):

- Esquema inválido (tipos, rangos, longitudes).
- `id` de punto duplicado.
- `order` no único o no consecutivo desde 1.
- Coordenadas fuera de rango.
- Un trigger apunta a una acción que no existe en `actions`. Solo cuentan las acciones propias del objeto: `constructor` o `toString` no son acciones.
- `path` con menos de 2 puntos.
- Más de 100 puntos.
- Un `LocalizedText` vacío o con claves de idioma no soportadas.

**Advertencias** (la ruta es válida):

- Zonas solapadas: la distancia entre dos puntos es menor que la suma de sus radios.
- Acción definida y no usada.
- Tipo de acción desconocido, si se pasa `opts.knownActionTypes`.
- Ruta `challenge` con un solo punto.
- `radius` < 20 m (riesgo por la precisión del GPS).
- Falta una traducción (`missing_translation`). Con `opts.requireLocales` pasa a ser error: las rutas curadas exigen `es`, `en` y `pt`.

**Funciones auxiliares del paquete:**

- `normalizeRouteSpec(spec)`: aplica los valores por defecto según modo y actividad. **El motor solo acepta specs normalizados.**
- `migrateRouteSpec(input)`: convierte versiones anteriores de `specVersion` a la actual.
- `hashRouteSpec(spec)`: SHA-256 del JSON canónico de los campos que usa el motor: puntos, posiciones, radios, orden, ajustes, trazado y triggers. Deja fuera los textos y el contenido de las acciones. Sirve para detectar cambios en snapshots y en runs: corregir o traducir un texto, o ajustar un quiz, no invalida los recorridos guardados.
- `resolveText(text, locale)`: devuelve el texto en el idioma pedido, siguiendo la cadena de respaldo del [ADR 0001](adr/0001-multilenguaje.md) (idioma pedido → `spec.locale` → `en` → `es` → `pt`), e indica qué idioma se usó.

### 6.4 Contrato de contenido: `PointContent`

Es la ficha del lugar. La IA la genera para las rutas de usuario y se escribe a mano para las curadas. La plantilla `ai_template` la pinta. **La IA solo genera datos con este esquema, nunca interfaz.**

Hay una ficha por idioma, en `RouteBundle.contents[contentRef][locale]`. Las curadas traen los tres idiomas. Las generadas por IA solo existen en el idioma en que se generaron.

```ts
export interface PointContent {
  id: string;                    // = contentRef
  locale: Locale;
  title: string;                 // ≤80
  subtitle?: string;             // ≤120
  summary: string;               // 2-4 frases
  body?: string;                 // markdown limitado (sin HTML)
  facts: string[];               // 0-6 datos curiosos, ≤160 caracteres cada uno
  images: MediaRef[];            // reales (Wikimedia Commons) con autoría y licencia
  video?: { provider: 'youtube' | 'file'; id?: string; url?: string; title?: string };
  tip?: string;                  // consejo práctico
  quiz?: {                       // trivia: una pregunta rápida al llegar (fase 7)
    question: string;            // ≤300
    options: string[];           // de 2 a 4, ≤120 caracteres cada una
    correctIndex: number;        // posición de la correcta en `options`
    explanation?: string;        // ≤500
  };
  sources: { title: string; url: string }[];  // fuentes usadas (grounding)
  generated?: { by: 'ai' | 'human'; model?: string; promptVersion?: string; at: string };
  status: 'draft' | 'approved';
}
```

**La trivia (`quiz`)** va dentro de la ficha y en su idioma, como texto simple y no como `LocalizedText`: una ficha tiene un solo idioma. Es distinta de la acción `quiz` (§9.5), que escribimos a mano en los tres idiomas y con los puntos que diga su `params`. El handler `ai_template` la puntúa: si el resultado de la vista trae `data.answerIndex`, el resultado lleva `score` (10 puntos, `CARD_QUIZ_POINTS`, si acierta; 0 si no) y `data { answerIndex, correct }`. Sin respuesta no hay puntuación.

---

## 7. Módulo 1: Creador (`@rumbo/route-builder` + wizard en la web)

**Responsabilidad única:** producir un `RouteBundle` (`RouteSpec` + `contents`) válido. El motor no sabe quién creó la ruta.

**Fuentes de rutas:**

1. **JSON curado** en `data/routes/*.json`. Se valida en CI (`pnpm validate:routes`) y se carga en la BD (`pnpm db:seed`).
2. **Wizard en la app** (planificador): el formulario construye un `RouteDraft` y `buildRouteSpec` lo convierte en `RouteSpec`.
3. *(Futuro)* Editor visual avanzado y panel B2B para negocios.

```ts
export interface RouteDraft {
  name: string;
  locale: Locale;                    // el idioma de la app al crear la ruta (no se pregunta)
  mode: RouteMode;
  activity: Activity;
  interests?: string[];              // para la IA: 'history', 'art', 'architecture', 'food', 'nature', 'religion', 'curiosities' (INTERESTS, en api-contract)
  summary?: string;                  // ≤280, texto simple: la idea de ruta que sugirió la IA → spec.summary
  timeLimit?: number | null;         // s; solo challenge
  places: DraftPlace[];              // el ORDEN del array es el orden de la ruta
  settingsOverrides?: Partial<RouteSettings>;
}

export interface DraftPlace {
  tempId: string;
  pointId?: string;                  // id del punto en la ruta guardada (al editar): se conserva tal cual
  name: string;
  position: LatLng;
  address?: string;
  externalId?: string;               // p. ej. QID de Wikidata o id del geocodificador
  category?: PointCategory;
  radius?: number;
  required?: boolean;
  contentRef?: string;
}

buildRouteSpec(draft, opts: { source: 'user'; id?: string; idFactory?: () => string })
  → { spec: RouteSpec; normalized: NormalizedRouteSpec; warnings: Issue[] }
summarizeRoute(spec)
  → { pointCount, distanceMeters, estimatedMinutes, centroid, bbox }
```

`spec` es la ruta tal como se escribe: lo que se guarda y se envía a la API. `normalized` lleva todos los valores por defecto y es lo que ejecuta el motor, también en «Probar ruta».

**Reglas de `buildRouteSpec`:**

- Genera el `id`: un slug del nombre, un guion y un sufijo de 10 caracteres `[a-z0-9]` de `crypto.getRandomValues` (unos 52 bits: no se puede adivinar a partir de otro id). Con `opts.id` (al editar) se conserva el id guardado.
- Ids de punto estables: un lugar con `pointId` lo conserva; los lugares nuevos reciben un slug de su nombre, sin repetir. Así, renombrar o reordenar lugares no cambia los ids de punto, los de acción (`content_<pointId>`) ni `hashRouteSpec`, y los recorridos guardados siguen valiendo.
- Asigna `order` según la posición en el array.
- Acciones por defecto en rutas de usuario: cada punto tiene `onEnter → content_<pointId>`, de tipo `ai_template` si hay `contentRef` y de tipo `info_sheet` (nombre + dirección, nunca imagen) si no lo hay.
- Triggers de ruta por defecto: `onDeviation`, `onIdle`, `onOutOfOrder` y `onTimeout` apuntan a acciones `decision` con su preset.
- Limpia los textos (tabuladores y saltos de línea pasan a un espacio; se quitan los caracteres de control, los sustitutos Unicode sueltos y las marcas bidireccionales) y no comparte ninguna referencia con el borrador.
- Siempre devuelve un spec que pasa `validateRouteSpec`. Si no puede, lanza `RouteBuildError` con los issues.

**Otras funciones del paquete** (`draft.ts`, sin UI):

- `DRAFT_LIMITS`: de 2 a 30 lugares; nombres hasta 80 caracteres y direcciones hasta 200; ruta de hasta 500 km; radio de 20 a 200 m en pasos de 5 (40 por defecto). `TIME_LIMIT_PRESETS`: 30, 60, 90, 120 y 180 minutos.
- `draftFromSpec(spec)`: el borrador de una ruta guardada, para editarla. Construir la ruta desde él, con el mismo `id`, devuelve el mismo spec.
- `summarizeDraft(draft)`: distancia, duración estimada y tramos, aunque el borrador esté vacío o incompleto.
- `findOverlaps(places)`: pares de lugares cuyas zonas se solapan (la regla de la advertencia `overlapping_zones`).
- `validateDraft(draft)`: lo que aún impide guardar, por paso: `name_required`, `name_too_long`, `too_few_places`, `too_many_places`, `place_name_required`, `radius_out_of_range`, `time_limit_invalid` y `route_too_long`.
- `newIdSuffix()` y `truncateText(texto, máximo)`.

**Wizard (la UI está detallada en `docs/DESIGN.md`).** Los pasos se numeran como las pantallas C1 a C5. El Stepper tiene **cuatro pasos**: Datos · Lugares · Fichas · Revisar. La pantalla final (Lista) queda fuera del Stepper.

1. **Datos:** nombre, zona (ciudad o área: centra el mapa y la búsqueda, y no se guarda en la ruta), modo, actividad y límite de tiempo (reto), más los **intereses** (opcionales): historia, arte, arquitectura, gastronomía, naturaleza, religión y curiosidades. No se pregunta el idioma: es el de la app (al editar, el de la ruta), y una línea avisa de que «Las fichas se generarán en {idioma}». **«Usar mi ubicación»** lee la posición una sola vez, al pulsar, y la pone como zona («Tu ubicación»), redondeada a 3 decimales.
2. **Lugares:** búsqueda con autocompletado (Wikidata vía backend, §12.3). Un punto personalizado se añade con una **pulsación larga en el mapa** o con el botón **«Añadir el centro del mapa»**, no tocando el mapa. La lista se **reordena arrastrando** o con «Subir» y «Bajar» en el menú de cada lugar. Radio y obligatoriedad por punto, zonas dibujadas en el mapa con aviso de solapamiento, y distancia y duración estimadas. De 2 a 30 lugares. **«Sugerir lugares»** pide ideas a la IA (§12.4): el usuario da el tiempo que tiene, marca los lugares que quiere y se añaden en el orden sugerido.
3. **Fichas:** la app prepara una ficha por lugar con el pipeline del §12.2, **sin enseñarla**: cada fila dice solo su estado («Ficha lista · 3 fuentes»). «Ver ficha» pide confirmación antes de abrirla (sin spoilers); «Regenerar» pide otra ficha; «Usar ficha básica» renuncia a la IA en ese lugar. «Siguiente» nunca se bloquea: un lugar sin ficha lista usa la ficha básica (`info_sheet`, nombre y dirección).
4. **Revisar y simular:** validación, advertencias, la línea «{n} fichas con IA · {m} básicas» y botón **Probar ruta** (motor con fuente simulada, con las fichas incluidas).
5. **Guardar:** la ruta se guarda siempre primero en IndexedDB, en el registro de «Mis rutas», y se sube en segundo plano con `POST /api/v1/routes`. Las fichas viajan en `contents` del bundle, en el idioma de la ruta, así que la ruta funciona sin conexión y sin llamar a la IA al llegar.

El borrador se guarda automáticamente en IndexedDB mientras se edita, para no perder datos, y `/create` lo retoma en el primer paso con algo pendiente. Las rutas guardadas se editan desde Mis rutas y conservan los ids de punto (§7.1).

### 7.1 Precisiones de la implementación (fase 6)

Al construir el creador se concretaron estos puntos. Los del servidor están en el §11.7, la búsqueda de lugares en el §12.3 y el razonamiento de fondo (rutas privadas, token del cliente, borrado) en el [ADR 0002](adr/0002-rutas-de-usuario.md).

- **Contratos compartidos:**
  - Los esquemas de `params` de `info_sheet`, `ai_template` y `decision`, y la lista `INTERRUPTIONS`, viven en `route-spec` (`src/actions.ts`). `event-system` y `api-contract` los importan de ahí: con una sola definición, un cambio en un handler no puede dejar a la API rechazando rutas que la app acaba de crear.
  - Un trigger solo puede apuntar a una acción propia de `actions` (y una ficha, a una clave propia de `contents`): `constructor`, `toString` o `__proto__` dan `unknown_action`.
  - `findLocalizedTexts` se detiene a 16 niveles de profundidad. Sin ese tope, unos `params` anidados 20.000 niveles desbordaban la pila, y una petición manipulada habría recibido un 500.
  - `checkUserRoute` (`api-contract`) es la lista cerrada de lo que puede tener una ruta de usuario (§11.3). La API rechaza lo que se salga de ella, y los tests comprueban que todo lo que construye `buildRouteSpec` pasa.
- **Registro local y sincronización** (`services/myRoutes.ts`):
  - Cada ruta creada vive en IndexedDB (clave `routes:mine`, con forma `{ v: 1, records }`) con su bundle tal como se escribió, su token de edición y su estado de subida. Funciona antes de subirse y sin conexión. El servicio no importa stores: el catálogo escucha sus cambios.
  - **Estado de cada registro:** `rev` (sube con cada cambio local), `sync` (`synced`, `pending` o `error`, con el código del error) y `remote` (`no`, `maybe` o `yes`: si el servidor puede tener una copia). `maybe` se guarda **antes** de que el primer POST salga del dispositivo: un 201 perdido, o un POST que el cliente abandonó por tiempo y el servidor sí completó, no deja una copia imposible de borrar.
  - **Escrituras atómicas:** cada cambio es una sola transacción de IndexedDB (`db.update`), también entre pestañas. Una lectura fallida nunca escribe, y un formato desconocido (de una versión más nueva de la app) no se sobrescribe. Las operaciones «checked» de `storage.ts` rechazan en vez de fallar en silencio, y por eso «Guardar ruta» puede avisar si el dispositivo no la guardó.
  - **Una respuesta solo vale para lo que se envió:** el resultado completo se aplica únicamente si `rev` no cambió mientras la petición estaba en camino. Si el usuario editó entretanto, el registro solo toma lo que la respuesta demuestra (la API tiene o no tiene copia), sigue `pending` y la nueva versión sale en otro pase. Un registro borrado entretanto no se vuelve a crear.
  - **Solo cuentan las respuestas de la API:** un 2xx con un cuerpo válido (`RouteWriteResponseSchema`, con el mismo id), un 204 en un DELETE o un `ApiError` 4xx. Todo lo demás deja la ruta `pending` y suma un fallo: la página HTML de nginx mientras la API se reinicia, un 404 o 405 sin `ApiError`, 408, 425, 429, 5xx, sin red o tiempo agotado. A los cinco fallos seguidos pasa a `error`. Sin esta distinción, un despliegue de la API dejaría rutas en `error` o borraría una lápida sin haber borrado nada.
  - **Casos especiales:** un PUT que responde `route_not_found` pasa a POST (una vez por pase). Un DELETE termina con 204 o `route_not_found`, y cualquier otro 4xx descarta la lápida, porque la API nunca lo aceptará. Los demás 4xx de la API (`invalid_route`, `route_exists`, `quota_exceeded`, `forbidden`, `payload_too_large`) dejan la ruta en `error`, sin reintento automático.
  - **Cuándo sincroniza:** tras guardar, borrar o reintentar; al abrir la app; con `online`, con `pageshow` y al volver la pestaña a primer plano; y cada 60 s mientras quede algo pendiente. Las peticiones se juntan (si llega otra mientras corre un pase, el bucle hace uno más) y cada pase corre bajo `navigator.locks` (`rumbo-routes-sync`), así que dos pestañas no envían a la vez. Sin conexión no se intenta nada ni se cuentan fallos. Las escrituras esperan hasta 30 s: una ruta de 30 lugares tarda en subir con mala cobertura.
  - **Borrar:** una ruta que la API no ha visto (`remote: 'no'`) y sin subida en curso desaparece al momento. Si no, queda una lápida (`deleted`) hasta que la API confirme el DELETE. En ambos casos se borran también su copia descargada (`bundle:<id>`) y el recorrido en curso o el último resumen de esa ruta.
  - **Borrar los datos locales** (Ajustes): `deleteAllMyRoutesRemote()` intenta un DELETE por cada ruta con `remote` distinto de `no`, con 3 s como máximo cada uno y sin bloquear si fallan. Ajustes cuenta cuántas rutas se borrarán del servidor y cuántas se perderán por no haberse subido.
  - **Almacenamiento persistente:** tras el primer guardado se pide `navigator.storage.persist()`. El registro tiene la única copia de las rutas sin subir y de todos los tokens.
  - **Recorridos de una ruta sin subir:** la API no la conoce, así que `POST /runs` responde `route_not_found` y la web no registra ese recorrido. Funciona igual; solo se pierde su métrica.
- **Catálogo:**
  - Guarda las rutas curadas y las del usuario en dos listas (`curated` y `mine`), y `routes` las une. Así, una ruta guardada antes de que cargue la lista no se pisa.
  - `mine` se lee primero, del dispositivo y sin red, y sigue los cambios del registro. Una ruta cuyo bundle ya no valida no entra en el catálogo, pero Mis rutas la sigue mostrando, con «Eliminar».
  - `checkRecoverable` solo borra el recorrido guardado de una ruta que ya no existe cuando el catálogo es la autoridad: el registro se leyó y las rutas curadas vinieron de la API. Sin conexión, las que van dentro de la app harían parecer que falta una ruta que solo está en la API.
- **Borrador** (`stores/creator.ts`):
  - Vive en una sola clave, `create:draft`. Se guarda 300 ms después del último cambio y también al ocultar la pestaña (`visibilitychange`) o cerrarla (`pagehide`). Si el dispositivo no lo admite, el creador sigue y muestra un aviso.
  - Se valida campo a campo al leerlo. Un borrador de otra versión o con campos rotos se copia a `create:draft:backup`, y el creador sigue con lo que se pueda aprovechar (o desde cero): nunca se queda bloqueado por un borrador roto.
  - Entre pestañas, cada versión lleva una revisión (`rev`, nunca menor que el reloj) y la pestaña que la escribió. Al volver a una pestaña se adopta el borrador más nuevo de otra.
  - `/create` abre el borrador en el primer paso con algo pendiente (`resumeStep`), y cada paso exige los anteriores (guardia del router).
  - **Editar:** Mis rutas carga la ruta en el borrador (`loadForEdit`) y abre Datos; no hay `?edit=` en la URL. El id de la ruta y los de punto se conservan. Si ya hay otro borrador con contenido, se pide confirmación antes de descartarlo, y borrar una ruta descarta el borrador que la edita.
  - **Guardar**, en este orden: se construye la ruta; se guarda en el registro (si la escritura local falla, el borrador queda como estaba y se avisa); se detiene el autoguardado; se cierra el borrador; y **al final** se borra `create:draft`, para que nada vuelva a escribirlo. La subida sigue en segundo plano, y la pantalla final lee el estado del registro (`synced` o `pending`) sin esperar a la red. Una ruta nueva nunca sobrescribe otra con el mismo id: ante una colisión local, prácticamente imposible, se cambia el sufijo una vez.
- **Probar ruta** (`stores/run.ts`):
  - Corre la ruta normalizada, aunque aún no esté guardada, en **simulación forzada** sea cual sea el ajuste.
  - Está aislada de un recorrido real: no escribe `run:active` ni `run:last`, no deja resumen, no registra inicio ni fin en la API, no manda analytics, no sale en la MiniRunBar y la navegación al resumen no hace nada.
  - Si hay un recorrido real en curso, el usuario lo confirma y su estado se guarda antes de empezar. Al terminar la prueba se vuelve a ofrecer (S11), en pausa.
  - **Todas las salidas** (llegar al final, «Volver al editor», salir de la pantalla) pasan por una sola función, `finishTrial`, que hace siempre lo mismo y en este orden: ignorar los eventos del motor, guardar el resultado de la prueba, salir de `/run`, limpiar el estado, mostrar el aviso y comprobar si hay un recorrido para continuar. Sale con `router.back()` si la entrada anterior del historial es Revisar, y si no con `replace`, para que Atrás no se duplique. El aviso («Prueba completada: 3 de 4 lugares» o «Prueba terminada») va después de limpiar porque limpiar vacía los avisos.
  - `checkRecoverable` no hace nada mientras hay un recorrido o una prueba en marcha, y descartar un recorrido recuperado lo cierra en la API como `cancelled`.
- **Mapa del creador** (`RouteMap.vue`):
  - `zones`: un círculo por lugar (por `id`), con tono `default` o `warning`.
  - `mapHold`: pulsación larga fuera de los marcadores (500 ms sin arrastrar; el SDK no envía un clic después).
  - `MapMarker.warning`: aro ámbar e insignia «!». El ámbar del mapa es `#B07400` y no `#8A5A00` (el `--color-warning` de DESIGN §5.1), que no se distingue sobre el mapa base oscuro.
  - `RouteMapApi` añade `goTo(centro, zoom?)` y `center()`: el centro del área visible, descontando el padding de las hojas, o `null` mientras el mapa no esté listo (la mira del creador solo aparece entonces).
  - El componente soporta desmontarse mientras la vista aún carga.
- **Seguridad de la web:** nginx envía `Content-Security-Policy` (`object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`), `X-Content-Type-Options: nosniff` y `Referrer-Policy: strict-origin-when-cross-origin` en cada `location`, y ESLint tiene `vue/no-v-html` en `error`. Los tokens de edición viven en IndexedDB, así que un XSS futuro podría leerlos y editar o borrar rutas ([SECURITY.md](SECURITY.md)).
- **Textos:** un test recorre `apps/web/src` y comprueba que cada clave de `t('…')` o `{ key: '…' }` existe en `es.json`. Una clave que falte se vería en pantalla como `create.places.xxx`.
- **Tests:**
  - `route-builder` pasa de 17 a 61 tests, con la misma barrera de cobertura que el motor (90 % de líneas, sentencias y funciones; 85 % de ramas) y 100 % medido. `route-spec` pasa de 39 a 46 y `api-contract` de 4 a 27, con la comprobación de que todo lo que construye `buildRouteSpec` pasa `checkUserRoute`.
  - La capa de datos de la web tiene sus tests con IndexedDB falso y `fetch` simulado: un 201, un 201 perdido y el reintento, una edición durante un POST en curso, un borrado durante un POST, una página HTML en lugar de la API, dos cambios simultáneos y una lectura fallida que no vacía el registro.

### 7.2 Precisiones de la implementación (fase 7)

Al construir los pasos nuevos del creador se concretaron estos puntos. Las fichas y las sugerencias del servidor están en el §12, la pregunta rápida de la llegada en el §10.10 y el razonamiento de fondo en el [ADR 0003](adr/0003-guia-con-ia.md).

- **Servicios** (`services/ai.ts`, `content.ts` y `suggest.ts`):
  - `postAi` hace el POST con `X-Device-Id`, comprueba la respuesta contra el contrato y solo rechaza con `AiError`, cuyo `code` es `offline`, `ai_unavailable`, `ai_budget_exceeded`, `ai_device_limit` o `failed`.
  - Un `429 rate_limited`, un `502 generation_failed`, una página HTML del proxy o un cuerpo que no cumple el contrato son `failed`. Un fallo de red es `offline` solo si `navigator.onLine` es falso.
  - `generateCard` espera hasta 120 s (el plazo de la API es de 90 s) y rechaza como `failed` una ficha cuyo `locale` no sea el pedido, porque rompería el bundle. `suggestPlaces` espera 60 s y redondea `near` a 3 decimales también en el cliente.
- **Borrador** (`stores/creator.ts`): sigue siendo `v: 1`, así que los borradores anteriores se leen bien. Añade `interests`, `summary` (se corta a 280) y `cards`, por `tempId`: `{ status, content?, grounding?, error? }`, con `status` en `pending`, `generating`, `ready`, `error` o `basic`.
  - Al leerlo, `generating` y `error` pasan a `pending`: una petición muere con la página y un error no merece recordarse.
  - Una ficha `ready` necesita su contenido y su `contentRef`, y las fichas de lugares que ya no están se descartan. Una lectura rota se copia a `create:draft:backup`, como cualquier otra reparación.
- **Pasos:** `CREATOR_STEPS` = details, places, content, review. `stepIssues('content')` es siempre vacío: el paso nunca bloquea. `resumeStep` abre el primer paso con algo pendiente, y Fichas cuenta como pendiente mientras algún lugar no tenga entrada de ficha, esté `pending` o espere conexión. Atrás en Revisar lleva a Fichas, y en Fichas, a Lugares.
- **Cola de generación** (de 2 en 2, en el orden de la lista, sin guardar nada): `generateMissing()`, `regenerateCard(id)`, `setBasicCard(id)` y `setBasicForFailed()`.
  - Sin conexión marca `error: 'offline'` sin pedir nada, y el evento `online` lo reintenta.
  - Un error bloqueante (`ai_*`) u `offline` falla igual los lugares que seguían en cola, sin más peticiones. Un `failed` no frena a los demás.
  - El resultado de un borrador que se reemplazó o cerró, o de un lugar que se quitó, se ignora. Descartar, empezar otro borrador, editar, guardar, «Borrar mis datos locales» y cerrar el ámbito del store cancelan las peticiones en curso.
- **Regenerar** envía `fresh: true` (§11.1). La ficha anterior sigue vigente, y viaja en la ruta, mientras llega la nueva; si la nueva falla, se queda la anterior y un aviso lo dice.
- **`contentRef` y `contents`:** una ficha lista le da al lugar `contentRef = 'card-' + sufijo` (se conserva al regenerar). `build()` devuelve `contents` (`{ [contentRef]: { [locale]: { ...ficha, id: contentRef } } }`) y guardar se lo pasa a `saveMyRoute`. Un lugar sin ficha lista no lleva `contentRef` y muestra el `info_sheet`.
  - **La ficha se guarda tal como la hizo la API.** Si se cambiara cualquier campo, el POST sería un `422 unverified_content`. Un test comprueba que su hash es el mismo antes y después de guardar y de editar.
- **Idioma:** las peticiones usan `draft.locale` (el de la ruta), no el idioma que tenga la app en ese momento. `externalId` solo se envía si es un QID; si no, `custom: true`.
- **Editar** (`loadForEdit`): recupera `summary`, `interests` y las fichas del bundle guardado (el `grounding` se deduce de las fuentes). Los lugares sin ficha pasan a `basic`: abrir el creador nunca gasta presupuesto de IA.
  - Quitar un lugar descarta su ficha, y «Deshacer» la devuelve con él.
  - Un punto propio al que se cambia el nombre pierde su ficha (se investigó por el nombre); uno de Wikidata la conserva.
- **«Sugerir lugares»** (`SuggestSheet`): la posición es el centro del mapa, la zona o el centro de los lugares, tal como están al abrir la hoja. Los intereses se rellenan con los del borrador y vuelven a él al pulsar «Sugerir». Atrás cierra la hoja antes de salir del paso, y cerrarla cancela la petición.
- **Fichas sin spoilers:** ni el texto ni las imágenes de una ficha se pintan antes de la confirmación (lo comprueban un test unitario y el e2e). «Ver ficha» abre la hoja de llegada en modo vista previa (`ui.present('ai_template', { …, preview: true })`, §10.10).
- **Analytics:** `content_generated` (`{ ok, ms }`), uno por petición de ficha (§13).
- **Queda para después:** editar el texto de una ficha, el carrusel de imágenes y la URL de video (el editor del diseño original de C3), e invalidar las fichas cuando cambian los intereses después de crearlas (por ahora se usa «Regenerar»).
- **Tests:** 15 de los servicios, 19 de la cola y el borrador y 17 de la interfaz (sin spoilers, estados, sugerencias), más los del store y el router, adaptados a los 4 pasos.

---

## 8. Módulo 2: Motor de geolocalización (`@rumbo/geo-engine`)

### 8.1 Entradas

1. **`RouteSpec` normalizado:** qué vigilar y con qué reglas.
2. **`PositionSource`:** dónde está el usuario. Es intercambiable en caliente.

```ts
export interface PositionSample {
  lat: number; lng: number;
  accuracy: number;                  // m
  timestamp: number;                 // ms epoch
  heading?: number | null;           // grados 0-360
  speed?: number | null;             // m/s
}

export interface PositionSource {
  kind: 'gps' | 'simulated' | 'replay';
  trusted: boolean;                  // true en simulación: sin filtros de precisión ni de velocidad
  start(onSample: (s: PositionSample) => void, onError: (e: PositionSourceError) => void): void;
  stop(): void;
}

export type PositionSourceError = { code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED'; message: string };

export interface Clock {
  now(): number;                     // epoch ms (marcas de tiempo)
  monotonic(): number;               // ms monotónicos (duraciones; inmune a cambios de hora)
}
export interface Scheduler { every(ms: number, fn: () => void): () => void }  // devuelve cancel()
```

**Fuentes incluidas:**

- `createGeolocationSource(opts?)`: `navigator.geolocation.watchPosition` con `enableHighAccuracy: true`, `maximumAge: 2000` y `timeout: 20000`. Vive en `geo-engine/sources/browser` y es el único archivo con acceso a APIs del navegador; se excluye del lint "sin DOM".
- `createSimulatedSource({ start? })`, con métodos:
  - `teleport(latlng)`: moverse al punto tocado en el mapa.
  - `walkTo(latlng, speed?)`: ir caminando hasta un punto.
  - `followPath(points, speed, timeScale)`: recorrer un trazado.
  - `setAccuracy(m)`: simular mal GPS.
  - `pause()`.
- `createReplaySource(samples, { timeScale })`: reproduce un trayecto grabado.
- `createTrackRecorder(source)`: graba muestras reales y exporta JSON (se usa para crear fixtures de tests).

### 8.2 API pública

```ts
const engine = createGeoEngine(spec, {
  source,                    // PositionSource
  clock?,                    // default: Date.now + performance.now
  scheduler?,                // default: setInterval
  tickMs?: 1000,             // evaluación periódica (permanencia, inactividad, tiempo) aunque no lleguen muestras
  logger?,
});

engine.start();
engine.pause(reason?);               // → boolean: false si no estaba en marcha
engine.resume(reason?);              // → boolean; reintenta el GPS si el permiso estaba denegado
engine.cancel(reason?);              // → boolean
engine.complete(pointId, result?);   // → boolean (solo puntos 'reached'); result: { score?, data? }
engine.canManualCheckIn(pointId);    // → boolean: si mostrar «Estoy aquí» ahora
engine.manualCheckIn(pointId);       // → boolean; solo con settings.allowManualCheckIn y a ≤ 3 radios
engine.setTarget(pointId | null);    // → boolean; modo libre: el usuario elige el siguiente objetivo
engine.setSource(source);            // p. ej. alternar GPS ↔ simulación
engine.getState();                   // EngineState (inmutable)
engine.serialize();                  // EngineSnapshot (JSON) para persistir
engine.on(type | '*', listener);     // → unsubscribe()
engine.subscribe(stateListener);     // flujo de estado → unsubscribe()
engine.destroy();

const restored = restoreGeoEngine(spec, snapshot, options);
// Si hashRouteSpec(spec) !== snapshot.specHash, lanza EngineRestoreError('ROUTE_CHANGED').
// Un recorrido sin terminar vuelve SIEMPRE en 'paused': el usuario confirma para continuar
// y la fuente de posición no arranca hasta resume(). Uno terminado o cancelado vuelve tal cual.
```

### 8.3 Reglas por modo

| Regla | `free` (Libre) | `challenge` (Reto) |
|---|---|---|
| Puntos alcanzables | Todos los no completados | Solo el siguiente en orden |
| Estado inicial de los puntos | Todos `active` | El primero `active`, el resto `locked` |
| Objetivo (`target`) del HUD | El elegido con `setTarget`, o el activo más cercano | El siguiente en orden |
| Entrar en un punto no alcanzable | No aplica | Evento `out_of_order` (no cuenta) |
| Desvío | Solo si hay `path` | Distancia al `path`, o al **corredor** desde el último punto completado (o la posición de inicio) hasta el objetivo |
| Check-in manual | Permitido por defecto | Desactivado por defecto |
| Fin | Todos los `required` completados | Todos los `required` completados (el último en orden) |
| `timeLimit` | Opcional | Opcional |

### 8.4 Algoritmo (por cada muestra y por cada tick)

1. **Aceptación de la muestra:**
   - Se descarta si su `timestamp` es igual o menor que el de la última muestra aceptada.
   - Si `source.trusted` es falso:
     - `accuracy > minAccuracy` → la posición se actualiza en el estado con `quality: 'weak'`, pero **no decide zonas**. Si el GPS sigue débil más de 10 s, se emite `gps_weak` (`reason: 'accuracy'`).
     - Velocidad implícita desde la última muestra aceptada `> maxSpeed` → *outlier*: se ignora.
   - Sin muestras durante más de 30 s con la ruta en curso → `gps: 'lost'` y `gps_weak` (`reason: 'stale'`). Cuando vuelve una muestra buena → `gps_recovered`.
2. **Zonas** (puntos alcanzables, distancia por haversine):
   - `distancia ≤ radio` → dentro. Si no había inicio de permanencia, se marca `dwellStart`.
   - `distancia > radio + exitHysteresis` → fuera. Se borra `dwellStart` y, si el punto estaba `inZone`, se emite `exit`.
   - Entre ambos umbrales se mantiene el estado anterior. Esta histéresis evita el parpadeo por ruido del GPS.
3. **Permanencia** (en muestra y en tick):
   - Si `dwellStart` existe y han pasado `dwellTime` segundos, se emite **`enter`**. El punto pasa a `reached` y se guarda `reachedAt`.
   - Si el punto no tiene `onEnter` y `autoCompleteWithoutAction` es verdadero, se completa en ese momento y se emite `completed`.
   - La permanencia se calcula con **marcas de tiempo, no contando ticks**: con la pestaña en segundo plano los timers se ralentizan y el cálculo sigue siendo correcto.
   - Si hay dos zonas a la vez (modo libre), se procesa primero la más cercana.
4. **Aproximación:** `distancia ≤ approachDistance` emite `approach`, una sola vez por punto y sesión.
5. **Fuera de orden** (reto): una permanencia completa dentro de un punto `locked` emite `out_of_order` (`expectedPointId`, `actualPointId`), una vez por episodio. El punto no cuenta.
6. **Desvío:**
   - Distancia al corredor o al `path` `> maxDistance` de forma continua durante `graceTime` → `deviation` y `flags.offRoute = true`.
   - Volver a `≤ 0.8 × maxDistance` → `back_on_track`.
   - No se evalúa mientras el usuario está dentro de una zona.
7. **Inactividad:**
   - Se fija un ancla de posición; si el usuario se aleja más de `idle.radius`, se reinicia el ancla.
   - Más de `idle.time` cerca del ancla **y fuera de toda zona** → `idle` y `flags.idle = true`, una vez por episodio. Se rearma al moverse.
8. **Tiempo:** `elapsed ≥ timeLimit` → `timeout` y `flags.overtime = true`. **No detiene la ruta**: la UI ofrece seguir sin cronómetro oficial o terminar.
9. **Completar:**
   - `complete(pointId)` solo es válido si el punto está `reached`.
   - Marca `completed`, suma `score` y, en reto, activa el siguiente punto.
   - Si todos los `required` están completados → `finished`, `status: 'finished'` y `endedAt`.
10. **Pausa:**
    - Congela `elapsed` y suspende zonas, permanencia, desvío, inactividad y tiempo. Las muestras siguen actualizando la posición para que el mapa no se congele.
    - Al reanudar se reinician `dwellStart` y el ancla de inactividad, para que nada salte en el instante de reanudar.
11. **Cancelar:** detiene la fuente, pone `status: 'cancelled'` y emite `cancelled` (`reason`).
12. **Traza:**
    - Se añade una muestra aceptada si se ha movido ≥ 10 m o han pasado ≥ 15 s.
    - Tope de 5.000 puntos; al superarlo se simplifica (Douglas-Peucker).
    - Se calculan `distanceMeters`, `movingMs` y `avgSpeed`.

### 8.5 Salida 1: estado (`EngineState`)

Se publica tras cada cambio. La UI lo dibuja (mapa, HUD, progreso) y lo limita a un repintado por frame.

```ts
export type EngineStatus = 'ready' | 'running' | 'paused' | 'finished' | 'cancelled';
export type PointState = 'locked' | 'active' | 'reached' | 'completed';
export type GpsState = 'waiting' | 'good' | 'weak' | 'lost' | 'denied';

export interface EngineState {
  routeId: string;
  specHash: string;
  mode: RouteMode;
  status: EngineStatus;
  startedAt: number | null;
  endedAt: number | null;
  elapsedMs: number;                       // excluye pausas
  gps: GpsState;
  user: {
    position: LatLng; accuracy: number;
    heading: number | null; speed: number | null;
    timestamp: number; quality: 'good' | 'weak';
  } | null;
  target: {
    pointId: string; order: number;        // sin nombre: la UI lo resuelve por pointId (ADR 0001)
    distance: number | null;               // m; null hasta tener posición
    bearing: number | null;                // grados 0-360 desde el usuario; null hasta tener posición
    etaSeconds: number | null;             // distancia / velocidad media (si ≥ 0,3 m/s) o expectedSpeed
    inZone: boolean;
    dwellProgress: number;                 // 0..1 mientras confirma la llegada
  } | null;
  progress: { completed: number; required: number; total: number; percent: number; score: number };
  points: Array<{
    id: string; order: number; state: PointState;
    distance: number | null;
    reachedAt: number | null; completedAt: number | null; score: number;
  }>;
  flags: { offRoute: boolean; idle: boolean; overtime: boolean };
  track: Array<{ lat: number; lng: number; t: number }>;
  stats: { distanceMeters: number; movingMs: number; avgSpeed: number | null };
}
```

### 8.6 Salida 2: eventos (`EngineEvent`)

Todos los eventos tienen la misma forma:

```ts
export interface EngineEvent<T extends EngineEventType = EngineEventType> {
  id: string;                 // único: deduplicación y analytics
  type: T;
  trigger: string | null;     // id de la acción a ejecutar (de RouteSpec) o null
  pointId: string | null;
  timestamp: number;          // ms epoch (reloj inyectado)
  data: EventDataMap[T];
  state: EngineState;         // snapshot ya con el evento aplicado
}
```

| `type` | Trigger que lleva | `data` |
|---|---|---|
| `started` | `triggers.onStart` | `{}` |
| `position` | — | `{ sample }` |
| `gps_weak` | — | `{ reason: 'accuracy' \| 'stale', accuracy? }` |
| `gps_recovered` | — | `{ accuracy }` |
| `approach` | `point.triggers.onApproach` | `{ distance }` |
| `enter` | `point.triggers.onEnter` | `{ distance, accuracy, dwellMs, manual: boolean }` |
| `exit` | `point.triggers.onExit` | `{ distance }` |
| `completed` | — | `{ result }` |
| `out_of_order` | `triggers.onOutOfOrder` | `{ expectedPointId, actualPointId }` |
| `deviation` | `triggers.onDeviation` | `{ distanceToRoute, sinceMs }` |
| `back_on_track` | `triggers.onBackOnTrack` | `{ distanceToRoute }` |
| `idle` | `triggers.onIdle` | `{ idleSeconds }` |
| `timeout` | `triggers.onTimeout` | `{ elapsedMs, timeLimit }` |
| `paused` / `resumed` | — | `{ reason? }` |
| `cancelled` | `triggers.onCancel` | `{ reason }` |
| `finished` | `triggers.onFinish` | `{ summary: { elapsedMs, distanceMeters, completed, total, score } }` |
| `error` | — | `{ code: PositionSourceError['code'], message }` (si es `PERMISSION_DENIED`, el motor se pausa y `gps: 'denied'`) |

### 8.7 Persistencia y recuperación

- La app guarda `engine.serialize()` en IndexedDB en cada cambio relevante (con *throttle* de 2 s) y al pasar a segundo plano (`visibilitychange`).
- Al abrir la app, si hay un recorrido activo, se ofrece **"Continuar recorrido"**: `restoreGeoEngine` lo deja en pausa hasta que el usuario confirma.
- Si la ruta cambió (hash distinto), se ofrece empezar de nuevo.

### 8.8 Casos límite que el motor debe resolver

- Permiso de ubicación denegado o revocado a mitad de ruta → `error` y pausa.
- Interior de museo sin GPS → GPS débil prolongado. En modo libre se ofrece el **check-in manual** si la última posición válida está a menos de 3× el radio.
- El usuario arranca ya dentro del primer punto → permanencia y `enter` normales.
- Muestras duplicadas o desordenadas → se ignoran.
- Pestaña en segundo plano o pantalla bloqueada → sin muestras (`gps: 'lost'`). Al volver no se dispara una llegada con datos viejos.
- Cambio de hora del sistema → las duraciones usan `clock.monotonic()`.
- Zonas solapadas → advertencia al validar. El motor procesa la más cercana primero.

### 8.9 Precisiones de la implementación (fase 2)

Al construir el motor (`packages/geo-engine`) se concretaron estos puntos. Los valores están en `ENGINE_LIMITS`.

- **Saltos de GPS:** se ignoran como máximo 3 lecturas seguidas. Si la posición nueva persiste, se acepta (por ejemplo, el usuario subió a un autobús); si no, el usuario quedaría «congelado».
- **Hora del sistema atrasada:** una lectura más de 60 s anterior a la última se trata como cambio de hora y se acepta. Los retrocesos menores son lecturas tardías o duplicadas y se descartan.
- **GPS débil:** `gps` pasa a `'weak'` cuando se emite `gps_weak` (10 s seguidos con precisión mala). Débil y perdido avisan una sola vez por episodio, hasta la siguiente lectura buena.
- **Datos viejos:** los *ticks* solo confirman una llegada, un desvío o una inactividad con una lectura buena de hace ≤ 10 s (≤ 30 s para la inactividad). Al perder la señal se anulan las permanencias en curso.
- **`approach`:** solo se emite fuera de la zona, contando la histéresis. Dentro ya manda la llegada.
- **`exit`:** solo se emite al salir de una zona donde hubo `enter` en esa misma estancia. Pasar cerca de un punto no genera salidas.
- **Reto con puntos opcionales:** son alcanzables el siguiente punto pendiente y los opcionales anteriores al siguiente obligatorio. Los opcionales que se dejan atrás pasan a `locked`.
- **Distancia y traza:** la distancia crece en pasos de ≥ 10 m, así que el temblor del GPS estando quieto no suma. El tiempo en movimiento cuenta los tramos a ≥ 0,5 m/s. En pausa no se registra nada.
- **Eventos sin reentrada:** los eventos se encolan y se entregan al final de cada paso. Un oyente puede llamar a `complete()` dentro de `enter` sin romper la evaluación en curso.
- **Fuente simulada:** además de lo del §8.1, tiene `setTimeScale(1|5|20)` y `setWeakGps(on)`. Este último reporta 80 m de precisión y la vuelve no fiable, para que el motor aplique sus filtros reales; es el interruptor «GPS débil» de la demo.
- **Fuente del navegador:** acepta la geolocalización inyectada, lo que permite testearla sin navegador.

---

## 9. Módulo 3: Sistema de eventos (`@rumbo/event-system` + handlers en la web)

### 9.1 Responsabilidad

Recibe `EngineEvent` y:

1. Aplica el **feedback** del evento (vibración, sonido, notificación).
2. Si el evento trae `trigger`, busca `route.actions[trigger]`, encuentra el **handler** de `action.type` y lo ejecuta.
3. Interpreta el `HandlerResult` y **controla el motor**: `complete`, `pause`, `resume` o `cancel`.

El paquete no tiene UI. Los handlers v1 viven en él: validan sus `params` y piden a la app una vista por nombre (`ui.present('quiz', props)`). La web implementa el `UiAdapter` y un componente por vista (`apps/web/src/handlers/`).

### 9.2 Contrato de handlers

```ts
export interface ActionHandler<P = Record<string, unknown>> {
  type: string;                                  // 'ai_template', 'video', 'quiz'...
  paramsSchema?: ZodType<P>;                     // params inválidos → ficha de respaldo
  presentation?: 'blocking' | 'toast';           // por defecto; ActionDef.presentation manda
  load?: () => Promise<void>;                    // precarga diferida (p. ej. Three.js)
  run(params: P, ctx: HandlerContext): Promise<HandlerResult>;
}

export interface HandlerResult {
  status: 'done' | 'dismissed' | 'failed';
  decision?: 'continue' | 'pause' | 'cancel';    // para interrupciones y menús de la ficha
  score?: number;
  data?: unknown;
}

export interface HandlerContext {
  event: EngineEvent;
  route: NormalizedRouteSpec;
  point: NormalizedRoutePoint | null;
  action: ActionDef & { id: string };
  content: (ref: string) => Promise<LocalizedContent | null>;  // la ficha en todos sus idiomas
  ui: UiAdapter;
  feedback: FeedbackAdapter;
  analytics: (name: string, props?: Record<string, unknown>) => void;
  signal: AbortSignal;                           // se aborta si el recorrido se cancela
}

// El sistema de eventos nunca produce texto: pasa claves i18n (con parámetros) o
// textos de la ruta, y la UI los traduce con el idioma activo (ADR 0001).
export type UiText =
  | { key: string; params?: Record<string, string | number | LocalizedText> }
  | LocalizedText;

// Lo que devuelve una vista al cerrarse; `undefined` si se cerró sin responder.
export interface ViewOutcome {
  status?: 'done' | 'dismissed';
  decision?: 'continue' | 'pause' | 'cancel';
  data?: unknown;                                // p. ej. { answerIndex } del quiz
}

export interface UiAdapter {
  present<R = ViewOutcome>(view: string, props: Record<string, unknown>,
    opts?: { variant?: 'sheet' | 'modal' | 'fullscreen'; signal?: AbortSignal }): Promise<R | undefined>;
  toast(message: UiText, opts?: { icon?: string; durationMs?: number }): void;
  confirm(opts: { title: UiText; body?: UiText; confirmLabel: UiText; cancelLabel: UiText; destructive?: boolean }): Promise<boolean>;
  openExternal(url: string): void;
  navigate(to: 'summary'): void;                 // la app lo traduce a su router (/run/summary)
}

export interface FeedbackAdapter {
  vibrate(pattern: number[]): void;
  play(sound: 'approach' | 'arrive' | 'alert' | 'finish' | 'soft'): void;
  notify(n: { title: UiText; body: UiText; tag: string; url?: string }): void;  // solo si la app está en 2º plano
}

const events = createEventSystem({ engine, route, handlers: builtinHandlers, ui, feedback, content, analytics, logger });
events.start();   // se suscribe a engine.on('*') y vuelve a mostrar las fichas pendientes
events.stop();    // se desuscribe, aborta lo abierto y vacía la cola
```

### 9.3 Reglas del dispatcher

- **Cola:**
  - Las acciones `blocking` se ejecutan **de una en una** (FIFO). Las de tipo `toast` no bloquean.
  - Prioridad: `error` > interrupciones (`deviation`, `idle`, `out_of_order`, `timeout`) > contenido (`enter`).
  - Una interrupción no corta la ficha abierta: espera a que se cierre.
- **Deduplicación:** el mismo `trigger` + `pointId` no se encola dos veces.
- **Interrupciones obsoletas:** se descartan si el estado ya las resolvió (p. ej. llega `back_on_track` antes de mostrar `deviation`).
- **Sin trigger, comportamiento por defecto:**
  - `enter`: lo resuelve el motor (`autoCompleteWithoutAction`).
  - `approach` y `back_on_track`: toast (`run.approaching`, `run.backOnTrack`).
  - `deviation`, `idle`, `out_of_order` y `timeout`: handler `decision` con su preset.
  - `finished` y `cancelled`: navegar a `/run/summary`, después de la acción de `onFinish` u `onCancel` si la hay.
  - `error`: hoja de error con instrucciones.
- **Tras un `enter`:** se llama a `engine.complete(pointId, { score, data })` con cualquier resultado (`done` o `dismissed`).
- **Una acción que falla nunca bloquea la ruta:** si el handler falla (`failed` o excepción), se muestra `info_sheet` de respaldo con los datos del punto y se completa igualmente. El fallo se registra en analytics.
- **Decisiones:**
  - `continue` → `resume()` si estaba en pausa.
  - `pause` → `pause()`.
  - `cancel` → `ui.confirm` destructivo y, si se confirma, `cancel()`.
- **Cancelación:** se aborta el `signal` de los handlers en curso y se vacía la cola.
- **Fichas pendientes:** al arrancar (`start()`), los puntos `reached` con `onEnter` vuelven a mostrar su ficha. Es el caso de una recarga con la ficha abierta.

### 9.4 Feedback por defecto (sobrescribible con `ActionDef.feedback`)

| Evento | Vibración (solo Android) | Sonido | Notificación (solo con la app en 2º plano) |
|---|---|---|---|
| `approach` | `[80]` | `approach` | No |
| `enter` | `[200, 100, 200]` | `arrive` | "📍 Llegaste a {punto}" |
| `out_of_order` | `[100, 50, 100]` | `alert` | "Este no es el siguiente punto" |
| `deviation` | `[300]` | `alert` | "Te alejaste de la ruta" |
| `idle` | `[150]` | `soft` | "¿Sigues en la ruta?" |
| `timeout` | `[300, 100, 300]` | `alert` | "Se acabó el tiempo" |
| `finished` | `[100, 50, 100, 50, 300]` | `finish` | "🏁 ¡Ruta completada!" |
| `gps_weak` | — | — | No (indicador en la UI) |

Los textos de esta tabla son la referencia en español. En el código, cada notificación es una clave i18n (`notify.arrive`, `notify.deviation`…) que se traduce al idioma activo en el momento del aviso.

### 9.5 Handlers v1

| `type` | Para qué | `params` (Zod) |
|---|---|---|
| `info_sheet` | Ficha estática (respaldo universal) | `{ contentRef?, title?, body?, image? }` |
| `ai_template` | Ficha generativa (rutas de usuario) | `{ contentRef }` → pinta `PointContent` y puntúa su `quiz` (10 puntos, §6.4) |
| `video` | Video del lugar | `{ provider: 'youtube' \| 'file', id?, url?, title? }` |
| `quiz` | Pregunta con puntos | `{ question, options: string[], correctIndex, points, explanation? }` |
| `redirect` | Web externa (con confirmación) | `{ url, label }` |
| `toast` | Aviso breve no bloqueante | `{ messageKey \| message, icon?, durationMs? }` |
| `decision` | Interrupciones: Continuar / Pausar / Terminar | `{ preset: 'deviation' \| 'idle' \| 'out_of_order' \| 'timeout' } \| { title, body?, primaryLabel? }` |
| `three_scene` | *(Futuro)* Escena Three.js | Stub en v1, registrado con `load()` diferido |
| `ar_scene` | *(Futuro)* RA (WebXR / model-viewer) | No se implementa en v1 |

**Acciones personalizadas en 3 idiomas:** los textos de los `params` son `LocalizedText`. Eso incluye la pregunta, las opciones y la explicación del quiz; el `label` del redirect; el `title` y el `body` de `info_sheet`; y el `message` del toast. Así, una acción escrita por nosotros (no por la IA) puede traer español, inglés y portugués, y el handler muestra el idioma activo.

**Esquemas compartidos:** los esquemas de `params` de `info_sheet`, `ai_template` y `decision`, y la lista `INTERRUPTIONS`, se definen en `route-spec` (`src/actions.ts`). Los handlers de este paquete los importan de ahí (y este paquete reexporta `INTERRUPTIONS`). La API los usa para validar las rutas de usuario (§11.3), así que hay una sola definición.

**Añadir un tipo nuevo** consiste en escribir su `ActionHandler` (con su `paramsSchema`), pasarlo en `handlers` y crear en la web el componente de su vista. **El motor no se toca.**

### 9.6 Flujo de una llegada

```
GPS ─► motor: muestra aceptada → dentro del radio → permanencia 5 s ─► evento enter { trigger: "castelo_ficha" }
   ─► event-system: feedback (vibra/suena/notifica) → acción "castelo_ficha" → handler ai_template
   ─► UI: hoja con la ficha → el usuario pulsa "Continuar ruta" → HandlerResult { status: 'done' }
   ─► event-system: engine.complete("castelo") ─► motor: completed → (reto) activa el siguiente punto → nuevo estado
```

### 9.7 Precisiones de la implementación (fase 3)

Al construir `packages/event-system` se concretaron estos puntos.

- **Handlers sin UI:** los 8 handlers v1 (`builtinHandlers`) validan sus `params` con Zod y piden vistas por nombre:
  - `info_sheet`, `ai_template`, `video`, `quiz` y `decision` (hojas);
  - `coming_soon` (pantalla completa, para `three_scene`);
  - `error` (hoja con el `code` del error);
  - `redirect` solo usa `confirm` y `openExternal`, y `toast` solo usa `toast`.

  Así la lógica se prueba sin navegador.
- **Contenido en todos los idiomas:** `content(ref)` devuelve `LocalizedContent` y la vista elige el idioma activo con `resolveContent`. Si el usuario cambia de idioma con la ficha abierta, la ficha cambia sin cerrarse.
- **Claves i18n:** todas las que el paquete entrega a la UI están en `UI_TEXT_KEYS`. Un test comprueba que el código no usa ninguna otra, y los catálogos de la web deberán tenerlas todas (`docs/DESIGN.md` §11).
- **Cola:**
  - Niveles: error > interrupción > contenido > navegación al resumen, y FIFO dentro de cada nivel.
  - La deduplicación usa `acción|punto`; los errores se deduplican por código.
- **Obsolescencia:** se comprueba justo antes de mostrar cada elemento.
  - `deviation`: se descarta si ya no hay `offRoute`.
  - `idle`: se descarta si ya no hay `idle`.
  - `out_of_order`: se descarta si el usuario salió de esa zona (radio + histéresis).
  - Una ficha: se descarta si su punto ya no está `reached`.
  - Si el recorrido terminó, se descarta todo menos la navegación.
- **Fichas pendientes tras recargar:** el motor restaurado conserva los puntos `reached`, pero la ficha se perdió con la pestaña. `start()` las vuelve a encolar, sin repetir vibración ni notificación. Sin esto, el punto quedaría `reached` para siempre y la ruta no podría terminar.
- **Cancelación y `stop()`:** abortan el `signal` de la acción abierta (la vista debe cerrarse) y vacían la cola. Una ficha abortada no completa su punto, que queda `reached` para volver a mostrarse.
- **Respaldo:**
  - Si la acción de un `enter` falla, se muestra `info_sheet` con el nombre del punto y el punto se completa.
    - Cuenta como fallo una excepción, un resultado `failed`, unos `params` inválidos o un tipo sin handler.
    - El fallo queda en analytics: `error` con `action_failed` y `point_completed` con `status: 'failed'`.
  - Si también falla el respaldo, el punto se completa igual.
  - Una interrupción que falla se registra y la cola sigue.
  - Un `trigger` sin acción (la validación lo impide) muestra la ficha básica en un `enter` y la acción por defecto en el resto.
- **Toasts:** se ejecutan al momento, sin pasar por la cola. Un `enter` cuya acción es un toast completa el punto en cuanto se muestra.
- **Notificaciones:**
  - `tag` es `<evento>:<punto o ruta>`, así que una notificación reemplaza a la anterior del mismo tipo.
  - `url` es `/run?point=<id>` para abrir la ficha al tocarla.
  - Si una acción activa `notify` en un evento sin notificación por defecto, se usa `notify.generic`.
- **Analytics** (nunca con coordenadas):
  - `run_started`, `run_paused`, `run_resumed`, `run_cancelled` y `run_finished`;
  - `point_reached` y `point_completed` (con `handlerType`, `status` y `ms`), este último solo si el motor completó el punto;
  - `interruption_shown`, `decision_made`, `gps_weak` y `error`.
- **Rutas curadas:** `pnpm validate:routes` usa `BUILTIN_ACTION_TYPES` y `validateActionParams`. Un quiz mal escrito falla en CI, no en la calle.

---

## 10. Frontend: PWA headless (`apps/web`)

### 10.1 Estructura

```
src/
├─ main.ts, App.vue
├─ router/                  # rutas (abajo)
├─ stores/                  # Pinia: catalog, run, creator, settings, device
├─ services/                # api (cliente tipado con api-contract), geo (búsqueda de lugares),
│                           # ai, content, suggest (fichas y sugerencias de la IA),
│                           # myRoutes (rutas del usuario: registro local y subida), contentCache (IndexedDB),
│                           # catalog (descarga y fotos sin conexión), analytics, notifications, wakeLock, audio,
│                           # permissions, installPrompt
├─ map/                     # RouteMap.vue (envuelve <arcgis-map>) + capas, symbols.ts, popup.ts, basemap.ts
├─ engine/                  # useGeoEngine.ts: motor + fuentes + persistencia de snapshots
├─ events/                  # setupEventSystem.ts, uiAdapter.ts, feedbackAdapter.ts
├─ handlers/                # vistas de los handlers: info-sheet, ai-template, video, quiz, decision, coming-soon, error
├─ views/                   # Onboarding, Home, MyRoutes, RouteDetail, RunPrepare, Run, RunSummary,
│                           # create/(Layout, Details, Places, Content, Review, Done), Settings
├─ components/              # BottomSheet, RouteCard, ModeBadge, StatChip, PointListItem, HudTarget,
│                           # ProgressBar, DecisionSheet, Stepper, PlaceSearch, InterestChips, SuggestSheet,
│                           # GpsIndicator, MiniRunBar...
├─ styles/                  # tokens.css (de DESIGN.md), base.css
├─ i18n/                    # es.json, en.json, pt.json (vue-i18n) y useLocale()
└─ sw.ts                    # service worker (injectManifest): precache, caché en tiempo de ejecución, notificationclick
```

### 10.2 Rutas (coinciden con `docs/DESIGN.md`)

| Ruta | Vista |
|---|---|
| `/welcome` | Idioma (S00): solo en el primer arranque. Después el idioma se cambia en `/settings` |
| `/onboarding` | Onboarding (primera vez) |
| `/` | Inicio, pestaña Explorar (lista o mapa) |
| `/my-routes` | Mis rutas: las del usuario, con su estado de subida; editar y eliminar |
| `/routes/:routeId` | Detalle de ruta |
| `/routes/:routeId/prepare` | Preparación y permisos |
| `/run` | Recorrido en curso (una ruta activa a la vez). Acepta `?point=<id>` desde una notificación |
| `/run/summary` | Resumen del último recorrido |
| `/create/details` → `/create/places` → `/create/content` → `/create/review` → `/create/done` | Wizard del creador, sin navegación inferior. `/create` retoma el borrador en el primer paso con algo pendiente. `/create/content` es el paso Fichas, entre Lugares y Revisar. Una ruta se edita desde Mis rutas, que la carga en el borrador y abre `/create/details` |
| `/settings` | Ajustes |

Las hojas de llegada y de decisión **no son rutas**: forman una pila de overlays gestionada por el `UiAdapter`. El botón atrás del sistema cierra la hoja superior; en `/run`, pide confirmar antes de salir de la pantalla, y la ruta sigue activa.

### 10.3 Mapa (ArcGIS)

- **SDK:** ArcGIS Maps SDK for JavaScript 5.1. En la 5.0 Esri marcó los *widgets* (Popup, Attribution…) como obsoletos en favor de los componentes web, así que el mapa usa el componente `<arcgis-map>` de `@arcgis/map-components`, y las capas y gráficos son clases de `@arcgis/core` (`GraphicsLayer`, `Graphic`, símbolos). Todo va encapsulado en `RouteMap.vue` (no `ArcgisMap.vue`: Vue leería `<arcgis-map>` como el componente llamándose a sí mismo), y el resto de la app no toca el SDK.
- **API key:** `esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY`. Clave **restringida por referrer** (dominios de la app + localhost) y limitada a los servicios de mapa base. La geocodificación va por el backend con otra clave.
  - **Sin clave**, el mapa usa las teselas públicas de ArcGIS Online (`World_Street_Map`, `World_Topo_Map` y `World_Dark_Gray`), las mismas de los mockups. Con clave, los estilos vectoriales (`arcgis/navigation`, `arcgis/topographic` y `arcgis/navigation-night`).
- **Coste:** la capa gratuita de ArcGIS Location Platform incluye 2 millones de teselas de mapa base al mes, de sobra para el curso. **No activar pay-as-you-go** mientras no haga falta: sin él, al agotar la cuota los servicios se bloquean hasta el siguiente ciclo y no hay cargos; con él, Esri no ofrece tope de gasto. Si el producto crece, comparar el cobro por teselas con el de *basemap sessions* u otro proveedor de teselas (el mapa está encapsulado, así que cambiarlo es barato).
- **Mapa base:** configurable. Calles o navegación para ciudad, topográfico para naturaleza o bici, y una variante oscura para el modo oscuro. **La atribución de Esri debe quedar siempre visible.**
- **Capas:**
  - `points`: un `Graphic` por punto, con atributos (id, nombre, orden, categoría, estado, distancia) y un símbolo según estado + categoría (`symbols.ts`, especificado en DESIGN.md). Se actualizan **solo los gráficos que cambian**.
  - `path`: polilínea discontinua del trazado.
  - `track`: polilínea del recorrido real, actualizada cada ≤ 3 s.
  - `user`: punto propio + círculo de precisión + cono de rumbo. Si la fuente es simulada, se dibuja en morado con la etiqueta "SIM".
  - `zones` *(creador)*: un círculo de radio por lugar, por debajo del resto. Los que se solapan con otro se dibujan en ámbar (tono `warning`) y su marcador lleva un aro y una insignia «!». Detalles en el §7.1.
- **Popup (requisito del curso):** `PopupTemplate` con título, imagen, categoría, estado, orden y distancia. En modo libre añade la acción **"Ir a este punto"** (`setTarget`).
- **Filtro (stretch):** por ruta, categoría, modo y estado, alternando `graphic.visible`.
- **Idioma:** al cambiar de idioma se llama a `intl.setLocale()` del SDK, para los controles y popups de ArcGIS. El contenido de los popups se genera con el idioma activo.
- **Cámara:** modo seguir activado durante el recorrido. Si el usuario arrastra el mapa, se desactiva y aparece el botón **Recentrar**.
- **Rendimiento:** el SDK de ArcGIS es pesado, así que va con *code-splitting* en las vistas con mapa y se precarga mientras el usuario está en Inicio. El estado del motor llega al mapa como mucho una vez por frame (`requestAnimationFrame`).

### 10.4 Pantalla de Explorar como mapa (requisito de 20+ marcadores)

La vista **Mapa** de Inicio muestra **todos los puntos de todas las rutas curadas** (más de 20), y también los de las rutas que creaste en este dispositivo, con iconos por categoría, color por ruta, popup y panel de filtros. Esto cubre los requisitos del curso en una sola vista; cada detalle de ruta muestra además sus propios puntos.

### 10.5 Capacidades del navegador (lo que funciona de verdad)

| Capacidad | Android (Chrome) | iOS (Safari) | Implementación |
|---|---|---|---|
| Geolocalización en primer plano | ✅ | ✅ | `watchPosition` (HTTPS obligatorio) |
| Geolocalización con la pantalla bloqueada | ❌ | ❌ | Imposible en la web: hay que mantener la pantalla encendida |
| Mantener la pantalla encendida | ✅ | ✅ (versiones recientes) | Screen Wake Lock API; se vuelve a pedir en cada `visibilitychange` |
| Vibración | ✅ | ❌ | `navigator.vibrate` con detección de soporte |
| Sonido | ✅ | ✅ | Web Audio, desbloqueado con el toque en "Empezar" |
| Notificación local | ✅ | ✅ solo con la **PWA instalada** (iOS 16.4+) | `registration.showNotification()` cuando `document.hidden` |
| Web Push desde el servidor | ✅ | ✅ solo PWA instalada | **Futuro** (recordatorios). No sirve para llegadas porque requiere ubicación en segundo plano |

- En iOS hay que guiar al usuario para **instalar la PWA** (Compartir → "Añadir a pantalla de inicio") antes de ofrecer notificaciones.
- Para geocercas reales en segundo plano, la vía futura es un wrapper nativo (Capacitor), no la web.

### 10.6 Offline y caché

- **Precache:** la app shell y los tres catálogos de idioma (Workbox).
- **Al pulsar Iniciar:**
  - El bundle de la ruta, con todos sus idiomas, va a IndexedDB.
  - Las imágenes del contenido van a Cache Storage: se piden como imagen con CORS para que el service worker las guarde (§10.10).
  - La UI muestra "Disponible sin conexión ✓".
- **Caché en tiempo de ejecución:**
  - `GET /api/v1/routes*` → *NetworkFirst*.
  - Imágenes → *CacheFirst* con expiración.
  - Assets del SDK de ArcGIS → servidos desde el propio bundle.
- **Teselas del mapa base:** no se cachean de forma agresiva (términos de uso y tamaño). Sin red se muestra un fondo neutro con los puntos y la traza.
- **Implementación (fase 4):** ver §10.9.

### 10.7 Modo simulación / demo

- **Cómo se activa:** en Ajustes (Modo demo), con `?sim=1` o automáticamente en desarrollo.
- **Controles:**
  - Tocar el mapa para teletransportarse.
  - "Caminar al siguiente punto" a 1×, 5× o 20×.
  - Interruptor de "GPS débil".
- **Señalización:** banner morado "Modo simulación" y punto de usuario morado.
- **Usos:** el video del curso, «Probar ruta» del creador y los tests e2e.
- **Probar ruta** fuerza la simulación aunque Ajustes diga otra cosa, y es una prueba aislada: sin snapshot, sin resumen, sin llamadas a la API ni analytics (§7.1).

### 10.8 Identidad anónima del dispositivo

- `deviceId`: UUID aleatorio generado en el primer arranque y guardado en IndexedDB.
- Se envía como `X-Device-Id`. **No es autenticación**: sirve para la propiedad provisional de las rutas (el dispositivo que hace el POST es su dueño, y cuenta para la cuota de 50 rutas) y para algunos límites. Los límites estrictos van por IP, porque este identificador lo elige el cliente.
- El `editToken` **lo genera el dispositivo** al crear la ruta: 32 bytes aleatorios (`crypto`) en base64url, 43 caracteres. Se guarda en IndexedDB junto a la ruta y no se muestra nunca.
  - Se envía como `X-Edit-Token` en el POST, el PUT y el DELETE. La API también lo exige para leer la ruta, aunque la web de la fase 6 no la lee de la API: usa su copia local. El servidor guarda solo su hash SHA-256 (§11.3).
  - Al generarlo el cliente, la ruta se puede crear sin conexión, y un `201` perdido no deja una ruta huérfana: repetir el POST con el mismo token la actualiza ([ADR 0002](adr/0002-rutas-de-usuario.md)).
  - Borrar los datos locales borra también los tokens. Antes, la app intenta eliminar del servidor las rutas ya subidas (§7.1); las que no consiga borrar quedan allí sin que nadie pueda editarlas ni borrarlas, aunque siguen siendo privadas.

### 10.9 Precisiones de la implementación (fase 4)

Al construir `apps/web` se concretaron estos puntos.

- **Mapa (`RouteMap.vue`):**
  - Un `Graphic` por marcador, con su símbolo en SVG generado desde los iconos de Lucide (todos los estados × categorías de DESIGN §6.1, en caché). Solo se actualizan los gráficos que cambian.
  - **Popup:** el del SDK, sin acoplar en móvil (`dockOptions.breakpoint: false`), con nuestra tarjeta como contenido. El SDK pinta el contenido dentro de un *shadow root*, así que la tarjeta lleva su propio CSS; los tokens (variables CSS) sí lo atraviesan. Al abrirse, el mapa se desplaza para que el popup quepa encima del marcador.
  - **Atribución:** la dibujamos nosotros con los mismos datos del SDK (`view.attributionItems` y «Powered by Esri»), porque la suya queda pegada al borde inferior, bajo las hojas. La nuestra sube por encima (`--attribution-offset`).
  - **Sin red:** el mapa se crea con Web Mercator y los niveles de zoom estándar de Esri (`TileInfo.create().lods`). Así, aunque el mapa base no cargue, se ven los puntos y la traza sobre fondo neutro.
  - **Accesibilidad:** una lista oculta de los marcadores, que aparece al recibir el foco, abre cada popup desde el teclado (DESIGN §12).
- **Explorar y los 20+ marcadores:** opción A de la sección 15.
  - Explorar muestra los 12 puntos de la ruta y 25 lugares de interés de Wikidata: 37 marcadores, en dos tipos (punto de ruta con su color, lugar de interés en blanco).
  - Los lugares salen de `data/pois/leiria.json`, que genera `pnpm data:pois` (Wikidata, CC0; fotos de Wikimedia Commons con autor y licencia).
  - `pnpm validate:routes` los valida y avisa si un lugar queda a menos de 30 m de un punto de ruta (los marcadores se taparían).
- **Rutas:** se piden a la API (`GET /api/v1/routes`) y, si no responde, se usan las de `data/routes`, que van dentro de la app y siempre funcionan sin conexión. En la fase 5 basta con que exista el endpoint.
- **Recorrido (`stores/run.ts`):**
  - El motor con GPS real o simulado (en simulación, el usuario empieza 150 m antes del primer punto).
  - El sistema de eventos conectado a la pila de hojas (`stores/ui.ts`), al feedback del dispositivo y a analytics.
  - El estado llega a la interfaz como mucho una vez por frame.
  - Se guarda una instantánea cada 2 s y al pasar a segundo plano. Al reabrir, S11 ofrece continuar: el motor vuelve en pausa y el sistema de eventos repite las fichas pendientes.
  - El resumen se construye con el estado del propio evento `finished` o `cancelled`, porque el motor publica el nuevo estado justo después.
- **Vistas de los handlers:** `handlers/registry.ts` asocia cada vista que pide el sistema de eventos (`info_sheet`, `quiz`, `decision`…) con su componente. La ficha recibe el contenido en todos sus idiomas y elige el activo.
- **PWA (`src/sw.ts`, Workbox con `injectManifest`):**
  - Se precachea solo la carcasa de la app: unos 1,9 MB, que incluyen el núcleo del mapa.
  - El resto del SDK (más de mil archivos) se compila en `assets/sdk/` y se guarda en caché cuando se usa.
  - Lo que se cargó antes de que el *service worker* tomara el control, la página se lo pasa al tomar el control, para tenerlo sin conexión.
  - Las fotos y los recursos del CDN de Esri se cachean con caducidad. La API de rutas va con red primero.
  - Al tocar una notificación, la app navega sin recargarse, así que el recorrido en memoria sigue.
- **Fuentes:** solo el subconjunto latino de Inter y Fraunces (cubre es, en y pt), para no hinchar el precache.
- **Tests:**
  - 33 unitarios (Vitest + happy-dom): paridad de los catálogos (claves, parámetros, plurales y claves del sistema de eventos), formatos, textos, ajustes, catálogo, marcadores, símbolos y la pila de hojas.
  - 7 e2e (Playwright, sobre la build de producción): los escenarios de 14.2. Usan el modo simulación y el reloj de Playwright para que los paseos sean rápidos y deterministas; las rutas de reto son *fixtures* servidas simulando la API.
  - Las pruebas del recorrido no cargan el SDK del mapa: en la CI se pinta por software y, con el reloj acelerado, alarga mucho los paseos. El mapa tiene su propia prueba. Por lo mismo, los botones de simulación y recentrar están fuera del componente del mapa: la simulación funciona aunque el mapa no cargue.

### 10.10 Precisiones de la implementación (fase 7)

Al construir la llegada con trivia y las fotos sin conexión se concretaron estos puntos. El creador está en el §7.2 y el servidor en el §12.

- **Trivia en la ficha** (`handlers/ContentSheet.vue`): solo aparece si la ficha trae `quiz`, entre el consejo y las fuentes.
  - Un `h2` «Pregunta rápida», la pregunta y un grupo etiquetado por ella con un `<button>` nativo por opción (48 px como mínimo; las opciones largas saltan de línea).
  - **Un solo intento:** tras la primera pulsación, todas las opciones quedan `disabled`. La correcta lleva un icono de visto y la elegida, si falla, una cruz: la forma acompaña al color, y el texto del veredicto lo repite.
  - Una región `role="status"` siempre está en el DOM, vacía hasta responder, para que el veredicto se anuncie. Acierto: «¡Correcto! +10 pts». Fallo: «No es esa. La correcta: …». Después, la explicación, si la hay.
  - Al responder, la hoja se desplaza para que el veredicto se vea (suave, salvo con movimiento reducido), porque la ficha crece por debajo.
- **Resultado:** al cerrar con Continuar, Pausar o Terminar, la vista devuelve `{ status: 'done', decision?, data?: { answerIndex, locale } }`. `data` solo va si se respondió, y `locale` es el de la pregunta mostrada. El `ai_template` real da `score` 10 (acierto), 0 (fallo) y nada (sin responder), y conserva la decisión de Pausar o Terminar junto a la puntuación (hay un test de contrato con el handler real).
- **Cambio de idioma con la hoja abierta:** la respuesta pertenece a la pregunta para la que se dio. Si el cambio trae otra ficha con su propio `quiz`, empieza sin responder; si se queda la misma (respaldo de idioma), la respuesta se queda y el veredicto se vuelve a traducir.
- **Vista previa** (`preview`): la usa el creador (§7.2). Sin la etiqueta «LLEGASTE» y con un solo botón «Cerrar» que cierra sin resultado. La trivia funciona en local y no se puntúa ni se registra nada.
- **Fotos sin conexión:** `routeImageUrls(bundle)` reúne la portada, las imágenes de las fichas en todos los idiomas y la de los `info_sheet` (solo http y https, sin repetir y 60 como máximo). `prefetchImages` las pide 4 a la vez, con 8 s por foto y 15 s de espera en total (el resto sigue cargando en segundo plano), y nunca falla. `PrepareView` lo llama al terminar `catalog.download`, y la descarga cuenta como lista después, así que «Empezar» espera 15 s como mucho.
  - **Por qué un `Image` con `crossOrigin = 'anonymous'`** (medido en Chrome contra el `sw.js` compilado): la ruta de imágenes del service worker solo atiende `request.destination === 'image'`, así que un `fetch()` nunca se guarda. `CacheFirst` de Workbox no guarda respuestas opacas, y un `<img>` normal entre orígenes recibe una, así que las fotos que solo se vieron en línea no se cachean. Una respuesta CORS (200) sí se guarda en `rumbo-images`, y después un `<img>` normal la carga de esa copia aunque el servidor de fotos no responda.
  - Wikimedia contesta `access-control-allow-origin: *` y no usa `Vary: Origin`.
- **Límites conocidos:**
  - Cerrar la hoja con el gesto de deslizar o con Escape después de responder no puntúa: `OverlayHost` la cierra sin pedirle su resultado (`{ status: 'dismissed' }`). Le pasa igual a `QuizSheet`.
  - El veredicto escribe «+10 pts» siempre que la ficha tenga `quiz`, pero solo `ai_template` puntúa. Un `info_sheet` que apuntara a una ficha con `quiz` enseñaría puntos sin sumarlos (hoy no existe ninguno).
  - Playwright corre con `serviceWorkers: 'block'`, así que la caché de fotos sin conexión no se comprueba en los e2e. Si una ruta de e2e lleva fotos de `upload.wikimedia.org`, hay que servirlas con un PNG para que `PrepareView` no espere a la red.
  - Solo se ha verificado en Chrome. En Safari/iOS (el objetivo principal de la PWA) debería funcionar igual, porque el Fetch estándar deja que una respuesta CORS del service worker conteste a un `<img>` sin CORS, pero no se ha probado.
  - Las fotos que se ven en línea sin pasar por `PrepareView` (los popups de Explorar) no se cachean. Poner `crossorigin` en esos `<img>` lo arreglaría, pero rompería los servidores de fotos sin CORS.
- **Tests:** 23 de la trivia (estructura, acierto, fallo, un solo intento, resultado, idioma, vista previa y el contrato con el handler real) y 12 de las fotos (`routeImageUrls`, `prefetchImages` y `PrepareView` de punta a punta).

---

## 11. Backend (`apps/api`) en el VPS

### 11.1 Endpoints v1 (`/api/v1`, OpenAPI generado en `/api/v1/docs`)

- **Mismo origen que la web** (`https://rumbo.arturoocampo.com/api`): no hace falta CORS.
- **Idioma:** el cliente envía `Accept-Language` con el idioma activo.
- **Errores:** devuelven un código (`{ code }`) que traduce el cliente, nunca texto para mostrar.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado y versión |
| GET | `/routes?mode=&activity=&q=&near=lat,lng` | Lista de `RouteSummary` de las rutas **curadas**. Las de usuario no se listan nunca |
| GET | `/routes/:id` | `RouteBundle` (spec + contents). Una ruta de usuario solo responde con su `X-Edit-Token`; sin él, `404 route_not_found` |
| POST | `/routes` | Crea una ruta de usuario a partir de un `RouteBundle` (cabeceras `X-Edit-Token` y `X-Device-Id`) → `201 { id, updatedAt }`. Es idempotente para su dueño: repetido con el mismo token, la actualiza y responde `200` |
| PUT | `/routes/:id` | Reemplaza la ruta (cabecera `X-Edit-Token`) → `200 { id, updatedAt }` |
| DELETE | `/routes/:id` | Borra la ruta con sus fichas y recorridos (cabecera `X-Edit-Token`) → `204` |
| GET | `/geo/suggest?q=&near=&kind=&limit=` | Sugerencias de lugares (`kind=place`, por defecto) o de ciudades y zonas (`kind=area`) mientras se escribe |
| GET | `/geo/resolve?key=` | Lugar resuelto de una sugerencia, con su dirección |
| POST | `/content/generate` | Genera con IA la ficha de un lugar (un `PointContent` sin `id`), en el `locale` pedido (obligatorio). Necesita `X-Device-Id` |
| POST | `/suggest/places` | Sugiere lugares reales cerca de un punto, para un tiempo, una actividad y unos intereses, en el `locale` pedido. Necesita `X-Device-Id` |
| POST | `/runs` | Inicio de recorrido → `{ runId }` |
| PATCH | `/runs/:runId` | Cierre: estado final + resumen |
| POST | `/analytics/batch` | Lote de eventos anónimos → `202` |

```ts
// @rumbo/api-contract
export interface RouteSummary {
  id: string; name: LocalizedText; summary?: LocalizedText;
  mode: RouteMode; activity: Activity; source: RouteSource;
  locale: Locale; locales: Locale[];   // idioma de origen e idiomas con contenido completo
  coverImage?: MediaRef;
  pointCount: number; distanceMeters: number; estimatedMinutes: number;
  centroid: LatLng; bbox: [number, number, number, number];
  updatedAt: string;
}
```

**Rutas de usuario y búsqueda de lugares (fase 6).** Lo que hace cada endpoint, tal como está implementado:

- **Cabeceras:** el POST necesita `X-Edit-Token` y `X-Device-Id` (el dispositivo que crea la ruta es su dueño). PUT, DELETE y la lectura de una ruta de usuario solo necesitan `X-Edit-Token`. Un token ausente o mal formado (no son 43 caracteres base64url) es `401 missing_edit_token`.
- **Cuerpo de POST y PUT:** `{ spec, contents? }`, hasta 128 KiB. El esquema del cuerpo solo comprueba ese sobre: cualquier problema de la ruta es un `422 invalid_route` con `details` (hasta 20 `{ path, message }`).
- **Orden de comprobaciones:** límite por IP (429) → token (401) → dispositivo, solo en el POST (400 `missing_device_id`) → tamaño (413) → sobre (400) → base de datos lista (503) → validación de la ruta (422 `invalid_route`) → fichas verificadas (422 `unverified_content`, fase 7) → cuotas (409 o 503) → escritura. Se autentica antes de leer el cuerpo.
- **POST:** `201` la primera vez. Si el id ya existe y el token coincide, actualiza la ruta y responde `200` (el dueño sigue siendo el dispositivo original, aunque el reintento lleve otro `X-Device-Id`). Si el id es de otro token o de una ruta curada: `409 route_exists`. Dos POST idénticos a la vez dan un `201` y un `200`.
- **PUT:** `404 route_not_found` si no existe; `403 forbidden` si la ruta es curada o el token es otro; `400 route_id_mismatch` si `spec.id` no es el de la URL (se comprueba después de los dos anteriores). Reemplaza el spec, las columnas del listado, `updatedAt` y las fichas.
- **DELETE:** los mismos 404 y 403. Borra de verdad la fila, sus fichas y sus recorridos (cascada). Un PUT o un DELETE posterior responde `404`.
- **Lectura de una ruta de usuario:** `GET /routes/:id` con su token responde `200` con `cache-control: private, no-store` (y `304` si `If-None-Match` coincide). Sin token, con uno mal formado o con otro: `404 route_not_found`, igual que si el id no existiera. Se decide antes del `ETag`, porque un `304` confirmaría que la ruta existe. Las rutas curadas siguen siendo públicas, con `ETag` y `304`.
- **`GET /geo/suggest`:** `q` (2 a 80 caracteres), `near` (`lat,lng`, que el servidor redondea a 3 decimales, unos 110 m), `kind` (`place` por defecto, o `area`) y `limit` (de 1 a 10; 8 por defecto). El idioma sale de `Accept-Language`: la primera etiqueta que sea es, en o pt, y si no, es. Una consulta sin ninguna palabra de 2 letras o cifras responde `200 []` sin consultar a Wikidata.
- **`GET /geo/resolve`:** `key` es la de una sugerencia (de 3 a 300 caracteres). Devuelve el lugar con su dirección, si se conoce, o `404 place_not_found`.
- **Caché de `/geo`:** las respuestas correctas llevan `cache-control: private, max-age=300` y `Vary: Accept-Language`, porque dependen de la posición y del idioma. Todos los errores de la API llevan `no-store`.

```ts
// @rumbo/api-contract
export interface GeoSuggestion {
  key: string;                       // opaca, para /geo/resolve: 'wikidata:Q2969701'
  name: string;                      // ≤ 80
  description?: string;              // ≤ 200
  position: LatLng;
  category?: PointCategory;          // solo en kind=place
  externalId?: string;               // QID de Wikidata
  distanceMeters?: number;           // solo en kind=place y con near
  storable: boolean;                 // false: solo puede mover el mapa, nunca guardarse en una ruta
}
export interface ResolvedPlace {     // GET /geo/resolve
  key: string; name: string; address?: string; position: LatLng;
  category?: PointCategory; externalId?: string; storable: boolean;
}
```

`storable` es `true` en todo lo que devuelve Wikidata; solo será `false` en las direcciones de ArcGIS (§12.3).

**Códigos de error nuevos.** Las respuestas son siempre `{ code, details? }` y el cliente decide por `code`, no por el estado: un 409 puede ser `route_exists` o `quota_exceeded`, y un 503, `unavailable` (sin base de datos, o con `USER_ROUTES_MAX` rutas de usuario) o `geocoding_unavailable`.

| Código | Estado | Cuándo |
|---|---|---|
| `missing_edit_token` | 401 | Falta `X-Edit-Token` o no son 43 caracteres base64url |
| `forbidden` | 403 | El token no es el de la ruta, o la ruta es curada (el código ya existía: también cierra un recorrido ajeno) |
| `route_exists` | 409 | El id de un POST es de otro token o de una ruta curada |
| `quota_exceeded` | 409 | El dispositivo ya tiene 50 rutas de usuario en el servidor |
| `route_id_mismatch` | 400 | En un PUT, `spec.id` no es el de la URL |
| `invalid_route` | 422 | La ruta no pasa `validateRouteBundle` ni `checkUserRoute`, o lleva un valor que Postgres no puede guardar. Incluye `details` |
| `place_not_found` | 404 | `GET /geo/resolve` con una clave que no existe o de un lugar sin coordenadas |
| `geocoding_failed` | 502 | Wikidata no respondió bien: 6 s agotados, error de red o respuesta no válida o demasiado grande |
| `geocoding_unavailable` | 503 | La búsqueda está apagada (`GEOCODING_PROVIDER=none`) o en pausa porque Wikimedia pidió esperar |

**Guía con IA (fase 7).** Dos endpoints que necesitan `X-Device-Id` (si falta, `400 missing_device_id`). El idioma va en el cuerpo (`locale`), no en `Accept-Language`. El detalle de lo que hacen por dentro está en el §12.

```ts
// @rumbo/api-contract
export const INTERESTS = ['history', 'art', 'architecture', 'food', 'nature', 'religion', 'curiosities'] as const;

export interface ContentGenerateBody {   // POST /content/generate
  name: string;                      // ≤ 80
  position: LatLng;
  locale: Locale;                    // obligatorio
  category?: PointCategory;
  externalId?: string;               // QID de Wikidata, si el lugar salió de la búsqueda o de una sugerencia
  interests?: Interest[];            // hasta 7
  custom?: boolean;                  // punto propio del usuario (hoy decide `externalId`, no este campo)
  fresh?: boolean;                   // «Regenerar»: se salta la caché y gasta una generación
}
export interface ContentGenerateResponse {
  content: Omit<PointContent, 'id'>; // el cliente le pone como `id` el `contentRef` del lugar
  grounding: 'wikipedia' | 'web' | 'none';
  cached: boolean;                   // true: salió de la caché del servidor y no costó nada
}

export interface SuggestPlacesBody { // POST /suggest/places
  near: LatLng;                      // el servidor lo redondea a 3 decimales
  locale: Locale;
  interests?: Interest[];
  minutes: number;                   // de 30 a 480
  activity: Activity;
  exclude?: string[];                // QIDs que la ruta ya tiene (hasta 30)
}
export interface SuggestedPlace extends GeoSuggestion {
  externalId: string;                // siempre un QID
  teaser: string;                    // ≤ 160: por qué ir, nunca qué vas a aprender
}
export interface SuggestPlacesResponse {
  title: string;                     // ≤ 80
  summary: string;                   // ≤ 280
  places: SuggestedPlace[];          // hasta 12, en el orden de recorrido
}
```

- **`POST /content/generate`:** cuerpo de hasta 4 KB. Orden: límite por IP → cuerpo (413 o 400) → `X-Device-Id` (400) → IA apagada (503) → caché → presupuestos (429) → un solo vuelo por clave → tubería → guardar → registrar.
  - Un acierto de la caché responde `cached: true`, no gasta presupuesto y funciona aunque el día esté agotado.
  - `fresh: true` se salta la caché, pasa por los presupuestos y guarda la ficha nueva con una clave propia (§12.6).
  - El `id` de la ficha no viene: lo pone el cliente (el `contentRef` del lugar), y la ficha no se puede tocar más (§11.3).
- **`POST /suggest/places`:** cuerpo de hasta 4 KB, con `cache-control: no-store`. Sin candidatos responde `200 { title: '', summary: '', places: [] }`: es «nada cerca», no un error. Puede responder también `502 geocoding_failed` y `503 geocoding_unavailable` cuando Wikimedia falla o pide esperar.

Códigos de error de la fase 7 (el cliente decide por `code`; los dos `429` de la IA no son el `rate_limited` de los límites por IP):

| Código | Estado | Cuándo |
|---|---|---|
| `ai_unavailable` | 503 | La IA está apagada (`AI_PROVIDER` vacío o sin `AI_API_KEY`), o el proveedor rechaza la clave, el saldo o el modelo (401, 402, 403 o 404) |
| `ai_budget_exceeded` | 429 | El gasto estimado de hoy (UTC) llegó a `AI_DAILY_BUDGET_USD`: no empieza ninguna generación nueva |
| `ai_device_limit` | 429 | El dispositivo ya empezó `AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY` generaciones hoy |
| `generation_failed` | 502 | El proveedor falló, tardó demasiado o no dio una respuesta válida, o Wikimedia falló al preparar una ficha |
| `unverified_content` | 422 | En un POST o PUT de ruta, alguna ficha no la generó este servidor. Incluye `details` con las rutas `contents.<ref>.<locale>` |
| `place_not_found` | 404 | (Ya existía.) En `/content/generate`, el `externalId` no es un elemento de Wikidata |

### 11.2 Base de datos (Drizzle, PostgreSQL)

| Tabla | Columnas principales |
|---|---|
| `routes` | `id` (slug, pk), `spec` jsonb, `spec_version`, `spec_hash`, `name`, `mode`, `activity`, `source`, `locale`, `point_count`, `distance_m`, `est_minutes`, `centroid_lat`, `centroid_lng`, `bbox` jsonb, `status` (`published`\|`draft`\|`archived`), `owner_device_id`, `owner_user_id` (futuro, null), `edit_token_hash`, `created_at`, `updated_at` |
| `point_contents` | `id` (pk), `route_id` (fk), `point_id`, `locale`, `content` jsonb, `status`, timestamps. Único (`route_id`, `point_id`, `locale`) |
| `ai_contents` | `cache_key` (pk), `content` jsonb (la ficha sin `id`), `content_hash` (SHA-256 de su JSON canónico, único), `grounding` (`wikipedia`\|`web`\|`none`), `hits`, `created_at` |
| `ai_generations` | `id` bigserial, `device_id` (uuid, sin clave foránea), `kind` (`card`\|`suggest`), `cache_key` (null en las sugerencias), `locale`, `model`, `prompt_version`, `input_tokens`, `output_tokens`, `web_searches`, `cost_usd`, `status` (`ok`\|`failed`), `latency_ms`, `created_at`. Índices (`created_at`) y (`device_id`, `created_at`) |
| `runs` | `id` (uuid), `route_id`, `spec_hash`, `device_id`, `mode`, `status` (`running`\|`finished`\|`cancelled`\|`abandoned`), `started_at`, `ended_at`, `elapsed_ms`, `completed_points`, `total_points`, `score`, `client_info` jsonb |
| `analytics_events` | `id` bigserial, `device_id`, `run_id` (null), `name`, `props` jsonb, `client_ts`, `server_ts`. Índice (`name`, `server_ts`) |
| `devices` | `id`, `first_seen`, `last_seen`, `platform` (aproximada), `pwa_installed` |

- El `spec` en jsonb es la **fuente de verdad**. Las columnas extraídas (nombre, modo, métricas, centroide) sirven para listar y filtrar sin abrir el JSON.
- Las rutas de usuario llevan `owner_device_id` (el `X-Device-Id` del POST) y `edit_token_hash` (el SHA-256, en hexadecimal, del token que generó el cliente). Las curadas no llevan ninguno de los dos.
- Borrar una ruta es un borrado físico: la fila, sus `point_contents` y sus `runs` se van por la cascada de las claves foráneas.
- **`ai_contents`** guarda cada ficha que genera el servidor, y su hash decide qué fichas acepta una ruta de usuario (§11.3). **`ai_generations`** es el libro de cuentas de la IA: una fila por llamada, con sus tokens y su coste estimado, que también alimenta los presupuestos. Ninguna de las dos se poda.
- **Futuro:** tabla `users`, sesiones, migración de `owner_device_id` → `owner_user_id`, consultas espaciales con PostGIS ("rutas cerca de mí").

### 11.3 Seguridad

- Mismo origen que la web, así que sin CORS. `@fastify/helmet` y límite de tamaño del body: 1 MB, 128 KiB en el POST y el PUT de rutas y 4 KB en los dos endpoints de IA (`413 payload_too_large`).
- **Rate limit.** `X-Device-Id` lo elige el cliente y se esquiva con uno nuevo en cada petición, así que los límites estrictos cuentan por **IP**:
  - general, por dispositivo o IP: 300 por minuto (`RATE_LIMIT_PER_MINUTE`);
  - escrituras de rutas (POST, PUT, DELETE y lecturas de una ruta de usuario): 20 por minuto y 200 por día;
  - búsqueda de lugares (`/geo/suggest` y `/geo/resolve`, juntos): 120 por minuto;
  - recorridos y analytics: 30 por minuto;
  - fichas (`/content/generate`): 30 por minuto (`CONTENT_RATE_LIMIT_PER_MINUTE`);
  - sugerencias (`/suggest/places`): 20 por minuto (`SUGGEST_RATE_LIMIT_PER_MINUTE`).

  La IP es la última entrada de `X-Forwarded-For`, la que añade Traefik: la API confía en un solo salto y solo si la conexión viene de una red privada (§11.7). Al superar un límite, `429 rate_limited` con `Retry-After`.
- **Cuotas de rutas de usuario:** 50 por dispositivo (`409 quota_exceeded`) y, en todo el servidor, `USER_ROUTES_MAX` (5.000 por defecto; pasado el tope, `503 unavailable`). La ruta que se repite no cuenta contra sus propias cuotas.
- Validación Zod de todo lo que entra; nunca se confía en el cliente. El POST y el PUT de rutas pasan por `validateRouteBundle` (sin exigir los tres idiomas) y por `checkUserRoute`, una lista cerrada de lo que puede tener una ruta de usuario: la que produce el creador y nada más.
  - Sin `path`, `coverImage` ni `description`. `summary` solo como texto simple de hasta 280 caracteres (la idea de ruta que sugiere la IA).
  - Fichas (`contents`) solo las que generó este servidor, con las reglas de «Fichas verificadas por el servidor» (más abajo).
  - Metadatos de la ruta: solo `interests` (hasta 10 textos de 40 caracteres). Metadatos de un punto: solo `address` (hasta 200) y `externalId` (un QID de Wikidata).
  - Acciones: una por punto más 8, como mucho, y solo `info_sheet` (sin imagen), `ai_template` y `decision`, sin `presentation` ni `feedback`. Triggers: `onEnter` en los puntos y `onDeviation`, `onIdle`, `onOutOfOrder` y `onTimeout` en la ruta.
  - Que Postgres pueda guardarla: anidación de 8 niveles como mucho, sin caracteres de control ni sustitutos Unicode sueltos en ningún texto ni clave, y hasta 500 km entre los puntos en orden.
  - Un problema es `422 invalid_route` con hasta 20 `details`. Así nadie guarda imágenes, enlaces o datos pesados a través de la API, salvo las fichas que generó el servidor.
- **Rutas de usuario privadas:** `GET /routes` solo lista las curadas, y una ruta de usuario solo la lee quien tiene su `X-Edit-Token` (§11.1).
- **Fichas verificadas por el servidor (fase 7).** `checkUserRoute` abre `contents` solo para fichas de IA: una por cada clave que referencie una acción `ai_template` (y al revés), en el idioma de la ruta (`spec.locale`), con `generated.by === 'ai'`, con imágenes solo de `https://upload.wikimedia.org/…` y hasta 30 fichas.
  - Además, el POST y el PUT calculan el SHA-256 de cada ficha (`contentHashInput`: su JSON canónico sin el `id`) y exigen que esté en `ai_contents.content_hash`. Si no, `422 unverified_content`, con `details` en `contents.<clave>.<idioma>`.
  - Sin eso, cualquiera podría guardar una ficha que dijera «Generado con IA a partir de Wikipedia» con el texto, los enlaces o las imágenes que quisiera. Las fichas las escribe el servidor con fuentes y fotos de Wikimedia, y el cliente solo las transporta, sin tocarlas.
  - La comprobación va después de `checkUserRoute` (una imagen de otro servidor sigue siendo `invalid_route`) y antes de las cuotas. Una ficha ya generada sigue valiendo aunque cambie el prompt o se genere otra con `fresh`: `ai_contents` no se poda.
- **Presupuestos de IA.** El gasto estimado del día UTC (la suma de `cost_usd` de `ai_generations`) no puede pasar de `AI_DAILY_BUDGET_USD`, y un dispositivo no empieza más de `AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY` generaciones al día: si no, `429 ai_budget_exceeded` o `429 ai_device_limit`.
  - Lo que sale de la caché es gratis y no cuenta. Solo cuentan las llamadas `ok` o con coste: un fallo del proveedor sin gasto no consume el día de nadie.
  - `X-Device-Id` lo elige el cliente, así que el tope por dispositivo se esquiva con un identificador nuevo. Los topes que de verdad frenan son el presupuesto global y el límite por IP.
  - Comprobar y registrar no es una sola operación atómica: una ráfaga puede pasarse del tope por unas pocas generaciones (acotado por el límite por IP y el vuelo único por clave).
  - Qué se envía al proveedor de IA, cómo se trata el texto no fiable y qué guarda el servidor: [SECURITY.md](SECURITY.md).
- `editToken`: lo genera el cliente, 32 bytes aleatorios (§10.8). El servidor guarda solo su hash SHA-256 y lo compara en tiempo constante.
- Secretos únicamente en variables de entorno: en Coolify, como variables solo de ejecución, y en local, en `.env` que git ignora. En el repo solo hay `.env.example`. El repo es público: reglas completas en [SECURITY.md](SECURITY.md).
- Logs (pino) sin datos personales: la ruta sin la *query*, y nunca coordenadas, tokens, el texto que se busca ni el cuerpo de las peticiones. Una llamada a la IA que falla se registra solo con su motivo (`anthropic 401 authentication_error`, `timeout`…), nunca con la clave, el prompt ni el nombre del lugar.

### 11.4 Variables de entorno

Las plantillas completas, que son la fuente de verdad, están en `apps/api/.env.example` y `apps/web/.env.example`. En local se copian a `.env`, que git ignora.

```
# apps/web (públicas: se incrustan en el bundle; nunca secretos)
VITE_ARCGIS_API_KEY=            # restringida por referrer, solo mapas base
VITE_DEFAULT_BASEMAP=arcgis/navigation

# apps/api (secretos: solo en el servidor)
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
DATABASE_URL=
RATE_LIMIT_PER_MINUTE=300       # general, por dispositivo o IP
WRITE_RATE_LIMIT_PER_MINUTE=20  # fase 6: escrituras de rutas, por IP
WRITE_RATE_LIMIT_PER_DAY=200    # fase 6: escrituras de rutas, por IP
GEO_RATE_LIMIT_PER_MINUTE=120   # fase 6: búsqueda de lugares, por IP
USER_ROUTES_MAX=5000            # fase 6: rutas de usuario en todo el servidor
GEOCODING_PROVIDER=wikidata     # fase 6: búsqueda de lugares con coordenadas guardables (ver 12.3); none la apaga
WIKIMEDIA_USER_AGENT=           # fase 6: vacío = "Rumbo/<versión> (https://github.com/AOcampo93/rumbo)"; para dar un email, en Coolify
ARCGIS_API_KEY_SERVER=          # geocodificación de direcciones (solo para mostrar, nunca guardar); la API ya la lee, aún no la usa
AI_PROVIDER=anthropic           # fase 7: anthropic, o vacío = IA apagada (los endpoints de IA responden 503 ai_unavailable)
AI_API_KEY=                     # SECRETO (fase 7). Sin clave, 'anthropic' queda en 'none' y la API avisa al arrancar
AI_MODEL=                       # vacío = claude-sonnet-5-5
AI_EFFORT=low                   # fase 7: cuánto piensa el modelo (low, medium, high); none no envía el ajuste
AI_DAILY_BUDGET_USD=5           # fase 7: gasto estimado por día UTC a partir del cual no empieza ninguna generación nueva
AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY=40
AI_PRICE_INPUT_PER_MTOK=2       # fase 7: precios con los que se estima el gasto (USD por millón de tokens y por búsqueda web);
AI_PRICE_OUTPUT_PER_MTOK=10     #         son los del modelo por defecto: cámbialos junto con AI_MODEL
AI_PRICE_PER_WEB_SEARCH=0.01
CONTENT_RATE_LIMIT_PER_MINUTE=30   # fase 7: fichas, por IP
SUGGEST_RATE_LIMIT_PER_MINUTE=20   # fase 7: sugerencias de lugares, por IP
ANALYTICS_ENABLED=true
```

Los números de las fases 6 y 7 son opcionales: un valor que no sea un entero positivo (un número positivo, en los precios y el presupuesto) se ignora y se usa el de por defecto. `GEOCODING_PROVIDER` con un valor que no sea `wikidata` ni `none` impide arrancar la API, igual que un `AI_PROVIDER` que no sea `anthropic` ni `none` o un `AI_EFFORT` desconocido. El límite de 50 rutas por dispositivo no es una variable: es una constante (`ROUTES_PER_DEVICE`).

### 11.5 Despliegue (Coolify en Contabo)

En marcha desde el 2026-10-07. El detalle operativo está en [DEPLOY.md](DEPLOY.md).

- **Servicios** (proyecto «Rumbo» de Coolify):
  - `rumbo-web`: build estático servido por nginx;
  - `rumbo-api`: Node 24;
  - `rumbo-db`: PostgreSQL 17 + PostGIS 3.5, con volumen persistente y sin puerto público.
- **Un solo origen:** `https://rumbo.arturoocampo.com` para la web y `/api` para la API, con HTTPS de Let's Encrypt vía Traefik.
- **Ramas:** `main` es desarrollo y `production` es lo desplegado. Desplegar es promover a `production` un commit de `main` con la CI en verde y pedir a Coolify que lo construya (`pnpm deploy:prod`), y solo cuando lo pide el responsable del proyecto. Un push no basta: la GitHub App del servidor no tiene webhook ([DEPLOY.md](DEPLOY.md)).
- **Migraciones:** la API aplica las pendientes al arrancar (§11.6).
- **Backups:** dump diario de Postgres en Coolify desde el 2026-10-07 ([DEPLOY.md](DEPLOY.md)).
- **CI:** GitHub Actions ejecuta formato, lint, typecheck, tests (los de la API, contra un PostgreSQL en contenedor), `validate:routes`, build, los e2e, las imágenes Docker y el escaneo de secretos.

### 11.6 Precisiones de la implementación (fase 5)

- **Contrato (`packages/api-contract`):** los DTOs en Zod que comparten la API (validación de entrada y OpenAPI) y la web (tipos): `RouteSummary`, los filtros del listado, el inicio y el cierre de un recorrido, el lote de analytics y los códigos de error.
- **Base de datos:** Drizzle ORM sobre `pg`. El esquema está en `apps/api/src/db/schema.ts` y las migraciones SQL en `apps/api/drizzle`.
  - Respecto a la tabla de §11.2: `point_contents` usa `content_ref` (la clave de `RouteBundle.contents`) en lugar de `point_id`; `routes` guarda además `locales` (idiomas completos); `runs` guarda `simulated` y `locale`.
  - `ai_contents` y `ai_generations` llegaron con la fase 7 (migración 0001, §11.2).
- **Arranque:**
  - aplica las migraciones pendientes y carga las rutas de `data/routes` (inserta las nuevas, reemplaza las que cambiaron y deja igual el resto);
  - si Postgres no responde, arranca igual y reintenta cada 10 s, mientras los endpoints de datos devuelven `503 { code: "unavailable" }`.
- **Endpoints de la fase:** `GET /routes`, `GET /routes/:id`, `POST /runs`, `PATCH /runs/:id`, `POST /analytics/batch` y `GET /health`.
  - **Listado:**
    - filtra por modo y actividad en SQL (desde la fase 6 solo lista las rutas curadas, así que ya no filtra por origen);
    - busca en nombre y resumen, en todos los idiomas y sin tildes;
    - ordena por cercanía con `near=lat,lng`.
  - **Detalle:** lleva `ETag` y responde `304` si el cliente ya tiene esa versión.
  - **Cierre de un recorrido:** solo puede hacerlo su dispositivo, y es idempotente (la app reintenta los cierres que no pudo enviar).
  - **Analytics:** rechaza propiedades con forma de posición (`lat`, `lng`…).
  - La documentación OpenAPI está en `/api/v1/docs`.
- **Seguridad:** `@fastify/helmet`, 1 MB por petición y 300 por minuto por dispositivo o IP (`trustProxy` detrás de Traefik); 30 por minuto en recorridos y analytics. Los logs guardan solo la ruta, sin la *query* (podría llevar una posición). La fase 6 añade límites por IP y cuotas (§11.3 y §11.7).
- **Build:** esbuild empaqueta la API en `dist/server.js`, con los paquetes del workspace compilados dentro; las dependencias de npm se instalan en la imagen. La imagen incluye las migraciones y `data/routes`.
- **Web:**
  - Carga las rutas de la API y, si no responde, usa las que lleva dentro.
  - Envía `Accept-Language` y el identificador anónimo del dispositivo (un UUID en IndexedDB).
  - Registra el inicio y el cierre de cada recorrido sin hacer esperar al usuario. Los cierres que no se pudieron enviar se reintentan al abrir la app.
  - Los eventos de analytics de un recorrido llevan su `runId`.
- **Tests:** 31 de integración de la API contra un PostgreSQL real (Testcontainers; en local hace falta Docker). Usan `postgres:17-alpine` porque la imagen de PostGIS no tiene versión ARM y la v1 no hace consultas espaciales.

### 11.7 Precisiones de la implementación (fase 6)

Al construir las escrituras de rutas y la búsqueda de lugares se concretaron estos puntos. El contrato de cada endpoint está en el §11.1 y las políticas, en el §11.3.

- **Contrato (`packages/api-contract`):**
  - Añade la cabecera y el esquema del token (`EDIT_TOKEN_HEADER`, `EditTokenSchema`), el sobre del cuerpo (`RouteBundleBodySchema`), la respuesta de escritura (`RouteWriteResponseSchema`), los esquemas de `/geo`, ocho códigos de error nuevos y `checkUserRoute` con sus `USER_ROUTE_LIMITS`.
  - `validation_failed` e `invalid_route` llevan `details` (hasta `MAX_ERROR_DETAILS` = 20). `NearSchema` redondea a 3 decimales y `RouteListQuerySchema` ya no tiene `source`.
  - El paquete pasa a depender de `geo-utils`, para medir distancias.
- **Dos validaciones, una detrás de otra:** el cuerpo solo se comprueba como sobre `{ spec, contents? }`, y la ruta pasa después por `validateRouteBundle` y por `checkUserRoute`. Así, todo problema de la ruta es un 422 con `details`, y no un 400 de esquema. Se guarda el spec **tal como lo escribió el cliente**, no el normalizado.
- **Autenticar antes de leer el cuerpo:** el límite por IP, el token y (en el POST) el dispositivo son hooks `onRequest`. Una petición sin token es un 401 lleve lo que lleve, y no se procesa un cuerpo de hasta 128 KiB para nada.
- **Una transacción por escritura:** el POST, el PUT y el DELETE autorizan y escriben dentro de una transacción con `SELECT … FOR UPDATE`. Si no, un DELETE llegado entre la comprobación y el UPDATE dejaría al PUT respondiendo `200` de una ruta que ya no existe. El DELETE usa `DELETE … RETURNING` y responde 404 si no borró nada.
- **Valores que Postgres no acepta:** una estimación de minutos fuera del rango de `integer` (por ejemplo, con una velocidad esperada minúscula) o un texto que jsonb no admite hacen fallar la escritura aunque todos los validadores la dieran por buena. Los códigos 22003, 22P02 y 22P05 se traducen a `422 invalid_route` en las escrituras de rutas y a `400 validation_failed` en el resto de endpoints, y no se registran como errores del servidor.
- **Las curadas ganan:** al arrancar, si el seed encuentra una fila no curada con el id de una ruta curada, la borra (con sus fichas y recorridos) y siembra la curada, con un aviso en el log. Los ids curados son públicos y los de usuario los elige el cliente: sin esta regla, alguien podría ocupar el id de una ruta curada que aún no existe y bloquear su siembra. El seed tampoco siembra un archivo cuya ruta no sea `curated`, y no toca las filas con cualquier otro id.
- **Borrado físico**, sin estado intermedio ni papelera: la ruta, sus fichas y sus recorridos (cascada). Las copias de seguridad conservan lo borrado hasta 14 días ([DEPLOY.md](DEPLOY.md)).
- **Las lecturas del dueño cuentan como escrituras:** un `GET /routes/:id` con `X-Edit-Token` comparte el presupuesto de escrituras, sin consultar antes la base de datos. Las lecturas públicas no.
- **`trustProxy`, una trampa de Fastify 5:**
  - `trustProxy: 1` («un salto») no confía en nadie en Fastify 5.12, porque con solo un número no puede distinguir un proxy de un cliente que se conecta directo. Entonces `request.ip` sería la dirección de Traefik y todos los usuarios compartirían contador.
  - La API usa una función, `trustProxyHop` (`src/limits.ts`), que confía en un salto y solo si la conexión viene de loopback o de una red privada (la de Docker, desde donde conecta Traefik). `request.ip` es entonces la última entrada de `X-Forwarded-For`, la que añade Traefik, y lo que escriba un cliente no cuenta.
  - Hay tests con un `X-Forwarded-For` falsificado, también para una conexión directa.
- **`@fastify/rate-limit` solo cuenta el primer límite de cada petición:** un segundo `app.rateLimit` (el diario) o el global se saltaría. Cada presupuesto es un hook `onRequest` hecho con `createRateLimit`, que no tiene esa protección: el de escrituras con dos ventanas (minuto y día) y el de `/geo` con una. Todas las rutas de un presupuesto comparten un contador por dirección, y el límite global de 300 por minuto sigue aplicándose encima.
- **Errores:** todos llevan `cache-control: no-store`, aunque el handler hubiera puesto otras cabeceras antes de fallar. Los de Drizzle se registran con el código y el mensaje de Postgres, nunca con los parámetros de la consulta (posiciones, ids de dispositivo, hashes).
- **Búsqueda de lugares:** la estrategia está en el §12.3. `buildApp` recibe el proveedor (`geocoder`; sin él, `/geo` responde 503) y `server.ts` crea el de Wikidata, salvo con `GEOCODING_PROVIDER=none`, donde lo avisa en el log.
- **Sin migraciones nuevas:** `routes` ya tenía `owner_device_id` y `edit_token_hash` desde la fase 5. Se eliminó `src/db.ts`, que nadie importaba.
- **Tests:**
  - La API pasa de 31 a 106 tests, con PostgreSQL real (Testcontainers) y sin red.
  - Cubren las escrituras, las lecturas del dueño, las cuotas, las transacciones (un PUT después de un DELETE es 404), los límites por minuto y por día con un `X-Forwarded-For` falsificado, el seed (las curadas ganan y las demás filas no se tocan), los errores y `/geo` con un proveedor falso.
  - El proveedor de Wikidata se prueba con respuestas grabadas con `curl` (`apps/api/test/fixtures/wikidata/`, recortadas a etiquetas, descripciones y las declaraciones P31, P625, P6375 y P131): consultas saneadas (`--`, `::`, `insource:/x/`), pasos de búsqueda, orden, categorías, nombres, truncado, direcciones, pausa, trabajos compartidos y plazos.
  - Los tokens de los tests se construyen al ejecutar (`Buffer.alloc(32, 7).toString('base64url')`): un literal con aspecto de clave haría saltar gitleaks, que revisa todo el historial.

---

## 12. Guía con IA (solo en el servidor)

Tres piezas, todas en `apps/api` y detrás de `AI_PROVIDER`: **sugerir** lugares reales (§12.4), **preparar** la ficha de cada lugar (§12.2) y darle una **trivia** (dentro de la ficha). El navegador nunca habla con el proveedor de IA: llama a nuestra API.

### 12.1 Principios

- **Una guía de bolsillo.** En un sitio que no conoces, la app te propone qué ver, eliges, la ruta se arma sola y cada lugar lo descubres al llegar (ficha, consejo y pregunta rápida), siempre con fuentes. El razonamiento está en el [ADR 0003](adr/0003-guia-con-ia.md).
- **La IA solo propone; Wikidata y Wikipedia verifican.** Los lugares sugeridos los elige el modelo de una lista de candidatos que arma el servidor con la geobúsqueda de Wikipedia. Los nombres y las posiciones salen de esa lista, nunca del modelo, y un id que no esté en ella se descarta.
- **Anclado en fuentes reales.** El texto de una ficha sale de la Wikipedia del lugar o, si no la tiene, de una búsqueda web con citas. La IA solo resume y estructura. Si no hay información fiable, la ficha es corta y lo dice: **nunca se inventan datos**, y las fuentes se muestran siempre que la ficha las tiene.
- **Sin spoilers.** Las fichas se preparan al crear la ruta, pero el creador solo enseña su estado («Ficha lista · 3 fuentes»), y abrir una pide confirmación. Las anécdotas de las sugerencias dicen por qué ir, no qué vas a aprender.
- **Al crear la ruta, no al llegar.** Así no hay espera en el momento clave, no hay coste por visita y funciona sin conexión: la ficha viaja en el bundle de la ruta.
- **Fichas verificadas por el servidor.** Una ruta de usuario solo puede llevar fichas que generó este servidor (§11.3). El cliente las transporta sin tocarlas.
- **Imágenes reales, no generadas:** Wikimedia Commons con autor y licencia (CC0, dominio público, CC BY, CC BY-SA). Las imágenes generativas no se usan.
- **Transparencia:** la ficha muestra «Generado con IA · Fuentes: …» con enlaces a las fuentes.
- **En el idioma del usuario:** cada petición va en el idioma de la app, y lo generado se queda en él aunque el usuario cambie después ([ADR 0001](adr/0001-multilenguaje.md)). El español va en tuteo y el portugués es el de Portugal, de «tu».
- **Coste acotado:** una generación por (lugar, idioma, versión del prompt, intereses), guardada para todos, con un presupuesto diario y un límite por dispositivo (§12.5).
- **Sin editor, por ahora.** La ficha llega ya `approved`: el usuario puede aceptarla, regenerarla o cambiarla por la básica, pero no editar su texto (queda para después, §16).

### 12.2 Pipeline de `POST /content/generate`

```
Entrada: { name, position, locale, category?, externalId?, interests?, custom?, fresh? }

0. Caché. Clave: ${QID | 'custom:' + sha1(nombre|tipo|lat a 4 decimales|lng a 4 decimales)}:${locale}:${PROMPT_VERSION}:${intereses ordenados}
   · acierto → { content, grounding, cached: true }: gratis y sin presupuesto (`fresh: true` se la salta)
   · fallo → presupuestos (429) y un solo vuelo por clave
1. Elemento de Wikidata: el `externalId` o, en un punto propio, el mejor de una búsqueda por nombre a menos de 2 km
   (solo vale si tiene una etiqueta o un alias con las mismas palabras significativas)
2. Hechos del elemento (etiquetas, descripción, enlaces a es/en/pt, foto P18, tipo P31) y texto del artículo de Wikipedia
   en el idioma pedido (respaldo: en → es → pt). Si es un esbozo (menos de 1.200 caracteres), se miran los otros idiomas
   y gana uno que sea más de 1,5 veces más largo. La ficha se escribe siempre en el idioma pedido
3. Imágenes: la P18 y, si no hay, la del artículo, desde Commons (autor y licencia; solo CC0, dominio público, CC BY y
   CC BY-SA; fotos de 300 px o más; miniatura de 960 px en upload.wikimedia.org)
4. Ficha, en una llamada al modelo con la herramienta `write_card`:
   a. con artículo: el artículo es la única fuente (fuentes = [el artículo])
   b. sin artículo: búsqueda web del proveedor (3 como máximo); fuentes = las páginas que el modelo dice haber usado
      y que la búsqueda devolvió de verdad (si no cita ninguna, las 2 primeras)
   c. nada fiable (el modelo dice `found: false`, o no hay citas): ficha honesta y corta en es/en/pt, `grounding: 'none'`
5. Validar con Zod → un reintento con la ficha y los problemas → si falla otra vez: el arranque del artículo (si está
   en el idioma del usuario) o la ficha honesta
6. Guardar en `ai_contents` (con su SHA-256), anotar la llamada en `ai_generations` y responder
```

- **La ficha que devuelve:** `{ locale, title, subtitle?, summary, facts, images, tip?, quiz?, sources, generated: { by: 'ai', model, promptVersion, at }, status: 'approved' }`, sin `id`.
  - Lo que escribe el modelo: `title` (≤ 80), `subtitle` (≤ 120), `summary` de 2 a 4 frases (≤ 800), hasta 6 `facts` (≤ 160), `tip` (≤ 200) y la trivia.
  - Las imágenes y las fuentes no las escribe el modelo: las pone el servidor.
- **El prompt** (`PROMPT_VERSION = 'card-1'`): un guía local cercano que habla al visitante en el idioma pedido (portugués de Portugal).
  - Usa SOLO el texto o los resultados que se le dan, y prefiere pocos datos a datos inventados.
  - El consejo es algo práctico que mirar o hacer allí. Da más peso a los intereses. No dice que es una IA.
  - Cambiar el prompt sube `PROMPT_VERSION`, y con ella la clave de la caché.
- **La trivia:** una pregunta con 3 o 4 opciones, la correcta y una explicación, que se puede contestar con lo que dice la propia ficha. El servidor baraja las opciones. Si solo falla la trivia, se descarta sin reintentar.
- **La ficha honesta** (`grounding: 'none'`): un texto fijo en es/en/pt que dice que no se ha encontrado información fiable y que no se quiere inventar nada. Sin datos, sin consejo, sin trivia y sin fuentes (mantiene la foto, si el lugar la tiene).
- **Video:** la IA no busca video. El campo `video` queda para fichas escritas a mano.
- **Wikimedia:** las consultas llevan el mismo `User-Agent` descriptivo, plazo, tope de 1 MB, `redirect: 'error'` y cortacircuitos (429 o 5xx) que la búsqueda de lugares (§12.3), con 4 peticiones a la vez.

### 12.3 Búsqueda de lugares y coordenadas (paso 2 del creador)

**Términos de ArcGIS** (comprobados en octubre de 2026):

- Geocodificación **sin guardar**: 20.000 al mes gratis. Sus resultados solo pueden mostrarse de forma temporal (p. ej. centrar el mapa).
- Geocodificación **guardada** (`forStorage=true`): es obligatoria si el resultado se persiste en la BD, **no tiene capa gratuita** ($4 por 1.000) y no está disponible sin pay-as-you-go.

**Decisión:** las coordenadas que se guardan **nunca salen del geocodificador de ArcGIS**.

- **Wikidata (CC0)** para monumentos y POIs conocidos. Es el proveedor de búsqueda por defecto del creador (`GEOCODING_PROVIDER=wikidata`) y además da el QID para el pipeline de IA.
- **Pulsación larga en el mapa**, o el botón «Añadir el centro del mapa», para puntos personalizados.
- **ArcGIS Geocoding** (vía backend, `forStorage=false`) solo para buscar direcciones y **mover el mapa** a la zona; después el usuario fija el punto con una pulsación larga o con el centro del mapa. **Pendiente** de una clave de servidor: la API ya lee `ARCGIS_API_KEY_SERVER` pero todavía no la usa. Mientras tanto, la ciudad o zona del paso 1 también se busca en Wikidata.
- Todo detrás de una interfaz `GeocodingProvider`, para poder cambiar de proveedor por configuración.

**Implementación de la fase 6** (`apps/api/src/geo/` y `routes/geo.ts`). `GeocodingProvider` tiene dos operaciones, `suggest` y `resolve`. El de Wikidata (`createWikidataGeocoder`) es el único por ahora, y `GEOCODING_PROVIDER=none` apaga la búsqueda (503 `geocoding_unavailable`).

- **La consulta se limpia antes de usarla**, igual para lugares y para zonas: NFKC, sin caracteres de control ni invisibles, un solo espacio entre palabras y 80 caracteres como mucho.
  - Para lugares, además, solo quedan letras, cifras, apóstrofos, guiones y puntos. Las palabras que parecen sintaxis del buscador (con `:`, o que empiezan por `-` o `!`) se descartan enteras, y quedan 6 palabras como mucho, en minúsculas y sin tildes.
  - Si ninguna palabra tiene 2 letras o cifras (`--`, `::`), la respuesta es `[]` sin llamar a Wikidata ni escribir en la caché. Sin eso, la búsqueda se reduciría a `haswbstatement:P625` y devolvería elementos cualquiera.
  - Todas las URL se construyen con `URLSearchParams`.
- **Lugares (`kind=place`):** CirrusSearch (`list=search`, 20 resultados) con `<palabras> haswbstatement:P625 nearcoord:20km,<lat>,<lng>`, y sin el `nearcoord` si no hay `near`. Los prefijos no siempre funcionan (ver las medidas más abajo), así que se prueba por pasos hasta reunir 3 resultados:
  1. la última palabra como prefijo (`mosteiro bat*`), si tiene 2 o más letras;
  2. con menos de 3 resultados, la última palabra completa, sumando lo que salga;
  3. si siguen siendo menos de 3 y queda alguna palabra de 2 o más letras, la búsqueda sin la última palabra;
  4. si no hay ninguno y hay `near`, el paso 1 otra vez con `nearcoord:100km`.
- **Después de buscar,** `wbgetentities` (etiquetas, descripciones y declaraciones) de hasta `limit + 6` elementos, en el idioma del usuario y luego pt, en, es y mul. Con `languagefallback`, Wikidata rellena un idioma que falta con otro; ese relleno espera el turno de su idioma, para que un nombre portugués gane a uno inglés que hace de español. Se descartan los elementos sin nombre o sin coordenadas (P625).
- **Cada sugerencia** lleva la clave `wikidata:<QID>`, el nombre (≤ 80 caracteres), la descripción (≤ 200), la posición (P625, con la declaración de rango preferente primero), la categoría (P31 directo, tabla de abajo), el `externalId` (el QID), `distanceMeters` desde el `near` ya redondeado y `storable: true`.
- **Orden:** primero los nombres que empiezan por lo escrito, luego los que tienen una palabra que empieza por cada palabra escrita y luego el resto; dentro de cada grupo, por cercanía. Cuentan todos los nombres del elemento en los idiomas pedidos: «castelo», escrito en una app en español, encuentra «Castillo de Leiria».
- **Ciudades y zonas (`kind=area`, paso 1):** `wbsearchentities` (la etiqueta y la descripción vienen en la respuesta; pide `limit + 3`) y después `prop=coordinates`, mucho más ligero que las declaraciones. Se quedan los que tienen coordenadas, en el orden de la búsqueda. Sin categoría, sin distancia y sin `near`: la zona no depende de dónde esté el mapa.
- **Resolver (`/geo/resolve`):** la clave tiene que ser `wikidata:Q<n>`. Una llamada a `wbgetentities` da el nombre y las coordenadas.
  - La dirección es la calle (P6375) si la hay; si no, los nombres de hasta 2 entidades administrativas de P131 (otra llamada, solo etiquetas) unidos con «, », por ejemplo «Leiría, Pousos, Barreira e Cortes» para el castillo. Hasta 200 caracteres.
  - Sin ninguna de las dos no hay dirección, y la ficha del lugar mostrará solo el nombre.
  - Un elemento que no existe o no tiene coordenadas es `404 place_not_found`, y no se guarda en la caché.
- **Textos de Wikidata:** se limpian (sin caracteres de control, sustitutos sueltos ni marcas bidireccionales) y se cortan en puntos de código, nunca partiendo un par de sustitutos: nombres a 80, descripciones y direcciones a 200.
- **Costes acotados:**
  - Un plazo de 6 s por petición, que también se cancela si el cliente se va (escribió otra letra), pasado a cada llamada a Wikidata.
  - Las peticiones idénticas en curso comparten un solo trabajo, que se detiene cuando ya nadie lo espera.
  - Como mucho 4 llamadas a Wikidata a la vez en todo el servidor, y respuestas de hasta 1 MB. Un lote de elementos que no cabe (solo Portugal pesa unos 560 KB) se reintenta partido por la mitad, con 7 llamadas como máximo en total, y el que sigue sin caber se deja fuera en vez de hacer fallar toda la búsqueda.
  - Sin redirecciones (`redirect: 'error'`) y con un `User-Agent` descriptivo (`WIKIMEDIA_USER_AGENT`).
  - Un cortacircuitos: si Wikimedia responde 429 o 5xx (o un error `maxlag` o `ratelimited`), la API deja de preguntarle durante lo que indique `Retry-After` (60 s si no lo dice, 1 h como máximo) y responde `503 geocoding_unavailable` sin tocarle.
- **Caché en memoria:** 500 respuestas durante 24 h (sale antes la que lleva más tiempo sin usarse). La clave es `tipo|idioma|palabras|near con 3 decimales|limit`, o `resolve|idioma|clave`. Solo se guardan respuestas correctas, nunca errores ni «no existe».

**Categoría desde `P31`.** Solo cuenta la instancia directa, y gana la primera que coincide. `Q210272` («patrimonio cultural»), que llevan casi todos los monumentos junto a su tipo real, no decide. Los identificadores están en `CATEGORY_OF`, en `apps/api/src/geo/wikidata.ts`.

| Categoría | Tipos de Wikidata |
|---|---|
| `church` | iglesia, catedral, capilla, monasterio, convento |
| `museum` | museo, museo de arte, galería de arte |
| `monument` | monumento, estatua, monumento conmemorativo, castillo, fortificación, palacio, torre, fuente, puente, padrão, mansión |
| `viewpoint` | mirador |
| `nature` | parque, parque urbano, jardín |
| `food` | restaurante, cafetería, mercado |
| `culture` | teatro, biblioteca, biblioteca municipal, estadio |
| `other` | todo lo demás |

**Medidas** (2026-10-08, cerca de Leiria):

- Una búsqueda con `nearcoord` tarda entre 0,3 y 0,5 s, y un `wbgetentities` de un solo elemento, 0,3 s y de 7 a 11 KB. Probada contra Wikidata con el servidor compilado, una búsqueda de lugares completa tardó unos 750 ms la primera vez y 2 ms desde la caché.
- Los prefijos de palabras enteras funcionan (`mosteiro bat*`, `se de leir*`, `castillo*`, `castle*` devuelven resultados), pero los de un trozo de palabra, no siempre: `espirito sant*` devuelve 0 resultados, mientras que `espirito santo` encuentra la Igreja do Espírito Santo. De ahí los pasos de arriba.
- `wbsearchentities` ordena de forma global y no sirve para lugares cercanos («igreja» no tenía ningún resultado a menos de 5 km entre los 50 primeros), pero sí para ciudades.
- Algunas coordenadas de Wikidata están redondeadas (el Castelo de Leiria, a unos 50 m; §15): conviene ajustar el radio de esos lugares.

### 12.4 Sugerencias de lugares (`POST /suggest/places`)

El usuario dice dónde está el mapa, cuánto tiempo tiene, qué actividad hace y qué le interesa, y la app le propone entre 3 y 12 lugares reales, ya en orden de recorrido. **La IA solo elige**: no escribe nombres ni coordenadas.

```
Entrada: { near, locale, interests, minutes (30 a 480), activity, exclude (QIDs, hasta 30) }

1. Candidatos: geobúsqueda de Wikipedia (`generator=geosearch`) en la Wikipedia del idioma y en las de pt y en, con 50
   artículos por idioma y un radio de min(1500 + 10·minutos, 4000) m a pie (×1,5 corriendo, ×3 en bici, hasta 10 km).
   Se unen por QID. Se descartan las páginas de desambiguación, las sin coordenadas, las de otro astro, los `exclude` y
   las áreas (país, provincia, municipio, ciudad, según el `type` de la coordenada). Quedan 40 como mucho: primero los que
   tienen artículo en más Wikipedias y luego los más cercanos
2. Wikidata (`wbgetentities`): la categoría (P31, la misma tabla del §12.3) y la etiqueta en el idioma del usuario
3. Una llamada al modelo (herramienta `choose_places`, con los ids de los candidatos como únicos valores permitidos):
   recibe una tabla (id | nombre | tipo | distancia y dirección | «artículos n/N» | descripción), los intereses, el tiempo
   y la actividad, y devuelve { título, resumen, picks: [{ id, anécdota }] } con entre 3 y 12 lugares que quepan en el tiempo
4. Limpieza: se descartan los ids desconocidos o repetidos, y los textos pierden saltos de línea y enlaces y se cortan en
   una palabra con «…» (título 80, resumen 280, anécdota 160). Un reintento si no hay respuesta por la herramienta o
   ningún id sirve
5. Orden: vecino más cercano desde `near`. Si el recorrido en línea recta (a la velocidad de la actividad, más 6 min por
   parada) pasa de 1,25 veces el tiempo, se quitan los últimos de la lista del modelo, que son los que menos valora, hasta 3
```

- **Nombre:** el título del artículo en la Wikipedia del usuario; si no existe, la etiqueta de Wikidata en su idioma; y si tampoco, el artículo que se encontró (pt y luego en).
- **Respuesta:** `key: 'wikidata:<QID>'` (sirve para `/geo/resolve`), `name`, `description?`, `position` (la de la geobúsqueda, con 6 decimales), `category`, `externalId`, `distanceMeters` (desde el `near` redondeado), `storable: true` y `teaser`.
- **Cachés:** 1 h en memoria (500 entradas) por (`near` a 3 decimales, idioma, intereses, minutos, actividad y `exclude`), solo si Wikipedia y Wikidata respondieron enteros. Las categorías y etiquetas se guardan 24 h por (idioma, QID).
- **Un trabajo idéntico en curso se comparte.** Quien se une no pasa por los presupuestos, igual que un acierto de caché.
- **Anécdotas sin spoilers:** el prompt (`PROMPT_VERSION` `suggest-1`) pide que digan por qué ir y no qué vas a aprender, que se apoyen en los intereses y que no inventen detalles ni hablen del orden del paseo. No se comprueba por código.

### 12.5 Costes y límites

**Medido el 2026-10-08** con `claude-sonnet-5-5`, esfuerzo `low` y los precios por defecto (2 USD por millón de tokens de entrada, 10 de salida y 0,01 por búsqueda web):

| Llamada | Tokens (entrada / salida) | Tiempo | Coste |
|---|---|---|---|
| Ficha desde Wikipedia | ~4.000 / 850 | de 5 a 7 s | ~0,017 USD |
| Ficha con búsqueda web | ~17.000 / 1.200, con 1 búsqueda | ~10 s | ~0,056 USD |
| Sugerencia de lugares | ~2.800 / 600 | de 6 a 9 s (1,5 s de Wikimedia) | ~0,012 USD |

- Una ruta de 8 lugares con ficha de Wikipedia cuesta unos 0,14 USD si no hay ninguna ficha en caché, y 0,012 USD más si se pidió una sugerencia. Con el presupuesto por defecto (5 USD al día) caben unas 35 rutas así al día. Los lugares ya generados (con el mismo idioma e intereses) se sirven de la caché, gratis.
- El gasto es una **estimación** a partir de los tokens que declara el proveedor y de los precios configurados, no la factura. Si cambias `AI_MODEL`, cambia también `AI_PRICE_*`.
- **Topes:** presupuesto diario (`AI_DAILY_BUDGET_USD`, 5 USD) y límite por dispositivo (`AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY`, 40) en el §11.3. Por IP: 30 fichas y 20 sugerencias por minuto.
- **Latencia:** una ficha tarda normalmente de 5 a 12 s. El plazo de la API es de 90 s por ficha y el de la web, de 120 s. El creador prepara 2 fichas a la vez y enseña el progreso.

### 12.6 Precisiones de la implementación (fase 7)

Al construir la API de la IA se concretaron estos puntos. La web está en el §7.2 y el §10.10.

- **Proveedor** (`src/ai/provider.ts` y `anthropic.ts`): una interfaz con una sola operación, `structured(petición, señal)`: un prompt, una herramienta cuyo JSON Schema es la respuesta y, si hace falta, búsqueda web. La implementación de Anthropic usa `POST /v1/messages` con un `fetch` inyectable, y los tests usan un proveedor falso y respuestas grabadas: no tocan la red.
  - **El modelo por defecto rechaza con un 400** una `temperature` distinta de la suya y un `tool_choice` forzado. El proveedor envía `tool_choice: auto` y ninguna `temperature`; el prompt pide responder llamando a la herramienta una sola vez, y una respuesta sin esa llamada es `invalid_output` (la tubería reintenta una vez).
  - `output_config.effort` (`AI_EFFORT`, `low` por defecto): el modelo piensa por defecto, y con `low` una ficha tarda de 5 a 7 s. `AI_EFFORT=none` no envía el ajuste (para modelos que no lo admiten).
  - **Errores:** 429 y 529 son `rate_limited`; 401, 402, 403 y 404 son `unavailable` (503 `ai_unavailable`: la clave, el saldo o el modelo); lo demás es `failed` (502 `generation_failed`). El plazo es de 60 s por llamada. Los mensajes son `anthropic <estado> <tipo>`, `network`, `timeout` o `aborted`: nunca la clave, el prompt ni el texto del proveedor.
  - Una respuesta que gasta tokens y no sirve (un rechazo, `max_tokens` o la ausencia de la llamada a la herramienta) lleva su consumo (`AiBilledError`) para que se anote y cuente en el presupuesto.
  - Las citas son primero los `web_search_result_location` de los bloques de texto y luego cada resultado de la búsqueda (sin repetir y solo http o https).
- **Arranque:** `app.ts` registra las rutas de fichas y de sugerencias, y `buildApp` recibe el proveedor (`ai`) y el acceso a Wikimedia (`grounding`) para que los tests inyecten falsos; `server.ts` crea los de verdad. Sin proveedor o sin clave, la API arranca con un aviso y los dos endpoints responden `503 ai_unavailable`.
- **Fichas:**
  - **La trivia viaja como cuatro campos planos** en la herramienta (`quizQuestion`, `quizOptions`, `quizCorrectIndex` y `quizExplanation`), y el servidor construye el objeto `quiz`. La respuesta de la búsqueda web también es plana. Con el `quiz` anidado, el modelo escribió una vez el objeto entero como un texto y el reintento duplicó el coste de la ficha.
  - Un `quiz` inválido o los datos que pasen de 6 se descartan sin reintentar. Lo demás se reintenta una vez con la ficha y los problemas (con una ficha ya escrita no se vuelve a buscar en la web).
  - **Las fotos se buscan antes de llamar al modelo**, y un fallo de Commons falla la petición (502, sin guardar nada): una ficha en caché sin su foto no se arreglaría sola.
  - **Con un elemento de Wikidata, el nombre de la ficha sale de Wikidata**, nunca del cuerpo de la petición: la ficha se guarda para todos los que pidan ese elemento y un cliente no puede envenenarla. El tipo y la posición del cuerpo solo llegan al prompt en un lugar sin elemento.
  - El texto del artículo va dentro de etiquetas `<source>`, y las que traiga el propio texto se neutralizan.
  - `custom` no cambia nada: decide `externalId` (sin elemento: búsqueda por nombre cerca y, si no, web).
  - **`fresh: true`** guarda la ficha nueva con la clave `<clave>#<8 caracteres>`. La anterior sigue en `ai_contents`: las rutas que ya la usan siguen siendo válidas, y las peticiones normales siguen recibiendo la original. Cuenta como una generación para los presupuestos.
  - **El plazo es de 90 s por generación y sigue aunque el cliente se vaya** (ya está pagada): quien reintente la recibe gratis (`cached: true`) cuando termine. Si llegan dos peticiones idénticas a la vez, la segunda espera a la primera y también recibe `cached: true`.
  - Una fila `ok` por ficha. Si el modelo respondió mal o falló a mitad (o se gastaron tokens), la fila es `failed`. Si ni siquiera llegó a él (Wikimedia caído, clave rechazada o límite del proveedor), no hay fila.
- **Sugerencias:**
  - **Las posiciones son las de la geobúsqueda de Wikipedia**, no la P625 de Wikidata (que es CC0). No salen del geocodificador de ArcGIS, que es lo que prohíbe el §12.3.
  - **Los nombres no coinciden siempre con `/geo`.** Aquí manda el artículo del usuario («Castillo de Leiría», con la tilde de la Wikipedia en español) y `/geo` enseña la etiqueta de Wikidata («Castillo de Leiria»). Pasar a «etiqueta primero» es una línea en `nearby()`.
  - La geobúsqueda devuelve los 50 artículos más cercanos, no los más notables. En una ciudad densa, la columna «artículos n/N» y el orden por número de Wikipedias mantienen los más conocidos en la lista.
  - Se comprueba el presupuesto **antes** de preguntar a Wikimedia: un día agotado no le cuesta nada. Un cortacircuitos por servidor respeta el `Retry-After` de Wikimedia (60 s si no lo dice). Una búsqueda ocupada (`cirrussearch-too-busy-error`) se reintenta una vez y, si un idioma sigue fallando, se usan los demás.
  - Si falla Wikidata, los lugares siguen con categoría `other` y los nombres de sus artículos, y la respuesta no se guarda en la caché.
  - La fila de `ai_generations` lleva `cache_key` nulo a propósito: llevaría la posición. Si falla la anotación, se registra el fallo y el usuario recibe su respuesta igual.
  - Un error inesperado (un bug) no se esconde: `500 internal`, después de anotar la llamada.
- **Escrituras de rutas:** la comprobación de fichas (§11.3) devuelve en `details` las rutas `contents.<clave>.<idioma>` que fallan. La ficha tiene que ser exactamente la que hizo la API, con el `id` cambiado por el `contentRef` y sin tocar nada más (ni `status`, ni `generated`, ni el orden de los datos), y su `locale` tiene que ser el de la ruta.
- **Migración 0001:** solo crea las dos tablas nuevas (§11.2). Volver a una imagen anterior de la API es seguro: las tablas se quedan sin usar.
- **Tests:** la API pasa de 106 a 285, y ninguno usa la red.
  - Proveedor (21, con un `fetch` simulado), acceso a Wikidata, Wikipedia y Commons (33, con respuestas grabadas) y la tubería de fichas (28: artículo, web, ficha honesta, reintentos, idiomas, inyección y consumo).
  - Presupuestos (9, con la tabla real), la ruta de fichas (27: caché, claves, vuelo único, presupuestos, errores, plazo y límites) y fichas en rutas de usuario (8: `unverified_content` en POST y PUT).
  - Configuración (6) y sugerencias (46: candidatos, ids desconocidos, orden, ajuste al tiempo, caché, vuelo único y fallos de Wikimedia).
- **Medidas con la IA real** (2026-10-08, durante el desarrollo): tres fichas (Castelo de Leiria, Sé de Leiria y un punto propio, el Rio Lis, investigado en la web) y cuatro sugerencias para Leiria, por unos 0,15 USD en total. Las sugerencias salieron en pt-PT correcto, y tras endurecer el prompt dejaron de inventar detalles.

---

## 13. Analytics y métricas privadas

- **Consentimiento:** se pide en el onboarding y se puede cambiar en Ajustes. Sin consentimiento no se envían eventos de producto.
- **Sin coordenadas:** los eventos no incluyen posiciones. Las trazas GPS solo se subirán en el futuro con opt-in explícito (rankings o antitrampas).
- **Envío:** en lotes con `navigator.sendBeacon` al pasar a segundo plano, o cada 30 s.
- **Eventos v1:**
  - **Uso general:** `app_open`, `onboarding_completed`, `pwa_installed`, `route_viewed`.
  - **Recorrido:** `run_started`, `permission_result` (`{ type, result }`), `point_reached` (`{ pointId, manual }`), `point_completed` (`{ pointId, handlerType, status, ms }`), `interruption_shown` (`{ type }`), `decision_made` (`{ type, decision }`), `run_paused`, `run_resumed`, `run_cancelled`, `run_finished` (`{ elapsedMs, completed, total }`), `gps_weak`.
  - **Creador:** `creator_step_completed` (`{ step }`), `route_created`, `content_generated` (`{ ok, ms }`: uno por cada petición de ficha a la API, con `ok: false` si falló; desde la fase 7 se emite de verdad). Sin propiedades que identifiquen el lugar.
  - **Errores:** `error` (`{ code }`).
- **Métricas internas** (consultas SQL; panel privado en el futuro): rutas iniciadas frente a completadas, abandono por punto, tiempo medio por punto, frecuencia de desvíos, porcentaje de GPS débil por ruta, coste de IA por ruta creada y plataformas. El coste y la latencia de la IA salen de `ai_generations` (`cost_usd`, tokens y `latency_ms` por llamada), no de los eventos.

---

## 14. Calidad y tests

### 14.1 Motor (cobertura ≥ 90 %)

Tests de escenario con reloj y planificador falsos, y trayectos simulados o grabados (`packages/geo-engine/test/fixtures/*.json`):

- Ruta libre completa en un orden cualquiera → `finished`.
- Reto en orden → `finished`. Punto fuera de orden → `out_of_order` sin contar.
- **Ruido en el borde de la zona:** muestras que oscilan entre `radio − 5` y `radio + 5` → **ni parpadeo de `exit` ni doble `enter`**.
- La permanencia exige `dwellTime` y una salida a mitad la reinicia.
- Lecturas con mala precisión no disparan zonas. Un salto imposible se ignora. Con fuente `trusted` no se filtra nada.
- Desvío tras `graceTime` → `deviation`; al volver → `back_on_track`.
- Inactividad fuera de zona → `idle`; dentro de una zona, nunca.
- La pausa congela `elapsed` y suspende eventos. Al reanudar no hay disparos inmediatos.
- `timeLimit` → `timeout` sin detener la ruta.
- `serialize` → `restoreGeoEngine` vuelve en pausa y con el mismo estado. Un hash distinto lanza error.
- Pestaña en segundo plano (ticks espaciados) → la permanencia se calcula por marcas de tiempo.
- `PERMISSION_DENIED` → `error` + pausa + `gps: 'denied'`.
- Check-in manual permitido en libre y rechazado en reto.

### 14.2 Resto

- `route-spec`: fixtures válidos e inválidos para cada regla de 6.3, más la normalización por modo y actividad.
- `route-builder`: un draft produce siempre un spec válido; `summarizeRoute` es correcto. Desde la fase 6, además: los ids de punto no cambian al renombrar o reordenar lugares, editar una ruta y volver a construirla devuelve el mismo spec, y `validateDraft`, `findOverlaps` y `summarizeDraft` cumplen los límites del borrador.
- `event-system`: orden y prioridad de la cola, deduplicación, interrupciones obsoletas, decisiones aplicadas al motor y respaldo cuando un handler falla. Desde la fase 7, además, `ai_template` puntúa el `quiz` de la ficha: 10 puntos si acierta, 0 si falla y nada si no se responde.
- **i18n:**
  - los tres catálogos tienen las mismas claves y los mismos parámetros;
  - `resolveText` sigue su cadena de respaldo;
  - distancias, tiempos y fechas se formatean bien en cada idioma.
- API: tests de integración de endpoints (Postgres en contenedor de test) y validación de bundles. Desde la fase 6 cubren también las escrituras y lecturas de rutas de usuario, las cuotas, los límites por IP y el seed. La búsqueda de lugares se prueba con respuestas grabadas de Wikidata: los tests no usan la red.
  - Desde la fase 7, la IA se prueba con un proveedor falso y respuestas grabadas de Wikipedia, Wikidata y Commons (`apps/api/test/fixtures/ai` y `suggest`), también sin red: los tres caminos de una ficha (artículo, web y ficha honesta), los reintentos y el respaldo, la caché, el vuelo único, los presupuestos y el límite por dispositivo, la IA apagada, `unverified_content` en el POST y el PUT, y las sugerencias (candidatos, ids desconocidos, orden y ajuste al tiempo). El proveedor de Anthropic se prueba con un `fetch` simulado (forma de la petición, citas y errores).
  - El proveedor real **no** se prueba en la CI: se mide a mano, con la clave local (§12.5).
- Web, capa de datos del creador: tests unitarios del registro de «Mis rutas» y su sincronización (IndexedDB falso, `fetch` simulado), del borrador, de la prueba aislada, del router y de que cada clave i18n que usa el código existe.
- Web, fase 7: servicios de IA (errores por código y plazos), cola y borrador de fichas, la interfaz sin spoilers, la trivia de la llegada (con el `ai_template` real: 10, 0 o nada) y las fotos para uso sin conexión. Se comprobó con mutaciones que fallan si se quita el reinicio al cambiar de idioma, la región `aria-live` o el cableado de `PrepareView`.
- **e2e (Playwright, Chromium):**
  - Recorrer "Leiria histórica" en simulación.
  - Reto con un punto fuera de orden.
  - Desvío → Pausar → Reanudar.
  - Cancelar.
  - Recargar a mitad → "Continuar recorrido".
  - Mapa Explorar con 20+ marcadores, popup y filtro.
  - Idioma: elegir PT en el primer arranque → recargar → sigue en PT → cambiar a EN en Ajustes a mitad de recorrido, sin recargar y sin alterar el motor.
- **e2e del creador (fase 6, `apps/web/e2e/create.spec.ts`):**
  - Crear una ruta, probarla en simulación, guardarla y recorrerla de principio a fin: el DoD de la fase.
  - Guardar sin conexión → «Solo en este dispositivo» en Mis rutas.
  - Editar y eliminar una ruta desde Mis rutas.
  - El borrador sobrevive a una recarga.
  - «Probar ruta» fuerza la simulación aunque Ajustes la tenga desactivada.
- **e2e de la guía con IA (fase 7, el último test de `create.spec.ts`)**, con la API de IA simulada (`page.route`):
  - «Usar mi ubicación» como zona y los intereses.
  - «Sugerir lugares» con 3 h (se comprueba el cuerpo de la petición): se desmarca uno de tres y se aplica el título sugerido.
  - Fichas: todas listas **sin ningún texto de ficha en pantalla**; «Ver ficha» pide confirmación («Mejor no», «Ver ficha» y «Cerrar»).
  - Revisar: la línea de fichas. Guardar: el POST lleva `summary`, `interests`, dos `contentRef` y `contents[ref].es` con `generated.by: 'ai'`.
  - Recorrido en simulación: la primera llegada muestra la ficha y su trivia (`h2` «Pregunta rápida»), la respuesta correcta da «¡Correcto! +10 pts», «Continuar ruta», segundo lugar y resumen.
- **CI:** todo lo anterior en cada PR.

### 14.3 Definition of Done global

- TypeScript sin errores, lint limpio y tests en verde.
- TSDoc en las APIs públicas de los paquetes y comentarios útiles en el código (requisito del curso).
- Sin secretos en el repo.
- Accesibilidad básica verificada (contraste, foco, etiquetas).

---

## 15. Rutas de ejemplo en Leiria

Decidido el 2026-10-07: **una ruta precargada**, creada por nosotros, y **una ruta creada con el planificador**, con fichas generadas por IA.

> **Decidido (fase 4):** el curso exige **≥ 20 marcadores** y una ruta de 12 puntos no llega. Explorar añade una capa de **lugares de interés de Wikidata** (`data/pois/leiria.json`): 25 lugares con foto de Wikimedia Commons, que con los 12 puntos de la ruta suman 37 marcadores (§10.9).

**1. Precargada, `leiria-historica`** (en `data/routes/`, creada en la fase 1). Modo libre, a pie, 12 puntos, unos 2,6 km y ~1 h 45. Los textos están en es/en/pt. Empieza sencilla, con fichas `info_sheet` basadas en Wikipedia, y sus acciones se van personalizando. Orden sugerido:

1. Praça Rodrigues Lobo
2. Igreja da Misericórdia
3. Sé de Leiria
4. Igreja de São Pedro
5. Castelo de Leiria (radio de 80 m: el recinto es grande)
6. Igreja e Convento de São Francisco
7. Teatro José Lúcio da Silva
8. Jardim Luís de Camões
9. Mercado de Sant'Ana
10. Museu de Leiria (Convento de Santo Agostinho)
11. Moinho do Papel
12. Santuário de N.ª Sr.ª da Encarnação

Cambios respecto a la lista de candidatos inicial:
- El m|i|mo (Museu da Imagem em Movimento) no está ni en Wikidata ni en OpenStreetMap, así que se sustituyó por la Igreja e Convento de São Francisco.
- La Praça Rodrigues Lobo no tiene coordenadas en Wikidata: se usan las de la estatua del poeta, que está en la plaza (verificado con OpenStreetMap).

Con el tiempo combinará acciones `info_sheet`, al menos un `quiz`, un `video` y un `redirect`, todas en los tres idiomas, para demostrar el sistema de eventos.

**2. De usuario, con IA:** se crea con el planificador (fases 6 y 7), y la IA genera sus fichas en el idioma del usuario. Sirve de demo del creador y del pipeline de IA.

**Opcional (P2), `reto-ribeira-do-lis`:** modo reto, a pie o corriendo, con 8-10 checkpoints (`CP1`…`CP9` + `Meta`) por caminos públicos junto al río Lis y el centro. Incluye un `path` dibujado, `timeLimit` y premios en forma de puntos (quiz en 2-3 checkpoints).

- **Contenido de las curadas:** escrito a mano o generado con el pipeline de IA y revisado, con imágenes de Wikimedia Commons con atribución.
- **Coordenadas:** de Wikidata (CC0) o posiciones dibujadas por nosotros. Nunca coordenadas guardadas desde el geocodificador de ArcGIS (ver 12.3).
  - Si el valor de Wikidata es demasiado impreciso para una zona de llegada, se usa OpenStreetMap con su atribución (© OpenStreetMap contributors, ODbL). Hoy solo pasa con el Castelo de Leiria, cuyo valor en Wikidata está redondeado a unos 50 m.
  - Cada punto guarda en `meta` su QID de Wikidata, sus fuentes y, si aplica, el origen de la coordenada.

---

## 16. Fases de construcción

> Prioridad: **P0** = la base sólida (los 3 módulos) más los requisitos del curso; **P1** = dentro del sprint si da tiempo; **P2** = futuro. Lo que no entre en 2 semanas sigue después: el proyecto continúa.

### Fase 0: Setup (P0) · completada el 2026-10-07

- [x] Monorepo pnpm, TS strict, ESLint/Prettier, Vitest y CI de GitHub Actions.
- [x] `docs/` con este plan; README raíz con la plantilla del curso (borrador).
- [x] Entorno de producción en Coolify (web, API y PostgreSQL), con despliegue por promoción de rama ([DEPLOY.md](DEPLOY.md)).
- [x] Seguridad del repo público: `.env` ignorados, escaneo de secretos y Dependabot ([SECURITY.md](SECURITY.md)).
- [x] Multilenguaje decidido y llevado a los contratos ([ADR 0001](adr/0001-multilenguaje.md)).
- **DoD:** `pnpm i && pnpm test && pnpm build` funciona en CI. ✓

### Fase 1: Contrato y creador base (P0) · completada el 2026-10-07

- [x] `geo-utils`: haversine, rumbo, distancia punto-segmento y punto-polilínea, longitud, bbox, centroide, Douglas-Peucker.
- [x] `route-spec`: tipos, Zod, `validateRouteSpec`, `normalizeRouteSpec`, `hashRouteSpec`, `migrateRouteSpec`, `PointContent`, `LocalizedText` y `resolveText`.
- [x] `route-builder`: `buildRouteSpec`, `summarizeRoute`.
- [x] `data/routes`: la ruta precargada de Leiria en es/en/pt + `pnpm validate:routes`, que exige los tres idiomas.
- **DoD:** fixtures válidos e inválidos cubiertos y las rutas curadas validadas en CI. ✓ (84 tests en los tres paquetes)
- **Notas de implementación:**
  - Los paquetes exportan su código TypeScript directamente (sin build). Vite, Vitest y tsx lo consumen tal cual. La API lo empaquetará con su build cuando los use (fase 5).
  - Los imports relativos llevan extensión `.ts` y se activa `erasableSyntaxOnly`, así que el código también corre con la eliminación de tipos nativa de Node.

### Fase 2: Motor (P0) · completada el 2026-10-07

- [x] `createGeoEngine` con todas las reglas de la sección 8, `restoreGeoEngine` y las fuentes `simulated`, `replay` y `browser`, más el grabador.
- **DoD:** todos los escenarios de 14.1 en verde y cobertura ≥ 90 %. ✓
  - 75 tests, incluida la ruta curada de Leiria recorrida de punta a punta en simulación.
  - Cobertura: 99,8 % de líneas y 94 % de ramas. `pnpm test` del paquete falla si baja del 90 %.
  - Precisiones de la implementación en el §8.9.

### Fase 3: Sistema de eventos (P0) · completada el 2026-10-07

- [x] `createEventSystem`: cola, prioridades, deduplicación, decisiones, respaldo y feedback por defecto. Sin textos: solo claves i18n hacia los adaptadores.
- [x] Los 8 handlers v1 sin UI (`builtinHandlers`) con sus esquemas de `params`. `validateActionParams` se ejecuta en `pnpm validate:routes`.
- **DoD:** tests de 14.2 en verde con un motor real y una fuente simulada. ✓
  - 78 tests en total:
    - las reglas de la cola, con un motor simulado;
    - cada handler;
    - 8 escenarios con el motor real: la ruta de Leiria entera en simulación, desvío → Pausar, fuera de orden, interrupción obsoleta, respaldo, Terminar y recarga con una ficha abierta.
  - Cobertura: 100 % de líneas y 96 % de ramas. `pnpm test` del paquete falla si baja del 90 %, igual que en el motor.
  - Precisiones de la implementación en el §9.7.

### Fase 4: Web, recorrer rutas (P0, requisitos del curso) · completada el 2026-10-08

- [x] Shell PWA, tokens de diseño, router y stores.
- [x] i18n: catálogos es/en/pt, S00 Idioma en el primer arranque y cambio de idioma en vivo desde Ajustes.
- [x] `RouteMap.vue` (componente `<arcgis-map>`) y sus capas.
- [x] Inicio (lista + **mapa con 20+ marcadores, popups y filtro**) y Detalle.
- [x] Preparación y permisos, **Recorrido**, handlers v1, decisiones, pausa, Resumen.
- [x] Persistencia y recuperación, wake lock, sonido, vibración y notificación local.
- [x] Modo simulación.
- [x] Las rutas se cargan desde `data/routes` (estático) si la API no está disponible.
- **DoD:** e2e de 14.2 en verde y la demo completa grabable en simulación. ✓
  - Los 7 e2e de 14.2 en verde (Playwright, job propio en la CI).
  - La demo se graba entera en simulación: Explorar → detalle → preparación → recorrido a 1×, 5× o 20× → fichas → resumen.
  - Precisiones de la implementación en el §10.9.

### Fase 5: Backend mínimo y despliegue (P1) · completada el 2026-10-08

- [x] Fastify, Drizzle, migraciones, seed, `GET /routes`, `GET /routes/:id`, `POST /runs`, `PATCH /runs/:id` y `POST /analytics/batch` (2026-10-08).
- [x] Despliegue en Coolify (web + api + postgres) con HTTPS. Se adelantó a la fase 0.
- **DoD:** la app en producción carga las rutas desde la API. ✓
  - Desplegada el 2026-10-08 (commit `1c151bb`). Al arrancar, la API aplicó las migraciones y sembró la ruta de Leiria.
  - Comprobado en producción con un navegador: la web pide `GET /api/v1/routes` y `GET /api/v1/routes/leiria-historica` (los dos con 200), el mapa carga en Explorar y en el detalle, el service worker queda activo y la consola no muestra errores.
  - Precisiones de la implementación en el §11.6.

### Fase 6: Creador en la web (P1) · completada el 2026-10-08

- [x] Contratos y `route-builder`: borrador y límites del creador, ids de punto estables al editar, `checkUserRoute` y los esquemas de `/geo`.
- [x] API: `POST`, `PUT` y `DELETE /routes` con token de edición, lectura de una ruta de usuario solo para su dueño, cuotas y límites por IP, y `GET /geo/suggest` y `/geo/resolve` sobre Wikidata.
- [x] Web, capa de datos: registro local de «Mis rutas» con subida en segundo plano, borrador con autoguardado, «Probar ruta» aislada del recorrido real y cabeceras de seguridad.
- [x] Mapa del creador: círculos de radio, pulsación larga y aviso de solapamiento.
- [x] Pantallas: wizard de 3 pasos (Datos, Lugares, Revisar), pantalla final y Mis rutas (editar, eliminar y estado de subida).
- [x] e2e del creador (§14.2).
- **DoD:** crear una ruta, simularla y recorrerla de principio a fin. ✓
  - El e2e `create.spec.ts` lo recorre entero: crear la ruta → «Probar ruta» (sin ninguna llamada a `/runs` ni a `/analytics`) → «Guardar ruta» (un `POST` con `X-Edit-Token` y `X-Device-Id`) → «Iniciar ahora» → preparación → recorrido en simulación → «¡Ruta completada!».
  - Los 12 e2e en verde (los 7 de antes y los 5 del creador), también repetidos para descartar que fallen al azar.
- **Notas de implementación:**
  - Precisiones en el §7.1 (creador y web) y el §11.7 (API). La búsqueda de lugares, en el §12.3, y el razonamiento de fondo, en el [ADR 0002](adr/0002-rutas-de-usuario.md).
  - Tests: 571 en total. `route-builder` 61 (con barrera de cobertura), `route-spec` 46, `api-contract` 27, la API 106 y la web 150.
  - Sin migraciones nuevas: `routes` ya tenía `owner_device_id` y `edit_token_hash`.
  - El asistente tuvo tres pasos hasta la fase 7, que añadió «Fichas», los intereses y la línea «Las fichas se generarán en…».
  - Queda para después: el último recorrido de cada ruta en Mis rutas, la búsqueda de direcciones con ArcGIS (necesita `ARCGIS_API_KEY_SERVER`) y compartir rutas.

### Fase 7: Guía con IA (P1 → P2) · construida el 2026-10-08, pendiente de verificar en producción

- [x] Contratos: `PointContent.quiz`, `RouteDraft.summary`, los esquemas de `/content/generate` y `/suggest/places` (con `INTERESTS`), los cinco códigos de error nuevos, `contentHashInput` y `checkUserRoute` abierto a las fichas que genera el servidor. `ai_template` puntúa la trivia (10 puntos).
- [x] API: proveedor de IA (Anthropic, con `fetch` inyectable), presupuestos y límites, acceso a Wikidata, Wikipedia y Commons, `POST /content/generate` (artículo → web → ficha honesta), `POST /suggest/places`, tablas `ai_contents` y `ai_generations` (migración 0001) y verificación de las fichas en `POST` y `PUT /routes`.
- [x] Web, creador: intereses, «Usar mi ubicación», «Sugerir lugares», el paso Fichas (sin spoilers, con «Ver ficha» tras una confirmación, «Regenerar» y «Usar ficha básica») y la línea de fichas en Revisar. Las fichas viajan en el bundle de la ruta.
- [x] Web, llegada: la pregunta rápida (10 puntos), la vista previa de la ficha y las fotos de las fichas en la caché del service worker al preparar la ruta.
- [x] Métrica `content_generated` y e2e del flujo con IA (§14.2).
- [x] Medidas con la IA real durante el desarrollo (§12.5).
- [x] Verificación en producción con la IA real: la clave en Coolify (solo de ejecución), el despliegue y una ruta recorrida de punta a punta (2026-10-08).
- **DoD:** crear una ruta con lugares sugeridos por la IA y un lugar personalizado investigado; fichas preparadas sin spoilers; al llegar se muestran, también sin conexión, con su trivia; verificado en producción con la IA real. ✓
  - En producción (commit `3898958`): con Historia y 1 hora en Leiria, la IA sugirió 9 lugares reales con una idea de ruta («Leiria entre piedra y memoria») y avances sin spoilers; se eligieron 2 y se añadió el punto propio «Rio Lis». Las 3 fichas se prepararon sin mostrar su texto (la del río, con búsqueda web y 5 fuentes). Al llegar en simulación se abrió la ficha del río con su trivia. Coste de toda la prueba: 0,094 USD (3 fichas y 1 sugerencia).
- **Notas de implementación:**
  - Precisiones en el §7.2 (creador), el §10.10 (llegada y fotos sin conexión) y el §12.6 (API). La tubería de fichas está en el §12.2, las sugerencias en el §12.4 y el razonamiento de fondo en el [ADR 0003](adr/0003-guia-con-ia.md).
  - Tests: 852 en total. La API pasa de 106 a 287, la web de 150 a 240 y los e2e de 12 a 13, con el de la guía con IA.
  - Una migración nueva (0001, dos tablas) y variables nuevas de la API (`AI_*` y los dos límites por IP, §11.4). Sin `AI_API_KEY` la API arranca y el creador degrada a fichas básicas.
  - Costes medidos: unos 0,017 USD por ficha de Wikipedia, 0,056 con búsqueda web y 0,012 por sugerencia (§12.5).
  - Queda para después: editar el texto de una ficha (con su carrusel de imágenes y la URL de video), invalidar las fichas cuando cambian los intereses, que cerrar la ficha con el gesto después de responder puntúe la trivia, y probar las fotos sin conexión en Safari/iOS.

### Fase 8: Futuro (P2)

- [ ] Cuentas de usuario y propiedad real de las rutas.
- [ ] Eventos y rutas de otros usuarios en la guía: descubrirlos y compartirlos (compartir necesita un token de lectura aparte, C5).
- [ ] Panel B2B para negocios (rutas por suscripción).
- [ ] Editor visual avanzado.
- [ ] Handlers `three_scene` y `ar_scene` (Three.js / WebXR / model-viewer).
- [ ] Rankings y antitrampas (trazas con opt-in y validación en servidor).
- [ ] Web Push para recordatorios y wrapper nativo (Capacitor) para geocercas en segundo plano.
- [ ] Importar y exportar GPX (variante deportiva).
- [ ] Mapas offline.
- [ ] Panel privado de analytics.
- [ ] Más idiomas (pt-BR…) y regenerar fichas de IA en otro idioma.

**Ritmo:** sin fecha fija. Se avanza sección por sección, con la CI en verde, y se despliega cuando lo pide el responsable del proyecto.

---

## 17. Decisiones tomadas y preguntas abiertas

**Decisiones:**

| Decisión | Motivo |
|---|---|
| Motor en el cliente, en TS puro | Latencia cero por lectura, offline, testeable |
| Triggers como ids de acción + registro de handlers | Acciones ilimitadas sin tocar el motor |
| Contenido IA generado al crear la ruta | Sin espera al llegar, menor coste, offline |
| Imágenes reales de Wikimedia | Veracidad; nada de imágenes falsas de lugares reales |
| `{lat, lng}` en lugar de arrays | Evita errores de orden de coordenadas |
| Validación Zod compartida front/back | Un solo contrato y sin duplicar reglas |
| Restaurar recorridos en pausa | El usuario puede estar en otro sitio al volver |
| Sin trazas GPS en el servidor por defecto | RGPD y confianza del usuario |
| App trilingüe (es/en/pt-PT): idioma elegido una vez y cambio en vivo | Requisito de producto ([ADR 0001](adr/0001-multilenguaje.md)) |
| Textos de ruta como `LocalizedText`; motor y eventos sin texto | Una ruta curada trae los 3 idiomas; cambiar de idioma no toca el motor |
| Lo generado por IA se queda en su idioma | Coste y coherencia; regenerar en otro idioma, en el futuro |
| Web y API en el mismo origen (`/api`) | Sin CORS; service worker y cookies en un solo origen |
| Despliegue por promoción de `main` a `production` | Solo se despliega lo que pasó la CI, y cuando se pide |
| TypeScript 6.0 (no 7) | vue-tsc y typescript-eslint aún no soportan la 7 |
| 20+ marcadores con una capa de lugares de Wikidata | Datos abiertos (CC0), fotos con licencia y una sola ruta curada que mantener |
| Mapa con el componente `<arcgis-map>` (SDK 5.x) | Los *widgets* están obsoletos desde la 5.0 |
| Rutas de usuario privadas: solo las lee su dueño | Una ruta puede incluir una casa o los sitios de un viaje. Compartir llegará con un token de lectura aparte ([ADR 0002](adr/0002-rutas-de-usuario.md)) |
| El token de edición lo genera el cliente | La ruta se crea sin conexión, y con el POST idempotente un `201` perdido no deja rutas huérfanas |
| Las rutas curadas ganan a las de usuario con el mismo id | Los ids de las curadas son públicos y los de usuario los elige el cliente: nadie puede bloquear la siembra de una curada |
| Borrar una ruta es un borrado físico | Si el usuario borra, se borra: sin estados intermedios ni datos personales guardados de más |
| Wikidata como buscador de lugares del creador | Coordenadas CC0 que se pueden guardar en la ruta; ArcGIS solo para direcciones, cuando haya clave (§12.3) |
| «Probar ruta» en simulación forzada y aislada | Probar una ruta no puede tocar un recorrido real ni las estadísticas |
| Asistente de 4 pasos: Datos · Lugares · Fichas · Revisar | «Fichas» es el paso 3 desde la fase 7. No bloquea nunca el avance: sin IA o sin ficha lista se usa la ficha básica |
| La IA propone y Wikidata verifica | El modelo elige los lugares de una lista de candidatos de Wikipedia, y los nombres y las posiciones salen de la lista, nunca de él: no hay lugares inventados ([ADR 0003](adr/0003-guia-con-ia.md)) |
| Sin spoilers | Las fichas se preparan al crear la ruta, pero el creador solo enseña su estado y pide confirmación antes de abrirlas: lo bueno es descubrir el lugar al llegar |
| Fichas verificadas por el servidor | La API solo acepta en una ruta fichas cuyo SHA-256 generó ella (`unverified_content`): nadie puede falsificar un «Generado con IA a partir de Wikipedia» ni colar imágenes o enlaces de otros servidores |
| La búsqueda web solo es el respaldo | Con artículo de Wikipedia la ficha cuesta unos 0,017 USD y tarda de 5 a 7 s; con búsqueda web, unos 0,056 USD y 10 s, con fuentes más dispares. Solo se busca si el lugar no tiene artículo |
| La trivia va dentro de la ficha | Sale de la misma llamada, sin coste extra, funciona sin conexión y `ai_template` la puntúa (10 puntos) |
| Una generación por lugar, idioma, versión del prompt e intereses, guardada para todos | Lo que se generó una vez no se paga otra. Presupuesto diario y límite por dispositivo para el resto |
| Eventos y rutas de otros usuarios, a la fase 8 | La guía de la fase 7 se centra en sugerir, preparar y descubrir. Compartir rutas necesita un token de lectura aparte y, mejor, cuentas |

**Preguntas abiertas:**

- Nombre y marca definitivos.
- Proveedor de autenticación.
- Modelo de precios (B2B por rutas activas, por jugadores o por tipo de acciones).
- Uso de PostGIS desde v1.
- Estrategia de mapa base si el producto crece (cobro por teselas frente a sesiones, u otro proveedor de teselas).
- Cómo se comparten las rutas de usuario (C5, «Compartir enlace»): hará falta un token de lectura aparte del de edición.

---

## 18. Guía rápida del proyecto

```md
# Rumbo: guía rápida
- Plan completo: docs/PROJECT_PLAN.md · Diseño: docs/DESIGN.md · Producción: docs/DEPLOY.md · Seguridad: docs/SECURITY.md
- 3 módulos desacoplados: route-builder (creador) → geo-engine (motor) → event-system (eventos)
- geo-engine y event-system: TS puro, sin DOM/Vue/ArcGIS. Reloj, scheduler y fuente de posición inyectados.
- Contratos en packages/route-spec (Zod). Cambio incompatible = subir specVersion + migración + actualizar docs.
- Código y comentarios en inglés; UI en es/en/pt-PT (ADR 0001); docs en español.
- No pasar de fase sin tests en verde. Comandos: pnpm format:check · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm validate:routes
- Nunca secretos en el repo: .env locales ignorados y variables de Coolify. Claves de IA y geocodificación solo en apps/api.
- Desplegar solo cuando se pida: pnpm deploy:prod.
- README.md raíz = plantilla CSE 310 GIS Mapping (inglés).
```

---

## 19. Glosario

| Término | Significado |
|---|---|
| **RouteSpec** | Contrato de entrada del motor: la definición completa de una ruta |
| **RouteBundle** | RouteSpec + fichas de contenido; la unidad que se guarda, se descarga y se cachea |
| **Trigger** | Id de acción asociado a un evento (de punto o de ruta) |
| **Acción / ActionDef** | `{ type, params }`: qué ejecutar cuando se emite un trigger |
| **Handler** | Implementación de un tipo de acción (ficha, video, quiz...) |
| **Check-in** | Confirmación de llegada a un punto (tras la permanencia) |
| **Permanencia (dwell)** | Tiempo mínimo dentro de la zona para confirmar la llegada |
| **Histéresis** | Margen extra para salir de una zona; evita el parpadeo por ruido del GPS |
| **Corredor** | Segmento entre el último punto completado y el objetivo, usado para medir el desvío |
| **Snapshot** | Estado serializado del motor para persistir y recuperar un recorrido |
| **Fuente de posición** | GPS real, simulación o reproducción de un trayecto grabado |
| **Token de edición** | Prueba de propiedad de una ruta de usuario: 32 bytes que genera el dispositivo y viajan en `X-Edit-Token`; el servidor solo guarda su hash |
| **Probar ruta** | Recorrido de prueba de una ruta del creador: siempre simulado y aislado del recorrido real (sin snapshot, resumen, API ni analytics) |
| **Grounding** | El texto real en el que se apoya una ficha: el artículo de Wikipedia del lugar o, si no lo hay, los resultados de una búsqueda web. Sin él, la ficha dice que no hay información fiable |
| **Ficha verificada** | Ficha cuyo SHA-256 está en `ai_contents`, es decir, que generó este servidor. Es la única que acepta una ruta de usuario |
| **Trivia** | Pregunta rápida (`quiz`) dentro de una ficha; `ai_template` la puntúa con 10 puntos |
