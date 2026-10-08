# Rumbo: motor de rutas con check-in por geolocalización

> **Nombre provisional:** Rumbo. **Estado:** fases 0 a 4 completadas (base, contratos, motor, sistema de eventos y la web para recorrer rutas); fase 5 (backend mínimo) terminada en código, a falta de desplegarla. Producción activa en https://rumbo.arturoocampo.com ([DEPLOY.md](DEPLOY.md)).
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
| Contenido al llegar | Interacciones a medida: quiz, video, redirect, 3D/RA (futuro) | Plantilla generativa: ficha creada con IA a partir de fuentes reales (Wikipedia/Wikimedia) |
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
│   ├─ rutas y contenidos (CRUD)            ├─ geocodificación (proxy ArcGIS)                     │
│   ├─ generación de contenido con IA       ├─ recorridos (runs) y analytics privados             │
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
| IA | Interfaz `AiProvider` con una implementación por defecto (p. ej. API de Anthropic); modelo configurable por variable de entorno |
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
│  ├─ SECURITY.md             # secretos y repositorio público
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
- Un trigger apunta a una acción que no existe en `actions`.
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
  sources: { title: string; url: string }[];  // fuentes usadas (grounding)
  generated?: { by: 'ai' | 'human'; model?: string; promptVersion?: string; at: string };
  status: 'draft' | 'approved';
}
```

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
  interests?: string[];              // para la IA: 'history', 'art', 'food'...
  timeLimit?: number | null;         // solo challenge
  places: DraftPlace[];              // el ORDEN del array es el orden de la ruta
  settingsOverrides?: Partial<RouteSettings>;
}

export interface DraftPlace {
  tempId: string;
  name: string;
  position: LatLng;
  address?: string;
  externalId?: string;               // p. ej. QID de Wikidata o id del geocodificador
  category?: PointCategory;
  radius?: number;
  required?: boolean;
  contentRef?: string;
}

buildRouteSpec(draft, opts: { source: 'user'; idFactory?: () => string })
  → { spec: RouteSpec; warnings: Issue[] }
summarizeRoute(spec)
  → { pointCount, distanceMeters, estimatedMinutes, centroid, bbox }
```

**Reglas de `buildRouteSpec`:**

- Genera `id` (slug + sufijo corto) e ids de punto estables a partir del nombre.
- Asigna `order` según la posición en el array.
- Acciones por defecto en rutas de usuario: cada punto tiene `onEnter → content_<pointId>`, de tipo `ai_template` si hay `contentRef` y de tipo `info_sheet` (nombre + dirección) si no lo hay.
- Triggers de ruta por defecto: `onDeviation`, `onIdle`, `onOutOfOrder` y `onTimeout` apuntan a acciones `decision` con su preset.
- Siempre devuelve un spec que pasa `validateRouteSpec`. Si no puede, lanza un error con los issues.

**Wizard (la UI está detallada en `docs/DESIGN.md`):**

1. **Datos:** nombre, zona, modo, actividad, intereses y límite de tiempo (reto). No se pregunta el idioma: es el de la app, y en él se generan las fichas de IA.
2. **Lugares:** búsqueda con autocompletado (geocodificación vía backend), punto añadido tocando el mapa, lista **reordenable arrastrando**, radio y obligatoriedad por punto, y vista previa del trazado con distancia y duración estimadas.
3. **Contenido IA:** generación por punto (sección 12), con revisión y edición antes de guardar. Se puede saltar y usar la ficha básica.
4. **Revisar y simular:** validación, advertencias y botón **Probar ruta** (motor con fuente simulada).
5. **Guardar:** `POST /api/v1/routes`. Mientras no exista backend, se guarda en IndexedDB.

El borrador se guarda automáticamente en IndexedDB en cada paso para no perder datos.

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
| `ai_template` | Ficha generativa (rutas de usuario) | `{ contentRef }` → pinta `PointContent` |
| `video` | Video del lugar | `{ provider: 'youtube' \| 'file', id?, url?, title? }` |
| `quiz` | Pregunta con puntos | `{ question, options: string[], correctIndex, points, explanation? }` |
| `redirect` | Web externa (con confirmación) | `{ url, label }` |
| `toast` | Aviso breve no bloqueante | `{ messageKey \| message, icon?, durationMs? }` |
| `decision` | Interrupciones: Continuar / Pausar / Terminar | `{ preset: 'deviation' \| 'idle' \| 'out_of_order' \| 'timeout' } \| { title, body?, primaryLabel? }` |
| `three_scene` | *(Futuro)* Escena Three.js | Stub en v1, registrado con `load()` diferido |
| `ar_scene` | *(Futuro)* RA (WebXR / model-viewer) | No se implementa en v1 |

