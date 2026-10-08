# Seguridad: secretos, repositorio público, rutas de usuario e IA

El repositorio es **público**: cualquiera puede leer todo lo que se sube a git y todo lo que termina en el bundle de la web.

Además, desde la fase 6 los usuarios crean rutas, y una ruta puede contener su casa o los sitios de un viaje. Cómo se protegen esas rutas está más abajo.

Desde la fase 7 la API también llama a un proveedor de IA, y cada llamada cuesta dinero. Qué se le envía, qué fichas se aceptan y cuánto se puede gastar está en «IA generativa».

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
  - `AI_API_KEY` la escribe el responsable del proyecto en su `apps/api/.env` (nunca en un chat) y se envía a Coolify por su API, solo de ejecución y sin mostrarla en la salida ([DEPLOY.md](DEPLOY.md)).
- En Coolify, los secretos se marcan **solo de ejecución**, para que no lleguen al build ni a los metadatos de la imagen.
- `.dockerignore` excluye los `.env`, así que tampoco entran en una imagen construida en local.
- Los logs no registran secretos, cabeceras de autenticación (como `X-Edit-Token`) ni coordenadas. El detalle, en «Qué registra la API».

## Capas de protección

1. **`.gitignore`:** `.env`, `.env.*` (salvo `.env.example`), claves y certificados privados.
2. **GitHub:** *secret scanning* y *push protection*. GitHub rechaza un push que contenga claves de proveedores conocidos (IA, nubes, pagos…).
3. **CI:** el job *Secret scan* (gitleaks) revisa todo el historial en cada push y en cada pull request. Por eso los tests no llevan cadenas con aspecto de clave: los tokens de prueba se construyen al ejecutarlos (`Buffer.alloc(32, 7).toString('base64url')`).
4. **Dependabot:** alertas y pull requests automáticos cuando una dependencia tiene una vulnerabilidad conocida.

## Rutas de usuario: privadas y con dueño

Las rutas que crea un usuario son **privadas**: solo las lee quien las creó. Las curadas, que hacemos nosotros, son públicas.

- `GET /routes` lista únicamente las curadas.
- `GET /routes/:id` de una ruta de usuario solo responde con su `X-Edit-Token`. Sin él, o con otro, devuelve un `404 route_not_found` idéntico al de un id que no existe.
  - Se decide antes del `ETag` y del `304`: un `304` confirmaría que la ruta existe.
  - La respuesta lleva `cache-control: private, no-store`.
- El id de la ruta (un slug del nombre y 10 caracteres aleatorios) **no es un secreto**: aparece en direcciones y en el historial del navegador. Lo que protege la ruta es el token.
- Compartir rutas, cuando llegue, usará un token de lectura aparte. El de edición no se comparte nunca.
- Qué guarda el servidor de la propiedad: el hash SHA-256 del token (nunca el token) y el `X-Device-Id` del dispositivo que creó la ruta, que cuenta para su cuota.

El razonamiento completo está en el [ADR 0002](adr/0002-rutas-de-usuario.md).

## Tokens de edición

- El **dispositivo** genera el token al crear la ruta: 32 bytes aleatorios (`crypto.getRandomValues`) en base64url, 43 caracteres. No se muestra nunca.
- Vive en IndexedDB, junto a la ruta. Se envía en `X-Edit-Token` en cada POST, PUT y DELETE. La API también lo exige para leer la ruta, aunque la web de la fase 6 no la lee de la API: usa su copia local.
- El servidor guarda solo su hash SHA-256 y lo compara en tiempo constante (`timingSafeEqual`). Una filtración de la base de datos no da acceso de escritura.
- Quien tenga el token puede editar o borrar la ruta, y un XSS podría leerlo de IndexedDB. Por eso la web evita que entre HTML ajeno (regla `vue/no-v-html`) y manda cabeceras de seguridad (más abajo).
- El token no se puede cambiar. Si se compromete, se elimina la ruta (Mis rutas → Eliminar) y se crea otra.
- **Borrar los datos locales** (Ajustes) borra también los tokens. Antes, la app intenta eliminar del servidor las rutas ya subidas: un DELETE por ruta, con 3 s de límite cada uno. El diálogo avisa de cuántas rutas se borrarán del servidor y de cuántas se perderán por no haberse subido. Si no hay conexión, las rutas que no se pudieron borrar quedan en el servidor sin que nadie pueda editarlas ni borrarlas; siguen siendo privadas.
- Una ruta borrada con DELETE se elimina de verdad, con sus fichas y sus recorridos. Las copias de seguridad la conservan hasta 14 días ([DEPLOY.md](DEPLOY.md)).
- IndexedDB guarda el único ejemplar de los tokens y de las rutas sin subir, así que tras el primer guardado la app pide al navegador almacenamiento persistente (`navigator.storage.persist()`).
- Cuando haya cuentas (fase 8), la propiedad pasará de `owner_device_id` a `owner_user_id`.

