# Despliegue a producción

## Resumen

| | |
|---|---|
| Web | https://rumbo.arturoocampo.com → app `rumbo-web` |
| API | https://rumbo.arturoocampo.com/api → app `rumbo-api` |
| Base de datos | `rumbo-db`: PostgreSQL 17 + PostGIS 3.5, solo en la red interna |
| Plataforma | Coolify 4 en un VPS compartido con otros proyectos; Traefik v3 con Let's Encrypt |
| Código | GitHub `AOcampo93/rumbo`, conectado con la GitHub App de Coolify |

Todo vive en el proyecto **Rumbo** de Coolify (entorno `production`). El VPS aloja otros proyectos: no se toca nada fuera de este proyecto ni la configuración global de Coolify o Traefik.

## Ramas y flujo

- **`main`**: desarrollo. La CI (GitHub Actions) corre en cada push: typecheck, tests, build y las dos imágenes Docker.
- **`production`**: lo que está desplegado. Coolify construye las dos apps desde esta rama.
- **Un push no despliega nada por sí solo.** La GitHub App con la que Coolify lee el repositorio no tiene webhook, así que GitHub no le avisa de los push. Esa App es de todo el servidor y la comparten otros proyectos: si se le activara el webhook, sus apps también se desplegarían solas en cada push. Por eso no se toca, y el despliegue lo lanza `pnpm deploy:prod` por la API de Coolify.
- **Qué se despliega:** solo las apps con cambios en sus archivos desde el commit que sirven: `apps/web/**` o `apps/api/**`, `packages/**`, `data/**`, el lockfile, la configuración del workspace o `.dockerignore`. Las dos apps vigilan `data/**`: la web empaqueta las rutas curadas y los lugares de interés, y la API siembra las rutas en la base de datos al arrancar. La lista está en `scripts/deploy-prod.sh` y también en las *Watch Paths* de cada app en Coolify, por si algún día se activa el webhook: hay que mantenerlas iguales.
- **Primero la API y después la web** (desde el 2026-10-09). El script no despliega la web hasta que la API nueva sirve el commit y Coolify da su despliegue por terminado; si la API falla, la web se queda como estaba. Así la web nueva nunca habla con la API vieja: desde la fase 7.2 manda `visibility`, que una API anterior rechaza. La API nueva sí atiende a la web vieja mientras tanto. Además, la web tolera una API sin los endpoints de rutas de usuario (`not_found`): la ruta se queda pendiente y se reintenta.
- **Solo se despliega cuando lo pide el responsable del proyecto.**

Para desplegar:

```bash
pnpm deploy:prod             # o: bash scripts/deploy-prod.sh
pnpm deploy:prod --dry-run   # todas las comprobaciones y el plan, sin push ni despliegue
```

El script:

1. Exige el árbol limpio y que `HEAD` sea `origin/main`.
2. Comprueba que la CI de ese commit terminó en verde.
3. Decide qué apps desplegar comparando con el commit que sirve cada una: la API lo dice en `/api/v1/health` y la web en `/version.json`. Si solo cambian docs o CI, no se redespliega nada. Por eso se puede repetir sin riesgo: si un despliegue falló o no llegó a lanzarse, lo intenta de nuevo.
4. Hace *fast-forward* de `production` (nunca `--force`).
5. Pide a Coolify que despliegue la API y espera hasta que sirva el nuevo commit; después, igual con la web. Si un despliegue falla en Coolify, se detiene y da su identificador para buscar el log (y si es el de la API, no despliega la web).

Necesita una configuración local, fuera del repo y con permisos 600, en `~/.config/rumbo/`:

- `coolify-auth.header`: el token de la API de Coolify como cabecera de curl (`Authorization: Bearer …`).
- `deploy.env`: `COOLIFY_SSH_HOST` (el alias SSH del VPS), `COOLIFY_API_APP` y `COOLIFY_WEB_APP` (el UUID de cada app en Coolify).

El script llega a la API de Coolify por un túnel SSH al VPS. Si no hay uno abierto, lo abre él y lo cierra al terminar.

