# Overview

**Rumbo** is a progressive web app for guided routes that come alive when you arrive. You pick (or create) a route and walk, run or ride it; when your phone's geolocation shows you have entered the zone of a point, the app triggers an experience for that place: an information card, a video, a quiz or an external link.

My goal as a software engineer is to build a small but solid location engine: a pure TypeScript core that turns a stream of GPS positions into arrival, deviation and idle events, decoupled from the map (ArcGIS) and from whatever action runs on arrival. The app is available in Spanish, English and European Portuguese.

The map uses the ArcGIS Maps SDK for JavaScript and shows more than 20 markers with popups, category-specific symbols and filters. Place content comes from Wikipedia, Wikidata and Wikimedia Commons, with attribution.

[Software Demo Video](#) *(coming soon)*

# Development Environment

- TypeScript (strict) in a pnpm 12 monorepo on Node.js 24 LTS.
- Web: Vue 3, Vite and the ArcGIS Maps SDK for JavaScript.
- API: Fastify on Node.js with PostgreSQL.
- Tests: Vitest. CI: GitHub Actions. Hosting: Docker containers on a VPS managed with Coolify.

```bash
pnpm install
pnpm dev        # web on http://localhost:5173, API on http://localhost:3000
pnpm test
```

# Useful Websites

- [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/)
- [Vue.js documentation](https://vuejs.org/guide/introduction.html)
- [Fastify documentation](https://fastify.dev/docs/latest/)
- [MDN: Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- [Wikimedia API portal](https://api.wikimedia.org/wiki/Main_Page)

# Future Work

- Route planner with AI-generated place cards grounded in Wikipedia.
- 3D and augmented-reality experiences at points of interest.
- User accounts and route sharing.
- GPX import and export for sport routes.
- Native wrapper for background geofencing.