## Límites y cuotas de la API

Todo lo que entra se valida (Zod) y se limita. Los límites estrictos cuentan por **dirección IP** y no por `X-Device-Id`: ese identificador lo elige el cliente, y con uno nuevo en cada petición esquivaría cualquier límite.

| Qué | Límite | Si se supera |
|---|---|---|
| Peticiones a la API | 300 por minuto, por dispositivo o IP | `429 rate_limited` |
| Escrituras de rutas (POST, PUT, DELETE y lecturas de una ruta de usuario) | 20 por minuto y 200 por día, por IP | `429 rate_limited`, con `Retry-After` |
| Búsqueda de lugares (`/geo/suggest` y `/geo/resolve`, juntas) | 120 por minuto, por IP | `429 rate_limited` |
| Recorridos y analytics | 30 por minuto, por dispositivo o IP | `429 rate_limited` |
| Fichas con IA (`POST /content/generate`) | 30 por minuto, por IP | `429 rate_limited` |
| Sugerencias de lugares (`POST /suggest/places`) | 20 por minuto, por IP | `429 rate_limited` |
| Gasto de IA | 5 USD estimados por día UTC (`AI_DAILY_BUDGET_USD`), en todo el servidor | `429 ai_budget_exceeded` |
| Generaciones de IA por dispositivo | 40 por día UTC (`AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY`) | `429 ai_device_limit` |
| Rutas de usuario por dispositivo | 50 | `409 quota_exceeded` |
| Rutas de usuario en todo el servidor | 5.000 (`USER_ROUTES_MAX`) | `503 unavailable` |
| Cuerpo de un POST o PUT de ruta | 128 KiB (4 KB en los dos endpoints de IA, 1 MiB en el resto) | `413 payload_too_large` |

- La IP es la última entrada de `X-Forwarded-For`, la que añade Traefik. Lo que escriba un cliente en esa cabecera no cuenta ([DEPLOY.md](DEPLOY.md)).
- Un POST repetido por el dueño de la ruta no cuenta contra sus propias cuotas.
- **Qué puede contener una ruta de usuario.** La API solo acepta lo que produce el creador (`checkUserRoute`): no se pueden guardar imágenes, enlaces ni datos arbitrarios.
  - Sin trazado, portada ni descripción. El resumen, solo como texto simple de hasta 280 caracteres.
  - Fichas (`contents`) solo las que generó este servidor: sección «IA generativa».
  - Metadatos de la ruta: solo `interests` (hasta 10 textos de 40 caracteres). Metadatos de un punto: solo `address` (hasta 200 caracteres) y `externalId` (un QID de Wikidata).
  - Acciones: una por punto más 8, como mucho; solo `info_sheet` (sin imagen), `ai_template` y `decision`.
  - Textos sin caracteres de control ni sustitutos Unicode sueltos, anidación de 8 niveles como mucho y 500 km entre los puntos como mucho.
  - Un problema es un `422 invalid_route` con hasta 20 `details`.
- **Wikimedia.** Las consultas a Wikidata (y las de la IA a Wikipedia, Wikidata y Commons) llevan un `User-Agent` descriptivo, no siguen redirecciones, tienen 6 s de plazo y respuestas de hasta 1 MB, y se limitan a 4 a la vez. Si Wikimedia pide esperar (429 o 5xx), la API deja de preguntarle durante ese tiempo y responde `503 geocoding_unavailable`.
- Los textos que vienen de Wikidata se limpian antes de usarlos (sin caracteres de control ni marcas bidireccionales) y se cortan en puntos de código: nombres a 80 caracteres y descripciones y direcciones a 200.

## IA generativa: qué se envía, qué se acepta y cuánto se gasta

La guía con IA (sugerencias, fichas y trivia) llama a un proveedor externo desde la API. El razonamiento está en el [ADR 0003](adr/0003-guia-con-ia.md).

**La clave**