## Rutas: un solo origen

La web y la API comparten dominio. La PWA llama a `/api/v1/…` sin CORS, y el service worker y las cookies quedan en el mismo origen.

- Traefik envía `Host(rumbo.arturoocampo.com) && PathPrefix(/api)` a la API y el resto a la web.
- La API declara sus rutas como `/v1/…` y quita `/api` si aún llega (`rewriteUrl` en `apps/api/src/app.ts`). Funciona igual con o sin el ajuste «Strip Prefixes» de Coolify y detrás del proxy de Vite en desarrollo.
- Health checks:
  - **API:** `http://127.0.0.1:3000/api/v1/health`. Devuelve versión, commit servido y estado de la BD, y siempre 200. El host es `127.0.0.1` y no `localhost` porque la imagen Alpine no trae `curl` y el `wget` de busybox resuelve `localhost` como IPv6 (`::1`), mientras que la API escucha en IPv4.
  - **Web:** `/`. La imagen de nginx sí incluye `curl`.
- Las dos apps informan del commit que sirven: la API en `/api/v1/health` y la web en `/version.json`. Coolify inyecta `SOURCE_COMMIT` en ejecución.
- La documentación OpenAPI está en `/api/v1/docs`.
- **La IP del cliente** (para los límites por IP, ver [`docs/SECURITY.md`](SECURITY.md)) es la última entrada de `X-Forwarded-For`, la que añade Traefik. La API confía en un solo salto, y solo si la conexión viene de una red privada (`trustProxyHop`, en `apps/api/src/limits.ts`). Es correcto mientras el DNS no pase por el proxy de Cloudflare («solo DNS», nube gris, como ahora). Con la nube naranja habría dos saltos: los límites contarían por dirección de Cloudflare y no por cliente, y habría que revisar esa función.

## Cabeceras de seguridad de la web

`apps/web/nginx/default.conf.template` envía estas tres cabeceras en todas las respuestas de la web, con `always`, así que también salen en las respuestas de error:

| Cabecera | Valor | Para qué |
|---|---|---|
| `Content-Security-Policy` | `object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` | Sin plugins, sin `<base>` ajeno, sin marcos de otras webs y formularios solo a este sitio |
| `X-Content-Type-Options` | `nosniff` | El navegador no adivina el tipo de un archivo |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | A otros sitios solo llega el origen, nunca la URL completa |

- nginx no hereda los `add_header` de un nivel superior en un `location` que tiene los suyos (el `Cache-Control`), así que las tres cabeceras se repiten en cada `location`: `/version.json`, `/assets/` y `/`. Al añadir un `location` con su propio `add_header`, hay que repetirlas.
- Todavía no hay una CSP de scripts, imágenes y conexiones: antes hay que mapear lo que necesita el SDK de ArcGIS (workers desde `blob:`, wasm…).
- Para comprobarlas tras un despliegue: `curl -sI https://rumbo.arturoocampo.com/ | grep -iE 'content-security|x-content-type|referrer'`.

## Variables de entorno

Las reglas completas sobre secretos están en [`docs/SECURITY.md`](SECURITY.md).

