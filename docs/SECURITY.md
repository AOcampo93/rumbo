# Seguridad: secretos y repositorio público

El repositorio es **público**: cualquiera puede leer todo lo que se sube a git y todo lo que termina en el bundle de la web.

## Dónde vive cada secreto

| Qué | Desarrollo | Producción |
|---|---|---|
| Claves de servidor (IA, geocodificación, base de datos) | `apps/api/.env` (git lo ignora) | Variables de Coolify de `rumbo-api`, **solo de ejecución** |
| Configuración pública de la web (`VITE_*`) | `apps/web/.env` (git lo ignora) | Variables de build de `rumbo-web` |
| Token de la API de Coolify | Solo en la máquina de quien despliega, fuera del repo | — |

- Las plantillas `.env.example` listan las variables, sin valores. Para empezar: `cp apps/api/.env.example apps/api/.env`, y lo mismo en `apps/web`.
- Todo lo que empieza por `VITE_` se incrusta en el JavaScript público: **nunca** un secreto.
  - La clave de ArcGIS de la web es pública por diseño. Se limita a mapas base y por *referrer* (el dominio de producción y localhost).
- Las claves de IA y de geocodificación solo existen en el servidor (`apps/api`). El navegador nunca las ve: siempre llama a nuestra API.
- En Coolify, los secretos se marcan **solo de ejecución**, para que no lleguen al build ni a los metadatos de la imagen.
- `.dockerignore` excluye los `.env`, así que tampoco entran en una imagen construida en local.
- Los logs no registran secretos, cabeceras de autenticación ni coordenadas.

## Capas de protección

1. **`.gitignore`:** `.env`, `.env.*` (salvo `.env.example`), claves y certificados privados.
2. **GitHub:** *secret scanning* y *push protection*. GitHub rechaza un push que contenga claves de proveedores conocidos (IA, nubes, pagos…).
3. **CI:** el job *Secret scan* (gitleaks) revisa todo el historial en cada push y en cada pull request.
4. **Dependabot:** alertas y pull requests automáticos cuando una dependencia tiene una vulnerabilidad conocida.

## Si se filtra un secreto

1. **Rotarlo primero, en el proveedor.** Una clave publicada se da por comprometida aunque luego se borre del repo.
2. Poner el valor nuevo en Coolify y en los `.env` locales, y redesplegar.
3. Después, si hace falta, limpiar el historial de git.