- `AI_API_KEY` solo vive en `apps/api/.env` y en Coolify (solo de ejecución). El navegador nunca la ve ni habla con el proveedor: llama a nuestra API.
- No se registra nunca: ni en los logs, ni en los mensajes de error, ni en las respuestas. Un fallo del proveedor queda como `anthropic 401 authentication_error`, `network` o `timeout`, sin el prompt, el nombre del lugar ni lo que contestó el proveedor.
- Sin clave, la IA queda apagada y la API arranca igual (`503 ai_unavailable`).
- Una clave de IA filtrada se paga con dinero: además de rotarla (más abajo), hay que revisar el gasto en la consola del proveedor.

**Qué se envía al proveedor de IA.** Lo envía el servidor, así que el proveedor ve la IP del servidor y no la del usuario.

- **Una ficha con artículo de Wikipedia:** el nombre y la descripción del lugar en Wikidata, el idioma, los intereses elegidos y el texto del artículo, que es público.
- **Una ficha que se investiga en la web** (el lugar no tiene artículo): lo mismo, sin el texto, y el proveedor hace las búsquedas que decida el modelo, con el nombre y la zona. Si el usuario no lo ligó a un elemento de Wikidata (un punto propio), se añaden su tipo (si no es «otro») y su posición **redondeada a 3 decimales** (unos 110 m).
- **Una sugerencia:** la lista de candidatos que arma el servidor con datos públicos de Wikipedia y Wikidata (id, nombre, tipo, descripción corta, distancia y dirección desde el punto de búsqueda, y en cuántas Wikipedias tienen artículo), los intereses, el tiempo y la actividad. **No** las coordenadas del punto de búsqueda ni los lugares que la ruta ya tiene.
- **Nunca:** el `X-Device-Id`, la IP, el token de edición, el nombre o el resumen de la ruta, los demás lugares de la ruta ni la posición GPS del usuario.

**Qué se envía a nuestra API y a Wikimedia**

- A la API: el punto de búsqueda de las sugerencias, **redondeado a 3 decimales** por la web y otra vez por el servidor, y la posición de cada lugar para su ficha (la misma que se guarda en la ruta). El punto de búsqueda es el centro del mapa o la zona; si el usuario pulsó «Usar mi ubicación», es esa posición redondeada, leída una sola vez al pulsar.
- A Wikimedia (Wikipedia, Wikidata y Commons): los QID, los nombres de los lugares y, para una sugerencia o un punto propio, la posición redondeada a 3 decimales.
- Las fotos las carga el navegador directamente desde `upload.wikimedia.org`, así que Wikimedia ve la IP del usuario al verlas, igual que con las fotos de los lugares de interés de Explorar.

**Fichas verificadas por el servidor (`unverified_content`)**

- El servidor guarda cada ficha que genera (`ai_contents`) con su SHA-256, y `POST` y `PUT /routes` solo aceptan fichas cuyo hash conoce: si no, `422 unverified_content`.
- Sin esto, `contents` sería un campo libre. Cualquiera podría guardar una ficha que dijera «Generado con IA a partir de Wikipedia» con el texto, los enlaces o las imágenes que quisiera, o con fotos de cualquier servidor.
- Además, `checkUserRoute` exige imágenes solo de `https://upload.wikimedia.org/…`, hasta 30 fichas, una por clave referenciada, en el idioma de la ruta y con `generated.by === 'ai'`.
- El cliente transporta la ficha sin tocarla. Cualquier cambio, hasta el orden de los datos, cambia el hash y la ruta se rechaza.
- Los hashes valen para siempre (`ai_contents` no se poda), aunque cambie el prompt.
- El hash prueba que el servidor generó esa ficha, no que sea del lugar al que se asocia. Una ruta es privada y solo la ve su dueño, así que lo peor que puede pasar es que el dueño se confunda a sí mismo.

**Texto no fiable (prompt injection)**

- Wikipedia y los resultados de la búsqueda web son datos no fiables. El texto del artículo va dentro de etiquetas `<source>` (las que traiga el propio texto se neutralizan) y el prompt exige usar solo ese texto.
- El modelo no tiene más herramientas que la búsqueda web (3 como máximo por ficha) y la que entrega la respuesta: no ejecuta nada.
- La respuesta se valida con Zod y se pinta siempre como texto, nunca como HTML (`vue/no-v-html`). Las fuentes de una ficha web son solo páginas que la búsqueda devolvió de verdad, y las imágenes las elige el servidor en Commons, nunca el modelo.
- Con un elemento de Wikidata, el nombre de la ficha sale de Wikidata y no del cuerpo de la petición: la ficha se guarda para todos los que pidan ese elemento y así un cliente no puede envenenarla.
- El riesgo que queda es una ficha con texto engañoso. Siempre lleva sus fuentes a la vista y la marca «Generado con IA».