- En producción se gestionan en Coolify, **nunca en el repo**. En local, en `apps/*/.env`, que git ignora. Las plantillas son los `.env.example`.
- **API:** `DATABASE_URL` (URL interna de `rumbo-db`) y `LOG_LEVEL`. Todas las demás son opcionales y tienen valor por defecto (tabla de abajo). Las que lleven secretos se marcan **solo de ejecución** (no de build), para que no queden en los metadatos de la imagen. Para encender la guía con IA (fase 7) hacen falta además `AI_PROVIDER=anthropic` y `AI_API_KEY` (sección «IA (fase 7)»). Para las notificaciones push (fase 7.1) hacen falta `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (sección «Notificaciones push (fase 7.1)»).
- **Web:** las `VITE_*` se inyectan en el bundle durante el build. Son públicas por definición: nunca secretos.

Variables opcionales de la API, con su valor por defecto. Ninguna es un secreto, salvo `ARCGIS_API_KEY_SERVER`, `AI_API_KEY`, `VAPID_PRIVATE_KEY` y `ADMIN_TOKEN`:

| Variable | Por defecto | Para qué |
|---|---|---|
| `RATE_LIMIT_PER_MINUTE` | `300` | Peticiones por minuto y por dispositivo (o IP) en toda la API |
| `WRITE_RATE_LIMIT_PER_MINUTE` | `20` | Escrituras de rutas (POST, PUT, DELETE y lecturas de una ruta de usuario) por minuto y por IP |
| `WRITE_RATE_LIMIT_PER_DAY` | `200` | Escrituras de rutas por día y por IP |
| `GEO_RATE_LIMIT_PER_MINUTE` | `120` | Búsquedas de lugares (`/geo/suggest` y `/geo/resolve`, juntas) por minuto y por IP |
| `USER_ROUTES_MAX` | `5000` | Rutas de usuario que guarda el servidor como máximo; pasado el tope, las nuevas reciben `503` |
| `GEOCODING_PROVIDER` | `wikidata` | `none` apaga la búsqueda de lugares (`/geo/*` responde `503`). Cualquier otro valor impide arrancar la API |
| `WIKIMEDIA_USER_AGENT` | `Rumbo/<versión> (https://github.com/AOcampo93/rumbo)` | `User-Agent` con el que la API consulta Wikidata; Wikimedia exige que lleve datos de contacto. Para añadir un email, ponerlo en Coolify, nunca en el repo |
| `ANALYTICS_ENABLED` | `true` | Con `false`, los lotes de analytics se aceptan (`202`) pero no se guardan |
| `ARCGIS_API_KEY_SERVER` | vacía | **Secreto** (solo de ejecución). Clave de ArcGIS para buscar direcciones: la API ya la lee, pero todavía no la usa. Nunca la misma que la de la web |
| `AI_PROVIDER` | vacía (IA apagada) | `anthropic` enciende la guía con IA. Vacía o `none` la apaga: `POST /content/generate` y `POST /suggest/places` responden `503 ai_unavailable`. Cualquier otro valor impide arrancar la API |
| `AI_API_KEY` | vacía | **Secreto** (solo de ejecución). La clave del proveedor de IA. Sin ella, `anthropic` se queda apagado y la API avisa al arrancar |
| `AI_MODEL` | `claude-sonnet-5-5` | El modelo de las fichas y las sugerencias |
| `AI_EFFORT` | `low` | Cuánto piensa el modelo: `low`, `medium` o `high`. `none` no envía el ajuste (para modelos que no lo admiten). Cualquier otro valor impide arrancar la API |
| `AI_DAILY_BUDGET_USD` | `5` | Gasto estimado por día UTC a partir del cual no empieza ninguna generación nueva (`429 ai_budget_exceeded`) |
| `AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY` | `40` | Generaciones que un dispositivo puede empezar por día UTC (`429 ai_device_limit`) |
| `AI_PRICE_INPUT_PER_MTOK` y `AI_PRICE_OUTPUT_PER_MTOK` | `2` y `10` | USD por millón de tokens de entrada y de salida, con los que se estima el gasto. Opcionales: son los del modelo por defecto, así que cámbialos junto con `AI_MODEL` |
| `AI_PRICE_PER_WEB_SEARCH` | `0.01` | USD por búsqueda web de una ficha. Opcional |
| `CONTENT_RATE_LIMIT_PER_MINUTE` | `30` | Fichas (`/content/generate`) por minuto y por IP |
| `SUGGEST_RATE_LIMIT_PER_MINUTE` | `20` | Sugerencias (`/suggest/places`) por minuto y por IP |
| `VAPID_PUBLIC_KEY` | vacía (push apagado) | Clave pública VAPID: la API se la da a los navegadores para suscribirse (`GET /push/key`). Se genera con `push:keys` |
| `VAPID_PRIVATE_KEY` | vacía | **Secreto** (solo de ejecución). Su mitad privada, con la que la API firma lo que manda a los servicios push. Nunca se muestra ni se registra |
| `VAPID_SUBJECT` | vacía | Contacto para los servicios push: una URL `https:` o una dirección `mailto:`. `push:keys` pone `https://rumbo.arturoocampo.com` |
| `PUSH_REMINDER_HOURS` | `6` | Horas tras el inicio de un recorrido sin terminar a las que su dispositivo recibe un recordatorio (acepta decimales). Nunca de 22:00 a 08:00 en Europa/Lisboa |
| `PUSH_RATE_LIMIT_PER_MINUTE` | `20` | Suscribir y cancelar notificaciones push por minuto y por IP |
| `ADMIN_RATE_LIMIT_PER_MINUTE` | `5` | Peticiones a los endpoints del responsable (anuncios y moderación, juntos) por minuto y por IP; los tokens equivocados también cuentan |
| `ADMIN_TOKEN` | vacía | **Secreto** (solo de ejecución). Token `Bearer` de los anuncios y de la moderación de las rutas de la comunidad: al menos 32 caracteres. Sin él, o más corto, esos endpoints responden `404` y la API lo avisa al arrancar |
| `REPORT_RATE_LIMIT_PER_MINUTE` | `10` | Reportes de rutas de la comunidad (`POST /routes/:id/reports`) por minuto y por IP |

- Una variable numérica con un valor que no sea un entero positivo (un número positivo, en el presupuesto y los precios) se ignora y se usa el de por defecto.
- El límite de 50 rutas por dispositivo no es una variable: es una constante del código (`ROUTES_PER_DEVICE`).

## IA (fase 7)

La guía con IA (sugerencias de lugares, fichas y trivia) vive en la API. Se enciende con dos variables de `rumbo-api` en Coolify: `AI_PROVIDER=anthropic` y `AI_API_KEY`. Qué hace y cuánto cuesta está en [`docs/PROJECT_PLAN.md`](PROJECT_PLAN.md) §12, y qué se envía al proveedor, en [`docs/SECURITY.md`](SECURITY.md).

**Activarla**

1. El responsable del proyecto escribe la clave en `apps/api/.env` (`AI_API_KEY=…`). Nunca en un chat ni en el repo.
2. Se carga en Coolify leyéndola de ese `.env` y enviándola por la API de Coolify a la app `rumbo-api`, **solo de ejecución** y sin mostrarla nunca en la salida. Lo mismo con `AI_PROVIDER=anthropic` (esa no es secreta).
3. Se despliega o se reinicia `rumbo-api`. Las demás variables tienen valor por defecto.

**Sin clave la API arranca igual.** Avisa en el log, y `POST /content/generate` y `POST /suggest/places` responden `503 ai_unavailable`. La web lo sabe: el creador ofrece las fichas básicas y sigue.

**Migración 0001** (`ai_contents` y `ai_generations`): se aplica sola al arrancar, como las anteriores. Solo crea dos tablas, así que no toca nada que exista y volver a la imagen anterior de la API es seguro: las tablas se quedan sin usar. Ninguna de las dos se poda.

**Web y API a la vez.** Una API vieja rechaza con `422 invalid_route` una ruta con fichas, porque no admite `contents`. Si alguien guarda una ruta con fichas justo mientras la web nueva habla con la API vieja, la ruta queda en `error` («El servidor rechazó la ruta. Edítala y guárdala de nuevo.») y se arregla guardándola otra vez. La ventana dura segundos.

**Tiempos.** Una ficha tarda de 5 a 12 s, y su plazo máximo es de 90 s en la API y de 120 s en la web. Traefik no corta peticiones largas por defecto. Si el DNS pasara algún día por el proxy de Cloudflare («nube naranja»), habría que revisar también su plazo de respuesta, que ronda los 100 s.

**Vigilar el gasto.** `ai_generations` guarda una fila por llamada, con su coste estimado. El gasto de hoy (día UTC, el mismo que usa el presupuesto), por tipo:

```bash
ssh vmi
docker exec -i <uuid de rumbo-db> sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT kind, status, count(*) AS calls, round(sum(cost_usd)::numeric, 3) AS usd
FROM ai_generations
WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
GROUP BY kind, status ORDER BY kind, status;
SQL
```

El gasto es una estimación a partir de los tokens y de `AI_PRICE_*`, no la factura: la factura real está en la consola del proveedor.

**Si algo falla.** La API registra solo el motivo, nunca la clave, el prompt ni el nombre del lugar:

| En el log | Qué respondemos | Qué mirar |
|---|---|---|
| `anthropic 401` (o `402`, `403`) | `503 ai_unavailable` | La clave, el saldo o los permisos del proveedor |
| `anthropic 404` | `503 ai_unavailable` | Por ejemplo, un `AI_MODEL` que no existe |
| `anthropic 429` o `529` | `502 generation_failed` | El proveedor pide esperar: reintentar más tarde |
| `timeout` | `502 generation_failed` | La llamada pasó de 60 s o la generación, de 90 s |

Un `429 ai_budget_exceeded` o `ai_device_limit` no es un fallo: se agotó el día UTC. Se arregla solo a las 00:00 UTC, y subir `AI_DAILY_BUDGET_USD` es una decisión de gasto del responsable del proyecto.

## Notificaciones push (fase 7.1)

La API manda dos tipos de aviso con Web Push: un **recordatorio** por recorrido sin terminar y los **anuncios** del responsable del proyecto. Nunca avisa de llegadas, porque el servidor no sabe dónde está nadie. Cómo funciona está en [`docs/PROJECT_PLAN.md`](PROJECT_PLAN.md) §10.11 y §11.1, y qué guarda y qué envía, en [`docs/SECURITY.md`](SECURITY.md).

**Generar las claves**

```bash
pnpm --filter @rumbo/api run push:keys                 # el par VAPID y el contacto, una sola vez
pnpm --filter @rumbo/api run push:keys --admin-token   # además, un ADMIN_TOKEN, si todavía no hay uno
pnpm --filter @rumbo/api run push:keys --replace       # un par VAPID nuevo
```

- Escribe `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`https://rumbo.arturoocampo.com`) en `apps/api/.env`, con permisos 600 y **sin mostrarlos**: solo dice cuáles ha escrito. Si ya hay un par, no lo toca. `ADMIN_TOKEN` son 32 bytes aleatorios en base64url.
- `--replace` invalida todas las suscripciones: cada navegador tiene que suscribirse de nuevo. La web lo hace sola la próxima vez que se abre, pero no llega a quien no la abra. Solo hace falta si el par se filtra.
- `--admin-token` no sustituye un `ADMIN_TOKEN` que ya exista. Para cambiarlo, hay que borrar el viejo del `.env` antes.

**Activarlo**

1. Generar las claves en local (arriba).
2. Cargar las variables en Coolify leyéndolas de `apps/api/.env` y enviándolas por la API de Coolify a la app `rumbo-api`, **solo de ejecución** y sin mostrarlas nunca en la salida. Son secretas `VAPID_PRIVATE_KEY` y `ADMIN_TOKEN`. `VAPID_PUBLIC_KEY` y `VAPID_SUBJECT` no lo son, pero van con ellas.
3. Desplegar o reiniciar `rumbo-api`. En el log tiene que salir `Web Push is on` (con `reminderHours` y `announcements`).

**Sin las claves la API arranca igual.** Avisa en el log (`Web Push is off: …`), los tres endpoints `/push/*` responden `503 push_unavailable` y la web enseña «No disponibles ahora mismo». Pasa lo mismo si falta una de las tres o el par no encaja (`incomplete` o `invalid`, sin mostrar ninguna clave). Un `ADMIN_TOKEN` de menos de 32 caracteres también se avisa: los anuncios quedan apagados.

**Migración 0002** (`push_subscriptions` y `push_log`): se aplica sola al arrancar. Solo crea dos tablas, así que volver a la imagen anterior de la API es seguro: las tablas se quedan sin usar. `push_log` no se poda.

**Recordatorios.** Cada 15 minutos la API busca los recorridos que siguen en marcha pasadas `PUSH_REMINDER_HOURS` horas (6 por defecto) desde su inicio, que vencieron hace menos de 24 horas y cuyo dispositivo tiene una suscripción, y manda **uno solo** por recorrido. De 22:00 a 08:00 en Europa/Lisboa no sale ninguno: los que vencen de noche salen a las 08:00. Para probarlo sin esperar, baja `PUSH_REMINDER_HOURS` en Coolify (acepta decimales, por ejemplo `0.1`) y vuelve a subirlo después.

**Anunciar algo.** `POST /api/v1/admin/push` con el `ADMIN_TOKEN` como `Bearer`. El título (hasta 80 caracteres) y el texto (hasta 240) van en los tres idiomas, y cada suscripción recibe el suyo. `url` es opcional: una ruta de la web (`/` por defecto). Responde `{ sent, failed }`.

```bash
TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' apps/api/.env)   # leído del .env, sin imprimirlo
curl -sS -X POST https://rumbo.arturoocampo.com/api/v1/admin/push \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":{"es":"…","en":"…","pt":"…"},"body":{"es":"…","en":"…","pt":"…"},"url":"/"}'
```

Un anuncio llega a todos los suscritos y la API no tiene forma de retirarlo, así que se revisa antes de mandarlo. El token lo tiene solo el responsable del proyecto.

**Si algo falla**

| En el log o en la respuesta | Qué significa | Qué mirar |
|---|---|---|
| `Web Push is off: set VAPID_…` | Faltan las tres variables | Cargarlas (arriba) |
| `Web Push is off: the VAPID settings are incomplete` o `invalid` | Falta una, o están mal escritas o mezcladas (un par que no encaja) | Rehacer el par con `push:keys --replace` y cargar las tres otra vez |
| `ADMIN_TOKEN has fewer than 32 characters` | Los anuncios están apagados | Generar otro con `--admin-token` |
| `404` en `POST /admin/push` | No hay un `ADMIN_TOKEN` válido | Lo mismo |
| `403 forbidden` en `POST /admin/push` | El token no coincide | Que el de Coolify sea el del `.env` |
| `503 push_unavailable` | El push está apagado | Las tres variables VAPID |
| Una suscripción desaparece de la tabla | El servicio push respondió `404` o `410` (se desinstaló la app o se retiró el permiso), o la rechazó 10 veces seguidas | Es lo normal: se borra sola |

La API registra solo el estado que contestó el servicio push o un código de red, nunca la dirección de una suscripción ni una clave.

**Probarlo tras desplegar.** En un Android real y en un iPhone con la app añadida a la pantalla de inicio (iOS 16.4 o más): Ajustes → Avisos → Notificaciones push → activar, mandar un anuncio y tocarlo. Es lo que los e2e no cubren: el Chrome de Playwright rechaza `subscribe()`.

## Rutas de la comunidad (fase 7.2)

Los usuarios pueden publicar sus rutas para quienes estén a 30 km o menos, y cualquiera puede reportar una ruta ajena. Con reportes de 3 dispositivos distintos la ruta se oculta hasta que la revise el responsable del proyecto. Cómo funciona: [`docs/PROJECT_PLAN.md`](PROJECT_PLAN.md) §11.1 y el [ADR 0004](adr/0004-rutas-de-la-comunidad.md). Qué es público y los riesgos: [`docs/SECURITY.md`](SECURITY.md).

**Activarlo**

1. Desplegar `rumbo-api` y `rumbo-web`. La **migración 0003** (`0003_community_routes`) se aplica sola al arrancar: añade a `routes` las columnas `visibility`, `moderation`, `published_at` y `moderated_at`, pone `public` en las curadas y crea `route_reports`. Las rutas de usuario que ya existían quedan **privadas**: nadie las publicó.
2. Para poder moderar hace falta `ADMIN_TOKEN` en `rumbo-api` (solo de ejecución): generarlo con `pnpm --filter @rumbo/api run push:keys --admin-token` y cargarlo en Coolify como las claves VAPID (sección «Notificaciones push»). Sin él, la API avisa al arrancar (`ADMIN_TOKEN is not set: announcements and the moderation of community routes are off`) y nadie puede revisar las rutas ocultas.

**Revisar la cola**

```bash
TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' apps/api/.env)   # leído del .env, sin imprimirlo
curl -sS https://rumbo.arturoocampo.com/api/v1/admin/moderation -H "Authorization: Bearer $TOKEN"
```

Responde `{ routes: [...] }`: primero las ocultas por reportes, luego las retiradas, y el resto por reportes abiertos, cada una con sus reportes por motivo (`spam`, `offensive`, `dangerous`, `privacy`, `wrong` y `other`).

Para revisar una antes de decidir, su contenido (el mismo bundle que lee la app):

```bash
curl -sS https://rumbo.arturoocampo.com/api/v1/admin/routes/<id> -H "Authorization: Bearer $TOKEN"
```

Solo responde con rutas públicas o que alguna vez se reportaron o se moderaron. Una ruta privada que nadie pudo ver no la lee ni el responsable (`404`).

**Decidir**

```bash
curl -sS -X POST https://rumbo.arturoocampo.com/api/v1/admin/routes/<id>/moderation \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"action":"restore"}'
```

- `restore` la devuelve a visible; `block` la retira para siempre. Las dos cierran sus reportes abiertos, así que los reportes nuevos cuentan desde cero.
- El dueño ve el estado en el detalle de su ruta («Oculta por reportes» o «Retirada por moderación»), y volver a publicarla no la desoculta.
- Los anuncios y la moderación comparten un límite de 5 peticiones por minuto y por IP (`ADMIN_RATE_LIMIT_PER_MINUTE`): una revisión larga puede toparse con un `429` y esperar un minuto.

**Si algo falla**

| En el log o en la respuesta | Qué significa | Qué mirar |
|---|---|---|
| `404` en `/admin/moderation` | No hay un `ADMIN_TOKEN` válido en `rumbo-api` | Generarlo y cargarlo (arriba) |
| `403 forbidden` | El token no coincide | Que el de Coolify sea el del `.env` |
| `route hidden by reports` (con el id) | Una ruta llegó a 3 dispositivos con reportes | Revisar la cola y decidir |
| `route moderated` (con el id y la acción) | Se aplicó una decisión | Nada: es el registro |

## Base de datos: migraciones y datos iniciales

Al arrancar, la API aplica las migraciones pendientes (`apps/api/drizzle`, generadas con `pnpm --filter @rumbo/api db:generate`). Después carga las rutas curadas de `data/routes`: inserta las nuevas, reemplaza las que cambiaron y deja igual el resto.

Las curadas ganan: si una ruta de usuario tiene el id de una curada, el arranque la borra (con sus fichas y recorridos) y siembra la curada, y lo deja en el log (`seed: a user route held a curated id; replaced it`). Las rutas de usuario con cualquier otro id no se tocan.

Si la base de datos no responde al arrancar, la API arranca igual: `/api/v1/health` informa del fallo, los endpoints de datos devuelven `503 { "code": "unavailable" }` y reintenta cada 10 s. Así un despliegue no queda bloqueado por una caída momentánea de Postgres.

## Copias de seguridad de la base de datos

Configuradas en Coolify el 2026-10-07 (`rumbo-db` → *Backups*):

| | |
|---|---|
| Frecuencia | Diaria a las 03:00 UTC (`0 3 * * *`) |
| Contenido | La base `rumbo` con `pg_dump` en formato *custom* (`.dmp`) |
| Dónde | En el propio VPS: `/data/coolify/backups/databases/root-team-0/rumbo-db-<uuid>/` |
| Retención | Las 14 más recientes, con un máximo de 2 GB |

El primer backup se lanzó al configurarlo y `pg_restore -l` lo lee bien.

**Rutas borradas:** una ruta de usuario que se borra desaparece de la base de datos al momento (borrado físico), pero sigue en las copias hasta que rotan: con 14 copias diarias, hasta 14 días.

**Limitación:** las copias están en el mismo servidor. Sirven ante un error de datos (una migración mala, un borrado), pero no si se pierde el VPS. Para eso falta una copia fuera del servidor: un almacenamiento S3 en Coolify (`save_s3`) con credenciales del responsable del proyecto.

**Restaurar** (sobrescribe los objetos que ya existan):

```bash
ssh vmi
ls -lt /data/coolify/backups/databases/root-team-0/rumbo-db-*/      # elegir el archivo
docker exec -i <uuid de rumbo-db> sh -c \
  'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < <archivo>.dmp
