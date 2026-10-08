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
- **`production`**: lo que está desplegado. Coolify despliega automáticamente cada push a esta rama.
- **Watch paths:** cada app solo se redespliega si cambian sus archivos (`apps/web/**` o `apps/api/**`), `packages/**`, `data/**`, el lockfile, la configuración del workspace o `.dockerignore`. Las dos apps vigilan `data/**`: la web empaqueta las rutas curadas y los lugares de interés, y la API siembra las rutas en la base de datos al arrancar. La misma lista está en `scripts/deploy-prod.sh`: si cambia en Coolify, hay que cambiarla también ahí.
- **Solo se despliega cuando lo pide el responsable del proyecto.**
- **Si se borra y se recrea la rama `production`**, el webhook de una rama nueva no trae archivos cambiados y Coolify no despliega. Ese primer despliegue se lanza desde Coolify (botón *Deploy* o `GET /api/v1/deploy?uuid=…`).

Para desplegar:

```bash
pnpm deploy:prod      # o: bash scripts/deploy-prod.sh
```

El script:

1. Exige el árbol limpio y que `HEAD` sea `origin/main`.
2. Comprueba que la CI de ese commit terminó en verde.
3. Hace *fast-forward* de `production` (nunca `--force`).
4. Espera solo a las apps cuyos archivos cambiaron, hasta que sirvan el nuevo commit: la API en `/api/v1/health` y la web en `/version.json`. Si solo cambian docs o CI, no se redespliega nada.

## Rutas: un solo origen

La web y la API comparten dominio. La PWA llama a `/api/v1/…` sin CORS, y el service worker y las cookies quedan en el mismo origen.

- Traefik envía `Host(rumbo.arturoocampo.com) && PathPrefix(/api)` a la API y el resto a la web.
- La API declara sus rutas como `/v1/…` y quita `/api` si aún llega (`rewriteUrl` en `apps/api/src/app.ts`). Funciona igual con o sin el ajuste «Strip Prefixes» de Coolify y detrás del proxy de Vite en desarrollo.
- Health checks:
  - **API:** `http://127.0.0.1:3000/api/v1/health`. Devuelve versión, commit servido y estado de la BD, y siempre 200. El host es `127.0.0.1` y no `localhost` porque la imagen Alpine no trae `curl` y el `wget` de busybox resuelve `localhost` como IPv6 (`::1`), mientras que la API escucha en IPv4.
  - **Web:** `/`. La imagen de nginx sí incluye `curl`.
- Las dos apps informan del commit que sirven: la API en `/api/v1/health` y la web en `/version.json`. Coolify inyecta `SOURCE_COMMIT` en ejecución.

## Variables de entorno

Las reglas completas sobre secretos están en [`docs/SECURITY.md`](SECURITY.md).

- En producción se gestionan en Coolify, **nunca en el repo**. En local, en `apps/*/.env`, que git ignora. Las plantillas son los `.env.example`.
- **API:** `DATABASE_URL` (URL interna de `rumbo-db`) y `LOG_LEVEL`. Opcionales, con valor por defecto: `RATE_LIMIT_PER_MINUTE` (300) y `ANALYTICS_ENABLED` (`true`). Las que lleven secretos se marcan **solo de ejecución** (no de build), para que no queden en los metadatos de la imagen.

## Base de datos: migraciones y datos iniciales

Al arrancar, la API aplica las migraciones pendientes (`apps/api/drizzle`, generadas con `pnpm --filter @rumbo/api db:generate`). Después carga las rutas curadas de `data/routes`: inserta las nuevas, reemplaza las que cambiaron y deja igual el resto.

Si la base de datos no responde al arrancar, la API arranca igual: `/api/v1/health` informa del fallo, los endpoints de datos devuelven `503 { "code": "unavailable" }` y reintenta cada 10 s. Así un despliegue no queda bloqueado por una caída momentánea de Postgres.

La documentación OpenAPI está en `/api/v1/docs`.
- **Web:** las `VITE_*` se inyectan en el bundle durante el build. Son públicas por definición: nunca secretos.

## Copias de seguridad de la base de datos

Configuradas en Coolify el 2026-10-07 (`rumbo-db` → *Backups*):

| | |
|---|---|
| Frecuencia | Diaria a las 03:00 UTC (`0 3 * * *`) |
| Contenido | La base `rumbo` con `pg_dump` en formato *custom* (`.dmp`) |
| Dónde | En el propio VPS: `/data/coolify/backups/databases/root-team-0/rumbo-db-<uuid>/` |
| Retención | Las 14 más recientes, con un máximo de 2 GB |

El primer backup se lanzó al configurarlo y `pg_restore -l` lo lee bien.

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