**Acciones personalizadas en 3 idiomas:** los textos de los `params` son `LocalizedText`. Eso incluye la pregunta, las opciones y la explicación del quiz; el `label` del redirect; el `title` y el `body` de `info_sheet`; y el `message` del toast. Así, una acción escrita por nosotros (no por la IA) puede traer español, inglés y portugués, y el handler muestra el idioma activo.

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
├─ services/                # api (cliente tipado con api-contract), contentCache (IndexedDB),
│                           # analytics, notifications, wakeLock, audio, permissions, installPrompt
├─ map/                     # RouteMap.vue (envuelve <arcgis-map>) + capas, symbols.ts, popup.ts, basemap.ts
├─ engine/                  # useGeoEngine.ts: motor + fuentes + persistencia de snapshots
├─ events/                  # setupEventSystem.ts, uiAdapter.ts, feedbackAdapter.ts
├─ handlers/                # vistas de los handlers: info-sheet, ai-template, video, quiz, decision, coming-soon, error
├─ views/                   # Onboarding, Home, MyRoutes, RouteDetail, RunPrepare, Run, RunSummary,
│                           # create/(Details, Places, Content, Review, Done), Settings
├─ components/              # BottomSheet, RouteCard, ModeBadge, StatChip, PointListItem, HudTarget,
│                           # ProgressBar, DecisionSheet, Stepper, PlaceSearch, GpsIndicator, MiniRunBar...
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
| `/my-routes` | Mis rutas |
| `/routes/:routeId` | Detalle de ruta |
| `/routes/:routeId/prepare` | Preparación y permisos |
| `/run` | Recorrido en curso (una ruta activa a la vez). Acepta `?point=<id>` desde una notificación |
| `/run/summary` | Resumen del último recorrido |
| `/create/details` → `/create/places` → `/create/content` → `/create/review` → `/create/done` | Wizard del creador |
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
- **Popup (requisito del curso):** `PopupTemplate` con título, imagen, categoría, estado, orden y distancia. En modo libre añade la acción **"Ir a este punto"** (`setTarget`).
- **Filtro (stretch):** por ruta, categoría, modo y estado, alternando `graphic.visible`.
- **Idioma:** al cambiar de idioma se llama a `intl.setLocale()` del SDK, para los controles y popups de ArcGIS. El contenido de los popups se genera con el idioma activo.
- **Cámara:** modo seguir activado durante el recorrido. Si el usuario arrastra el mapa, se desactiva y aparece el botón **Recentrar**.
- **Rendimiento:** el SDK de ArcGIS es pesado, así que va con *code-splitting* en las vistas con mapa y se precarga mientras el usuario está en Inicio. El estado del motor llega al mapa como mucho una vez por frame (`requestAnimationFrame`).

### 10.4 Pantalla de Explorar como mapa (requisito de 20+ marcadores)

La vista **Mapa** de Inicio muestra **todos los puntos de todas las rutas curadas** (más de 20), con iconos por categoría, color por ruta, popup y panel de filtros. Esto cubre los requisitos del curso en una sola vista; cada detalle de ruta muestra además sus propios puntos.

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
  - Las imágenes del contenido van a Cache Storage.
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
- **Usos:** el video del curso, el paso 4 del creador y los tests e2e.

### 10.8 Identidad anónima del dispositivo

- `deviceId`: UUID aleatorio generado en el primer arranque y guardado en IndexedDB.
- Se envía como `X-Device-Id`. **No es autenticación**: sirve para limitar el uso y para la propiedad provisional de las rutas.
- Al crear una ruta, el servidor devuelve un `editToken` que se guarda localmente por ruta.

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

---

## 11. Backend (`apps/api`) en el VPS

### 11.1 Endpoints v1 (`/api/v1`, OpenAPI generado en `/api/v1/docs`)

