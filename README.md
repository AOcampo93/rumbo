# Overview

**Rumbo** is a progressive web app for guided routes that come alive when you arrive. You pick (or create) a route and walk, run or ride it; when your phone's geolocation shows you have entered the zone of a point, the app triggers an experience for that place: an information card, an AI-written card with its sources, a video, a quiz, an external link or a 3D character in augmented reality that answers your questions out loud.

My goal as a software engineer is to build a small but solid location engine: a pure TypeScript core that turns a stream of GPS positions into arrival, deviation and idle events, decoupled from the map (ArcGIS) and from whatever action runs on arrival. Any action is a handler plus a view, so new kinds of experiences (the AR characters were the latest) plug in without touching the engine. The app is available in Spanish, English and European Portuguese.

What the app does today:

- **Explore:** an ArcGIS map with two views. _Points_ shows every stop of the routes nearby plus points of interest from Wikidata, with popups, category symbols and filters. _Routes_ draws each route as a line coloured by activity. A list of routes with cover photos sits below the map.
- **Routes:**
  - two curated routes in Leiria, Portugal ("Historic Leiria" and "Leiria Castle");
  - routes users create in the app, with place cards written by AI from Wikipedia and always showing their sources;
  - community routes, which their authors may publish anonymously; nearby users can see them and anyone can report one.
- **Run a route:**
  - a free mode (any order) and a challenge mode (in order, with a time limit and deviation warnings);
  - arrival alerts, a snapshot that recovers the run after the tab is closed, and a simulation mode that moves a fake GPS position along the route so the whole experience can be tried from a desk.
- **AR characters:**
  - Animated 3D characters (a craftsman, two soldiers fighting, King Afonso Henriques, a sentinel and a priest) appear at the place in augmented reality and talk with the visitor through Gemini Live.
  - Each one plays its role from a sourced knowledge sheet and always speaks the app's language.
  - Android runs WebXR in the browser; iPhone uses an App Clip.
  - The "Leiria Castle" route puts one scene at each of its five stops: the gate, the main square, the Traitor's Gate, the royal palace and the church.

[Software Demo Video](#) _(coming soon)_

# Development Environment

- TypeScript (strict) in a pnpm 12 monorepo on Node.js 24 LTS. Route definitions are validated with shared Zod schemas (`packages/route-spec`).
- **Core packages, pure TypeScript with no DOM:**
  - `geo-engine` turns positions into zone and route events;
  - `event-system` runs the action of each event.
  - Clock, scheduler and position source are injected, so both are tested with simulated GPS tracks.
- **Web:**
  - Vue 3, Vite, Pinia and vue-i18n.
  - ArcGIS Maps SDK for JavaScript 5 (`<arcgis-map>` component).
  - An installable PWA with a Workbox service worker and Web Push.
- **AR page:**
  - three.js (glTF models compressed with Draco and WebP) and WebXR (`immersive-ar` with hit-test and DOM overlay).
  - On iPhone, Needle's App Clip.
  - Characters were modelled from AI concept art, then rigged and animated with Mixamo and Blender.
- **API:**
  - Fastify 5, Drizzle ORM and PostgreSQL with PostGIS.
  - A WebSocket proxy to the Gemini Live API for the characters' voices, so API keys never reach the browser.
- **Tests:** Vitest (unit, scenario and API integration tests against a real PostgreSQL in Docker) and Playwright (end-to-end).
- **CI and hosting:** GitHub Actions; Docker containers on a VPS managed with Coolify.

```bash
pnpm install
pnpm dev        # web on http://localhost:5173, API on http://localhost:3000
pnpm test       # unit, scenario and API integration tests (the latter need Docker)
pnpm validate:routes     # checks the curated routes (schema, overlapping zones, radii)
pnpm build && pnpm e2e   # end-to-end tests against the production build
```

The API applies its migrations and loads the curated routes on start. Its OpenAPI documentation is served at `/api/v1/docs`.

Without an ArcGIS API key the map uses Esri's public tile services. To use the vector basemap styles, put a key restricted to your domains in `apps/web/.env` (`VITE_ARCGIS_API_KEY`). The AI place cards and the characters' voices need their own keys in `apps/api/.env` (see `docs/DEPLOY.md`). The 3D models are not in the repository because of their licences, so the AR page needs them copied into `apps/web/public/ra_test/models/`.

# Useful Websites

- [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/)
- [Wikidata Query Service](https://query.wikidata.org/)
- [Vue.js documentation](https://vuejs.org/guide/introduction.html)
- [Fastify documentation](https://fastify.dev/docs/latest/)
- [MDN: Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- [MDN: WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)
- [three.js documentation](https://threejs.org/docs/)
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live)
- [Wikimedia API portal](https://api.wikimedia.org/wiki/Main_Page)

# Future Work

- Version 2 (planned in `docs/PROJECT_PLAN_V2.md`):
  - user accounts;
  - hosted challenges with leaderboards;
  - points and badges, with server-side anti-cheat checks.
- AR treasure chests that drop a coin (points) or a scroll (a clue to the next stop), validated by the server so they also work from the iPhone App Clip.
- More characters and narrated AR scenes for other places.
- GPX import and export for sport routes.
- Native wrapper for background geofencing.
