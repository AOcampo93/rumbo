# ADR 0002 · Rutas de usuario: privadas, con el token de edición generado en el dispositivo

- **Estado:** aceptada (2026-10-08).
- **Afecta a:** `route-builder`, `api-contract`, `apps/api` (rutas, base de datos y límites), `apps/web` (creador, Mis rutas y subida de rutas) y la seguridad ([SECURITY.md](../SECURITY.md)).

## Contexto

La fase 6 deja crear rutas desde la web. Hasta entonces la API solo servía las rutas curadas. El plan decía que `POST /routes` devolvía un `editToken` generado por el servidor, que las rutas de usuario saldrían en el listado y que cualquiera con el id podía leerlas. Al diseñar el creador hubo que decidir:

- **Quién lee una ruta de usuario.** Puede incluir una casa, un hotel o los sitios de un viaje.
- **Cómo se demuestra que una ruta es tuya.** No hay cuentas.
- **Qué pasa sin conexión.** El creador tiene que funcionar en la calle, y la ruta tiene que existir en el dispositivo antes de llegar a la API.
- **Cómo se evita que alguien llene el disco.** El VPS es compartido con otros proyectos y las copias de seguridad tienen un máximo de 2 GB.
- **Qué pasa si el id de una ruta de usuario coincide con el de una curada.**
- **Qué significa «borrar».**

## Decisión

### 1. Las rutas de usuario son privadas

- `GET /routes` lista solo las curadas.
- `GET /routes/:id` de una ruta de usuario responde únicamente con su `X-Edit-Token`. Sin él, o con otro, es un `404 route_not_found`, igual que si no existiera. Se decide antes del `ETag` y del `304`, porque un `304` confirmaría que existe.
- La fase 6 no lee rutas de usuario de la API: la fuente es el registro del dispositivo (IndexedDB).
- Compartir rutas, cuando llegue, usará un token de lectura explícito, distinto del de edición.

### 2. El token de edición lo genera el cliente

- 32 bytes aleatorios (`crypto`) en base64url, 43 caracteres. Se guarda en IndexedDB junto a la ruta y no se muestra nunca.
- El servidor guarda solo su hash SHA-256 (en hexadecimal) y lo compara en tiempo constante.
- Viaja en `X-Edit-Token` en el POST, el PUT y el DELETE, y la API lo exige también para leer la ruta.
- Sustituye al `editToken` que devolvía el POST: ahora responde `{ id, updatedAt }`.

### 3. El POST es idempotente para el dueño

- Un POST con un id que ya existe y el mismo token actualiza la ruta y responde `200`. La primera vez responde `201`.
- Así, un `201` perdido (o un POST que el cliente abandonó por tiempo y el servidor sí completó) nunca deja una ruta huérfana: se repite y ya está.
- Si el id es de otro token o de una ruta curada: `409 route_exists`.

### 4. Los ids los elige el cliente

- Una ruta nueva se llama `<slug del nombre>-<sufijo>`, con un sufijo de 10 caracteres `[a-z0-9]` de `crypto.getRandomValues`, fijo durante todo el borrador. Al editar se conserva el id guardado.
- Un id no se puede adivinar a partir de otro, pero tampoco es un secreto: aparece en las direcciones. Lo protege el token.
- Una colisión local (prácticamente imposible) se arregla con otro sufijo. Un `409 route_exists` del servidor deja la ruta en `error`, sin cambiar de id.

### 5. Las curadas ganan

- Si al arrancar el seed encuentra una fila no curada con el id de una curada, la borra (con sus fichas y recorridos), siembra la curada y deja un aviso en el log. Las demás filas de usuario no se tocan.
- Los ids de las curadas son públicos y los de usuario los elige el cliente. Sin esta regla, alguien podría ocupar el id de una ruta curada que aún no existe y bloquear su siembra.

### 6. Borrar es borrar

- `DELETE /routes/:id` elimina la fila, sus fichas y sus recorridos (cascada de las claves foráneas). No hay estado «borrada».
- Un PUT o un DELETE posterior responde `404`.

### 7. Límites contra el abuso del almacenamiento