- **Mismo origen que la web** (`https://rumbo.arturoocampo.com/api`): no hace falta CORS.
- **Idioma:** el cliente envía `Accept-Language` con el idioma activo.
- **Errores:** devuelven un código (`{ code }`) que traduce el cliente, nunca texto para mostrar.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado y versión |
| GET | `/routes?source=&mode=&activity=&q=&near=lat,lng` | Lista de `RouteSummary` |
| GET | `/routes/:id` | `RouteBundle` (spec + contents) |
| POST | `/routes` | Crea a partir de un `RouteBundle` validado → `{ id, editToken }` |
| PUT | `/routes/:id` | Actualiza (cabecera `X-Edit-Token`) |
| DELETE | `/routes/:id` | Borra (cabecera `X-Edit-Token`) |
| GET | `/geo/suggest?q=&near=` | Autocompletado (proxy de geocodificación) |
| GET | `/geo/resolve?key=` | Lugar resuelto `{ name, address, position, category, externalId }` |
| POST | `/content/generate` | Genera un `PointContent` (borrador) con IA, en el `locale` pedido (obligatorio) |
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

### 11.2 Base de datos (Drizzle, PostgreSQL)

| Tabla | Columnas principales |
|---|---|
| `routes` | `id` (slug, pk), `spec` jsonb, `spec_version`, `spec_hash`, `name`, `mode`, `activity`, `source`, `locale`, `point_count`, `distance_m`, `est_minutes`, `centroid_lat`, `centroid_lng`, `bbox` jsonb, `status` (`published`\|`draft`\|`archived`), `owner_device_id`, `owner_user_id` (futuro, null), `edit_token_hash`, `created_at`, `updated_at` |
| `point_contents` | `id` (pk), `route_id` (fk), `point_id`, `locale`, `content` jsonb, `status`, timestamps. Único (`route_id`, `point_id`, `locale`) |
| `content_cache` | `cache_key` (pk), `content` jsonb, `sources` jsonb, `hits`, `created_at` |
| `ai_generations` | `id`, `device_id`, `cache_key`, `locale`, `model`, `prompt_version`, `input_tokens`, `output_tokens`, `cost_estimate`, `status`, `latency_ms`, `created_at` |
| `runs` | `id` (uuid), `route_id`, `spec_hash`, `device_id`, `mode`, `status` (`running`\|`finished`\|`cancelled`\|`abandoned`), `started_at`, `ended_at`, `elapsed_ms`, `completed_points`, `total_points`, `score`, `client_info` jsonb |
| `analytics_events` | `id` bigserial, `device_id`, `run_id` (null), `name`, `props` jsonb, `client_ts`, `server_ts`. Índice (`name`, `server_ts`) |
| `devices` | `id`, `first_seen`, `last_seen`, `platform` (aproximada), `pwa_installed` |

- El `spec` en jsonb es la **fuente de verdad**. Las columnas extraídas (nombre, modo, métricas, centroide) sirven para listar y filtrar sin abrir el JSON.
- **Futuro:** tabla `users`, sesiones, migración de `owner_device_id` → `owner_user_id`, consultas espaciales con PostGIS ("rutas cerca de mí").

### 11.3 Seguridad

