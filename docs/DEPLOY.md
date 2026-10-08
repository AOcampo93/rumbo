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
- **La web y la API se despliegan por separado, no a la vez.** Durante unos segundos la web nueva puede hablar con la API vieja, o al revés. La web lo tolera: si la API todavía no tiene los endpoints de rutas de usuario y responde `not_found`, la ruta se queda pendiente y se reintenta.
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
5. Pide a Coolify que despliegue cada app y espera hasta que sirva el nuevo commit. Si el despliegue falla en Coolify, se detiene y da su identificador para buscar el log.

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
- **API:** `DATABASE_URL` (URL interna de `rumbo-db`) y `LOG_LEVEL`. Todas las demás son opcionales y tienen valor por defecto (tabla de abajo). Las que lleven secretos se marcan **solo de ejecución** (no de build), para que no queden en los metadatos de la imagen.
- **Web:** las `VITE_*` se inyectan en el bundle durante el build. Son públicas por definición: nunca secretos.

Variables opcionales de la API, con su valor por defecto. Ninguna es un secreto, salvo `ARCGIS_API_KEY_SERVER`:

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

- Una variable numérica con un valor que no sea un entero positivo se ignora y se usa el de por defecto.
- El límite de 50 rutas por dispositivo no es una variable: es una constante del código (`ROUTES_PER_DEVICE`).

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

## Pendiente

- [x] DNS en Cloudflare: registro `A rumbo → IP del VPS`, «solo DNS» (nube gris), como el resto de subdominios.
- [x] Repositorio público (requisito del curso).
- [x] Primer despliegue de `rumbo-api` y `rumbo-web` (2026-10-07): HTTPS de Let's Encrypt, API con la BD conectada y commit servido verificado.
- [x] Backups programados de `rumbo-db` (diarios) en Coolify (2026-10-07). Ver «Copias de seguridad».
- [ ] Copia de los backups fuera del VPS (S3).
- [x] `data/**` en las watch paths de `rumbo-web` y `rumbo-api` (2026-10-08).
- [x] Despliegue de las fases 4 y 5 (2026-10-08, commit `1c151bb`). Al arrancar, la API aplicó las migraciones y sembró la ruta de Leiria. La web carga las rutas desde la API.
- [x] `pnpm deploy:prod` lanza los despliegues por la API de Coolify, porque la GitHub App no tiene webhook (2026-10-08).