- Cuerpo de POST y PUT de hasta 128 KiB.
- Una lista cerrada de lo que puede contener una ruta de usuario (`checkUserRoute`): lo que produce el creador y nada más.
- Hasta 50 rutas por dispositivo (`409 quota_exceeded`) y `USER_ROUTES_MAX` (5.000) en todo el servidor (`503 unavailable`).
- Escrituras por IP: 20 por minuto y 200 por día. Búsquedas de lugares: 120 por minuto. Se cuenta por IP porque `X-Device-Id` lo elige el cliente y se esquivaría con uno nuevo en cada petición.

### 8. La ruta se guarda en el dispositivo antes de subirse

- El registro de «Mis rutas» (IndexedDB) guarda cada ruta con su token y su estado de subida. La ruta funciona antes de subirse y sin conexión.
- Cada registro dice si el servidor puede tener una copia (`remote`: `no`, `maybe` o `yes`). `maybe` se guarda antes de que el primer POST salga del dispositivo, así que borrar una ruta cuyo POST pudo llegar siempre envía un DELETE.
- Un bucle de subida reintenta solo (al abrir la app, al volver la conexión, al volver a primer plano y cada minuto mientras haya algo pendiente).

## Alternativas consideradas

- **Token generado por el servidor** (lo que decía el plan). Obliga a esperar la respuesta del primer POST para poder editar o borrar, y si esa respuesta se pierde la ruta queda en el servidor sin dueño. Tampoco deja crear la ruta con todas sus garantías sin conexión.
- **Rutas «no listadas»:** fuera del listado, pero legibles por cualquiera que tenga el id. El id sería el único secreto, y aparece en la barra de direcciones y en el historial. Y no aporta nada a la fase 6, que no lee rutas de usuario de la API.
- **Listar las rutas de usuario** (`GET /routes?source=user`) para descubrir rutas ajenas. No hay necesidad de producto hoy y el coste de privacidad es claro. El filtro `source` desaparece del contrato.
- **Borrado lógico** (un estado `archived` o `deleted`): conserva datos que el usuario pidió borrar y añade un estado más a cada consulta.
- **Limitar solo por `X-Device-Id`:** se esquiva con un UUID nuevo en cada petición. Se combina con límites por IP y un tope global.
- **Esperar a las cuentas de usuario** (fase 8): retrasa el creador. El token por dispositivo es provisional y se puede sustituir: la tabla ya tiene `owner_user_id`.

## Consecuencias

- **Contrato:** `POST /routes` responde `{ id, updatedAt }` (sin `editToken`), `GET /routes` ya no admite `source` y hay ocho códigos de error nuevos. Está reflejado en el plan (§10.8, §11.1 y §11.3).
- **Sin cuentas, la ruta vive en el dispositivo.** «Mis rutas» no se ve desde otro dispositivo. Borrar los datos locales o cambiar de móvil pierde los tokens: antes de borrar, la app intenta eliminar las copias del servidor, y las que no consiga borrar quedan privadas pero sin dueño.
- **El token es la llave.** Quien lo tenga puede editar o borrar la ruta, y un XSS podría leerlo de IndexedDB. Por eso la web evita que entre HTML ajeno (`vue/no-v-html`) y manda cabeceras de seguridad ([SECURITY.md](../SECURITY.md)). No hay rotación: si se compromete, se borra la ruta y se crea otra.
- **Fase 7:** `contents` sigue vacío en las rutas de usuario hasta que el servidor genere las fichas (`POST /content/generate`). Entonces la lista cerrada se abrirá solo para lo que escriba el servidor (fichas `ai_template`, con imágenes de Wikimedia Commons), nunca para lo que mande el cliente.
- **Compartir (C5, «futuro»):** necesitará un token de lectura aparte.
- **Operación:** los límites por IP suponen un solo salto de proxy (Traefik). Si el DNS pasara por el proxy de Cloudflare, habría que revisar `trustProxyHop` ([DEPLOY.md](../DEPLOY.md)).
- **Copias de seguridad:** una ruta borrada sigue en ellas hasta 14 días.
