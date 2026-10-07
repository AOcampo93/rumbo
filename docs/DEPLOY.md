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
- **Watch paths:** cada app solo se redespliega si cambian sus archivos (`apps/web/**` o `apps/api/**`), `packages/**`, el lockfile o la configuración del workspace.
- **Solo se despliega cuando lo pide el responsable del proyecto.**

Para desplegar:

```bash
pnpm deploy:prod      # o: bash scripts/deploy-prod.sh
```

El script:

1. Exige el árbol limpio y que `HEAD` sea `origin/main`.
2. Comprueba que la CI de ese commit terminó en verde.
3. Hace *fast-forward* de `production` (nunca `--force`).
4. Espera a que `/api/v1/health` responda con el nuevo commit.

## Rutas: un solo origen

La web y la API comparten dominio. La PWA llama a `/api/v1/…` sin CORS, y el service worker y las cookies quedan en el mismo origen.

- Traefik envía `Host(rumbo.arturoocampo.com) && PathPrefix(/api)` a la API y el resto a la web.
- La API declara sus rutas como `/v1/…` y quita `/api` si aún llega (`rewriteUrl` en `apps/api/src/app.ts`). Funciona igual con o sin el ajuste «Strip Prefixes» de Coolify y detrás del proxy de Vite en desarrollo.
- Health checks: la API en `/api/v1/health` (devuelve versión, commit servido y estado de la BD; siempre 200) y la web en `/`.

## Variables de entorno

- Se gestionan en Coolify, **nunca en el repo**. Las plantillas están en los `.env.example`.
- **API:** `DATABASE_URL` (URL interna de `rumbo-db`) y `LOG_LEVEL`. Las que lleven secretos se marcan **solo de ejecución** (no de build), para que no queden en los metadatos de la imagen.
- **Web:** las `VITE_*` se inyectan en el bundle durante el build. Son públicas por definición: nunca secretos.
- La API devuelve `SOURCE_COMMIT` en `/api/v1/health` y el script de despliegue lo usa para saber cuándo terminó. Está por verificar en el primer despliegue que Coolify lo inyecta en ejecución; si no lo hace, hay que pasarlo como variable de build.

## Rollback

- **Rápido:** en Coolify, app → *Deployments* → volver a la imagen anterior.
- **Por código:** `git revert` en `main` y desplegar con normalidad. Nunca reescribir `production`.

## Pendiente

- [x] DNS en Cloudflare: registro `A rumbo → IP del VPS`, «solo DNS» (nube gris), como el resto de subdominios.
- [x] Repositorio público (requisito del curso).
- [ ] Primer despliegue de `rumbo-api` y `rumbo-web`, comprobando que la API informa del commit servido.
- [ ] Backups programados de `rumbo-db` (diarios) en Coolify.