- Mismo origen que la web, así que sin CORS. `@fastify/helmet` y límite de tamaño del body (1 MB).
- Rate limit por IP y `X-Device-Id`. Más estricto en `/content/generate` y `/geo/*`.
- Validación Zod de todo lo que entra. Los `RouteBundle` se validan con `validateRouteSpec` y `PointContent` en el servidor; nunca se confía en el cliente.
- `editToken`: 32 bytes aleatorios. Se guarda solo su hash SHA-256 y se compara en tiempo constante.
- Secretos únicamente en variables de entorno: en Coolify, como variables solo de ejecución, y en local, en `.env` que git ignora. En el repo solo hay `.env.example`. El repo es público: reglas completas en [SECURITY.md](SECURITY.md).
- Logs (pino) sin datos personales y sin coordenadas.

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
ARCGIS_API_KEY_SERVER=          # geocodificación de direcciones (solo para mostrar, nunca guardar)
GEOCODING_PROVIDER=wikidata     # búsqueda de lugares con coordenadas guardables (ver 12.3)
AI_PROVIDER=anthropic
AI_API_KEY=
AI_MODEL=
AI_DAILY_BUDGET_USD=5
AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY=40
WIKIMEDIA_USER_AGENT="Rumbo/0.1 (contacto: <email>)"
ANALYTICS_ENABLED=true
```

### 11.5 Despliegue (Coolify en Contabo)

En marcha desde el 2026-10-07. El detalle operativo está en [DEPLOY.md](DEPLOY.md).

- **Servicios** (proyecto «Rumbo» de Coolify):
  - `rumbo-web`: build estático servido por nginx;
  - `rumbo-api`: Node 24;
  - `rumbo-db`: PostgreSQL 17 + PostGIS 3.5, con volumen persistente y sin puerto público.
- **Un solo origen:** `https://rumbo.arturoocampo.com` para la web y `/api` para la API, con HTTPS de Let's Encrypt vía Traefik.
- **Ramas:** `main` es desarrollo y `production` es lo desplegado. Desplegar es promover a `production` un commit de `main` con la CI en verde (`pnpm deploy:prod`), y solo cuando lo pide el responsable del proyecto.
- **Migraciones:** la API aplica las pendientes al arrancar (§11.6).
- **Backups:** dump diario de Postgres en Coolify desde el 2026-10-07 ([DEPLOY.md](DEPLOY.md)).
- **CI:** GitHub Actions ejecuta formato, lint, typecheck, tests (los de la API, contra un PostgreSQL en contenedor), `validate:routes`, build, los e2e, las imágenes Docker y el escaneo de secretos.

### 11.6 Precisiones de la implementación (fase 5)

- **Contrato (`packages/api-contract`):** los DTOs en Zod que comparten la API (validación de entrada y OpenAPI) y la web (tipos): `RouteSummary`, los filtros del listado, el inicio y el cierre de un recorrido, el lote de analytics y los códigos de error.
- **Base de datos:** Drizzle ORM sobre `pg`. El esquema está en `apps/api/src/db/schema.ts` y las migraciones SQL en `apps/api/drizzle`.
  - Respecto a la tabla de §11.2: `point_contents` usa `content_ref` (la clave de `RouteBundle.contents`) en lugar de `point_id`; `routes` guarda además `locales` (idiomas completos); `runs` guarda `simulated` y `locale`.
  - `content_cache` y `ai_generations` llegan con la fase 7.
- **Arranque:**
  - aplica las migraciones pendientes y carga las rutas de `data/routes` (inserta las nuevas, reemplaza las que cambiaron y deja igual el resto);
  - si Postgres no responde, arranca igual y reintenta cada 10 s, mientras los endpoints de datos devuelven `503 { code: "unavailable" }`.
- **Endpoints de la fase:** `GET /routes`, `GET /routes/:id`, `POST /runs`, `PATCH /runs/:id`, `POST /analytics/batch` y `GET /health`.
  - **Listado:**
    - filtra por origen, modo y actividad en SQL;
    - busca en nombre y resumen, en todos los idiomas y sin tildes;
    - ordena por cercanía con `near=lat,lng`.
  - **Detalle:** lleva `ETag` y responde `304` si el cliente ya tiene esa versión.
  - **Cierre de un recorrido:** solo puede hacerlo su dispositivo, y es idempotente (la app reintenta los cierres que no pudo enviar).
  - **Analytics:** rechaza propiedades con forma de posición (`lat`, `lng`…).
  - La documentación OpenAPI está en `/api/v1/docs`.
- **Seguridad:** `@fastify/helmet`, 1 MB por petición y 300 por minuto por dispositivo o IP (`trustProxy` detrás de Traefik); 30 por minuto en recorridos y analytics. Los logs guardan solo la ruta, sin la *query* (podría llevar una posición).
- **Build:** esbuild empaqueta la API en `dist/server.js`, con los paquetes del workspace compilados dentro; las dependencias de npm se instalan en la imagen. La imagen incluye las migraciones y `data/routes`.
- **Web:**
  - Carga las rutas de la API y, si no responde, usa las que lleva dentro.
  - Envía `Accept-Language` y el identificador anónimo del dispositivo (un UUID en IndexedDB).
  - Registra el inicio y el cierre de cada recorrido sin hacer esperar al usuario. Los cierres que no se pudieron enviar se reintentan al abrir la app.
  - Los eventos de analytics de un recorrido llevan su `runId`.