**Presupuestos y límites**

- **Global:** `AI_DAILY_BUDGET_USD` (5 USD estimados por día UTC). **Por dispositivo:** `AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY` (40). **Por IP:** 30 fichas y 20 sugerencias por minuto. Los cuerpos de los dos endpoints, de 4 KB como máximo.
- La caché es gratis: un lugar ya generado no gasta presupuesto, ni siquiera con el día agotado. «Regenerar» (`fresh: true`) sí gasta una generación.
- `X-Device-Id` lo elige el cliente, así que el tope por dispositivo se esquiva con otro identificador. Los topes que de verdad frenan son el presupuesto global y los límites por IP.
- **Riesgos conocidos:**
  - Quien gaste el presupuesto del día deja a los demás sin IA nueva hasta las 00:00 UTC. Lo ya generado se sigue sirviendo desde la caché. Los límites por IP lo frenan, no lo impiden.
  - Comprobar el presupuesto y registrar el gasto no es una sola operación atómica: una ráfaga puede pasarse del tope por unas pocas generaciones.
- El gasto es una estimación a partir de los tokens y de los precios configurados, no la factura: la factura real está en la consola del proveedor.

**Qué guarda el servidor**

- `ai_contents`: cada ficha generada (texto público de Wikipedia o de la web, y sus fuentes). No se liga a ningún dispositivo.
- `ai_generations`: una fila por llamada, con el `X-Device-Id`, el tipo (`card` o `suggest`), el idioma, el modelo, los tokens, el coste estimado y la latencia. En las fichas lleva la `cache_key` (el QID del lugar o, en un punto propio, un hash del nombre, el tipo y la posición a 4 decimales); en las sugerencias es nula a propósito, porque llevaría la posición.
- Ninguna de las dos se poda, y «Borrar mis datos locales» no borra las filas de `ai_generations`: la IA no usa token de edición, y el `X-Device-Id` es un UUID aleatorio que se pierde al borrar los datos locales.

## Qué registra la API

- Los logs (pino) guardan el método y la **ruta sin la query**: `?near=lat,lng` podría llevar una posición.
- **Nunca** se registran coordenadas, tokens de edición (ni su hash), el cuerpo de las peticiones ni el texto que se busca.
- Un error de base de datos se registra solo con el código y el mensaje de Postgres. Drizzle mete en su propio mensaje los parámetros de la consulta (posiciones, identificadores de dispositivo, hashes de token), y esos nunca se vuelcan.
- Un fallo de la búsqueda de lugares se registra con su motivo y su estado (`rate_limited`, `timeout`…), sin la URL, la consulta, la posición ni lo que contestó Wikidata. Un cliente que se va a mitad de petición (escribió otra letra) no es un fallo y no se registra.
- Los errores del cliente (JSON mal formado, un valor que Postgres no admite) no se registran como errores del servidor.
- Una llamada a la IA que falla se registra con su motivo (`anthropic 401 authentication_error`, `rate_limited`, `timeout`…), sin la clave, el prompt, el nombre ni la posición del lugar ni lo que contestó el proveedor. Un fallo de Wikimedia al preparar una ficha se registra solo con su motivo.
- Analytics: las propiedades con forma de posición (`lat`, `lng`…) se rechazan.

## La web: cabeceras y XSS

Hoy la web no tiene ningún punto por el que entre HTML ajeno: no usa `v-html` ni `innerHTML`, y el popup del mapa se construye con `textContent`. Pero desde la fase 6 guarda en IndexedDB los tokens que permiten editar y borrar rutas, y muestra textos de terceros (Wikidata, nombres de rutas). Dos barreras para que siga así:

- **Cabeceras** (nginx, [DEPLOY.md](DEPLOY.md)): `Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: strict-origin-when-cross-origin`. Una CSP de scripts, imágenes y conexiones queda pendiente hasta mapear lo que necesita el SDK de ArcGIS.
- **Lint:** `vue/no-v-html` está en `error` (`eslint.config.js`): un texto de fuera nunca se pinta como HTML.

## Si se filtra un secreto

1. **Rotarlo primero, en el proveedor.** Una clave publicada se da por comprometida aunque luego se borre del repo.
2. Poner el valor nuevo en Coolify y en los `.env` locales, y redesplegar. Con `AI_API_KEY`, revisar además el gasto del proveedor desde que pudo filtrarse.
3. Después, si hace falta, limpiar el historial de git.