```

El contenedor de la base se llama como el UUID de `rumbo-db` en Coolify. Antes de restaurar en producción, conviene probar el archivo en una base temporal.

## Rollback

- **Rápido:** en Coolify, app → *Deployments* → volver a la imagen anterior.
- **Por código:** `git revert` en `main` y desplegar con normalidad. Nunca reescribir `production`.
- **Migraciones:** la 0001 (fase 7) y la 0002 (fase 7.1) solo añaden tablas, y la 0003 (fase 7.2), una tabla y columnas con valor por defecto, así que volver a una imagen anterior de la API es seguro. Una API anterior a la 7.2 trata todas las rutas de usuario como privadas.

## Pendiente

- [x] DNS en Cloudflare: registro `A rumbo → IP del VPS`, «solo DNS» (nube gris), como el resto de subdominios.
- [x] Repositorio público (requisito del curso).
- [x] Primer despliegue de `rumbo-api` y `rumbo-web` (2026-10-07): HTTPS de Let's Encrypt, API con la BD conectada y commit servido verificado.
- [x] Backups programados de `rumbo-db` (diarios) en Coolify (2026-10-07). Ver «Copias de seguridad».
- [ ] Copia de los backups fuera del VPS (S3).
- [x] `data/**` en las watch paths de `rumbo-web` y `rumbo-api` (2026-10-08).
- [x] Despliegue de las fases 4 y 5 (2026-10-08, commit `1c151bb`). Al arrancar, la API aplicó las migraciones y sembró la ruta de Leiria. La web carga las rutas desde la API.
- [x] `pnpm deploy:prod` lanza los despliegues por la API de Coolify, porque la GitHub App no tiene webhook (2026-10-08).
- [x] Despliegue de la fase 6, el creador de rutas (2026-10-08, commit `7f6456b`). Comprobado en producción: una ruta creada con lugares reales de Wikidata, probada en simulación, guardada (`POST` 201) y eliminada (`DELETE` 204).
- [x] Despliegue de la fase 7, la guía con IA (2026-10-08, commit `3898958`): `AI_PROVIDER`, `AI_MODEL` y `AI_API_KEY` en Coolify como variables solo de ejecución; la migración `0001` (`ai_contents`, `ai_generations`) se aplicó al arrancar. Comprobado con la IA real: sugerencias, tres fichas sin spoilers y la trivia al llegar.
- [x] Despliegue de la fase 7.1, ajustes tras las pruebas en un iPhone y notificaciones push (2026-10-08, commit `e76be01`): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en Coolify como variables solo de ejecución; la migración `0002` (`push_subscriptions`, `push_log`) se aplicó al arrancar y el log dice `Web Push is on`. Comprobado en producción: `GET /push/key` da la clave pública, una suscripción de un servicio no permitido o con claves falsas da `400`, y en un iPhone emulado el detalle de una ruta propia muestra «Editar ruta» y «Eliminar ruta», y Ajustes, el interruptor de push.
- [ ] Fase 7.1: probar el push en un Android real y en un iPhone con la app instalada. Para mandar un anuncio de prueba hace falta antes un `ADMIN_TOKEN` (`push:keys --admin-token`) cargado en `rumbo-api`, solo de ejecución.
- [x] Sin «Leiria» fijo en Inicio y «Mi ubicación» que centra el mapa en el usuario (2026-10-09, commit `3c40933`, solo la web). Comprobado en producción con un iPhone emulado situado en Oporto.
- [ ] Fase 7.2, rutas de la comunidad: generar y cargar `ADMIN_TOKEN`, desplegar (migración 0003) y comprobar en producción publicar, ver la ruta desde otro dispositivo cercano, reportarla y moderarla.