- **Tests:** 31 de integración de la API contra un PostgreSQL real (Testcontainers; en local hace falta Docker). Usan `postgres:17-alpine` porque la imagen de PostGIS no tiene versión ARM y la v1 no hace consultas espaciales.

---

## 12. Generación de contenido con IA (solo en el servidor)

### 12.1 Principios

- Se genera **al crear la ruta**, no al llegar al lugar. Así no hay espera en el momento clave, no hay coste por visita y funciona offline.
- **Anclado en fuentes reales:** el texto sale de Wikipedia/Wikidata y la IA solo resume y estructura. Si no hay información suficiente, la ficha es más corta; **nunca se inventan datos**.
- **Imágenes reales, no generadas:** Wikimedia Commons con autor y licencia (CC0, dominio público, CC BY, CC BY-SA). Las imágenes generativas solo se usarían para ilustraciones decorativas, y en v1 no hay.
- **Transparencia:** la ficha muestra "Contenido generado con IA a partir de Wikipedia" con enlaces a las fuentes.
- El usuario **revisa y puede editar** cada ficha antes de guardar (`status: 'draft'` → `'approved'`).
- **En el idioma del usuario:** cada generación usa el idioma de la app, y lo generado se queda en ese idioma aunque el usuario cambie después ([ADR 0001](adr/0001-multilenguaje.md)).

### 12.2 Pipeline de `POST /content/generate`

```
Entrada: { name, position, locale (obligatorio: es | en | pt), interests?, externalId? }
1. Resolver entidad: Wikipedia geosearch (radio ~500 m) + coincidencia de nombre → título + QID de Wikidata
2. Texto: el artículo del idioma pedido, vía los sitelinks del QID (respaldo: en → es → pt).
   La ficha se escribe siempre en el idioma pedido, aunque la fuente esté en otro
3. Imágenes: imágenes de la página / Commons con extmetadata (autor, licencia); filtrar licencias compatibles
4. LLM con salida estructurada (JSON Schema derivado de Zod, sin campos de media):
   - prompt versionado (PROMPT_VERSION), temperatura baja
   - instrucción: usar SOLO el texto de grounding; idioma = locale; tono cercano; adaptar a intereses
5. Validar con Zod → un reintento con los errores → si vuelve a fallar: ficha mínima (nombre + extracto)
6. Combinar con imágenes y fuentes → PointContent { status: 'draft', generated: { by: 'ai', ... } }
7. Caché por clave `${QID || hash(nombre+coords)}:${locale}:${PROMPT_VERSION}` + registro en ai_generations
```

- **Video en v1:** campo manual de URL de YouTube en el paso 3. La búsqueda automática (YouTube Data API) queda para el futuro.
- **Wikimedia:** enviar un `User-Agent` descriptivo con contacto (lo exige su política de uso) y respetar sus límites.
- **Coste:** presupuesto diario global (`AI_DAILY_BUDGET_USD`) y límite por dispositivo. Al superarlo se devuelve `429` y la UI ofrece la ficha básica.

### 12.3 Búsqueda de lugares y coordenadas (paso 2 del creador)

**Términos de ArcGIS** (comprobados en octubre de 2026):

- Geocodificación **sin guardar**: 20.000 al mes gratis. Sus resultados solo pueden mostrarse de forma temporal (p. ej. centrar el mapa).
- Geocodificación **guardada** (`forStorage=true`): es obligatoria si el resultado se persiste en la BD, **no tiene capa gratuita** ($4 por 1.000) y no está disponible sin pay-as-you-go.

**Decisión:** las coordenadas que se guardan **nunca salen del geocodificador de ArcGIS**.

- **Wikidata (CC0)** para monumentos y POIs conocidos. Es el proveedor de búsqueda por defecto del creador (`GEOCODING_PROVIDER=wikidata`) y además da el QID para el pipeline de IA.
- **Toque del usuario en el mapa** para puntos personalizados.
- **ArcGIS Geocoding** (vía backend, `forStorage=false`) solo para buscar direcciones y **mover el mapa** a la zona; después el usuario fija el punto con un toque.
- Todo detrás de una interfaz `GeocodingProvider`, para poder cambiar de proveedor por configuración.

---

## 13. Analytics y métricas privadas

- **Consentimiento:** se pide en el onboarding y se puede cambiar en Ajustes. Sin consentimiento no se envían eventos de producto.
- **Sin coordenadas:** los eventos no incluyen posiciones. Las trazas GPS solo se subirán en el futuro con opt-in explícito (rankings o antitrampas).
- **Envío:** en lotes con `navigator.sendBeacon` al pasar a segundo plano, o cada 30 s.
- **Eventos v1:**
  - **Uso general:** `app_open`, `onboarding_completed`, `pwa_installed`, `route_viewed`.
  - **Recorrido:** `run_started`, `permission_result` (`{ type, result }`), `point_reached` (`{ pointId, manual }`), `point_completed` (`{ pointId, handlerType, status, ms }`), `interruption_shown` (`{ type }`), `decision_made` (`{ type, decision }`), `run_paused`, `run_resumed`, `run_cancelled`, `run_finished` (`{ elapsedMs, completed, total }`), `gps_weak`.
  - **Creador:** `creator_step_completed` (`{ step }`), `route_created`, `content_generated` (`{ ok, ms }`).
  - **Errores:** `error` (`{ code }`).
- **Métricas internas** (consultas SQL; panel privado en el futuro): rutas iniciadas frente a completadas, abandono por punto, tiempo medio por punto, frecuencia de desvíos, porcentaje de GPS débil por ruta, coste de IA por ruta creada y plataformas.

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
- `route-builder`: un draft produce siempre un spec válido; `summarizeRoute` es correcto.
- `event-system`: orden y prioridad de la cola, deduplicación, interrupciones obsoletas, decisiones aplicadas al motor y respaldo cuando un handler falla.
- **i18n:**
  - los tres catálogos tienen las mismas claves y los mismos parámetros;
  - `resolveText` sigue su cadena de respaldo;
  - distancias, tiempos y fechas se formatean bien en cada idioma.
- API: tests de integración de endpoints (Postgres en contenedor de test) y validación de bundles.
- **e2e (Playwright, Chromium):**
  - Recorrer "Leiria histórica" en simulación.
  - Reto con un punto fuera de orden.
  - Desvío → Pausar → Reanudar.
  - Cancelar.
  - Recargar a mitad → "Continuar recorrido".
  - Mapa Explorar con 20+ marcadores, popup y filtro.
  - Idioma: elegir PT en el primer arranque → recargar → sigue en PT → cambiar a EN en Ajustes a mitad de recorrido, sin recargar y sin alterar el motor.
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

### Fase 5: Backend mínimo y despliegue (P1)

- [x] Fastify, Drizzle, migraciones, seed, `GET /routes`, `GET /routes/:id`, `POST /runs`, `PATCH /runs/:id` y `POST /analytics/batch` (2026-10-08).
- [x] Despliegue en Coolify (web + api + postgres) con HTTPS. Se adelantó a la fase 0.
- **DoD:** la app en producción carga las rutas desde la API. **Pendiente del despliegue.**
  - En local ya funciona de punta a punta: la web carga las rutas de la API, y la API registra el inicio y el cierre del recorrido en Postgres.
  - Precisiones de la implementación en el §11.6.

### Fase 6: Creador en la web (P1)

- [ ] Wizard pasos 1, 2, 4 y 5: geocodificación vía backend, reordenar, radios, simulación y guardado (`POST /routes`, con IndexedDB como respaldo).
- **DoD:** crear una ruta, simularla y recorrerla de principio a fin.

### Fase 7: Contenido IA (P1 → P2)

- [ ] `POST /content/generate` (pipeline de 12.2) en el idioma del usuario, paso 3 del wizard y handler `ai_template` con datos reales.
- **DoD:** ruta de usuario con fichas generadas, revisadas y visibles al llegar, incluso sin conexión.

### Fase 8: Futuro (P2)

- [ ] Cuentas de usuario y propiedad real de las rutas.
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

**Preguntas abiertas:**

- Nombre y marca definitivos.
- Proveedor de autenticación.
- Modelo de precios (B2B por rutas activas, por jugadores o por tipo de acciones).
- Uso de PostGIS desde v1.
- Estrategia de mapa base si el producto crece (cobro por teselas frente a sesiones, u otro proveedor de teselas).

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
