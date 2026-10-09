# ADR 0004 · Rutas de la comunidad: publicar a elección, anónimas y moderadas con reportes

- **Estado:** aceptada (2026-10-09). Fase 7.2.
- **Afecta a:** `api-contract`, `apps/api` (migración 0003, lista, lectura, reportes y moderación), `apps/web` (creador, Mis rutas, detalle y Explorar) y la seguridad ([SECURITY.md](../SECURITY.md)). Cambia una decisión del [ADR 0002](0002-rutas-de-usuario.md): las rutas de usuario dejan de ser siempre privadas.

## Contexto

Tras probar la app en un iPhone, el responsable del proyecto pidió que Rumbo sirva **donde esté el usuario** y que las rutas que crea la gente las puedan ver y recorrer otros que estén en esa zona. Su ejemplo: un vecino de Leiria crea la ruta del castillo, el parque y el río, y un visitante que abre Rumbo en Leiria la ve, con las acciones que se crearon en cada lugar.

Hasta ahora una ruta de usuario solo la veía el dispositivo que la creó (ADR 0002). El servidor ya guarda el centroide y el área de cada ruta, y `GET /routes` ya ordena por cercanía, así que lo nuevo es decidir:

- **Quién decide qué se publica,** y con qué valor por defecto.
- **Qué se ve del creador,** sin cuentas de usuario.
- **Cómo se controla lo publicado:** textos, enlaces y vídeos que elige un desconocido llegan a otros desconocidos.

## Decisión

Las tres decisiones las tomó el responsable del proyecto el 2026-10-09.

1. **Publicar es a elección del creador.** El paso Revisar del creador tiene un interruptor «Publicar para la comunidad», apagado por defecto. Una ruta se puede publicar o retirar cuando se quiera, desde su detalle.
2. **Anónimas.** Una ruta publicada sale como «De la comunidad»: sin nombre de autor ni nada que identifique al dispositivo. No hay cuentas (siguen para después).
3. **Moderación con reportes.** Cualquiera puede reportar una ruta ajena, con un motivo de una lista cerrada. Con reportes abiertos de **3 dispositivos distintos**, la ruta se oculta hasta que el responsable la revise. El responsable puede retirarla o restaurarla.

### Servidor

**Migración 0003.**

- `routes` gana:
  - `visibility` (`private` | `public`, por defecto `private`). Las curadas pasan a `public`.
  - `moderation` (`visible` | `hidden` | `blocked`, por defecto `visible`).
  - `published_at`: la última vez que pasó a `public`. Nula si nunca lo estuvo.
  - `moderated_at`: el último cambio de `moderation`.
- `route_reports`: `id`, `route_id` (con borrado en cascada), `device_id`, `reason`, `created_at` y `resolved_at`. Un dispositivo tiene como mucho un reporte abierto por ruta (índice único parcial con `resolved_at` nulo).

**Endpoints.** Los esquemas están en `api-contract`.

- **`POST` y `PUT /routes`** aceptan `visibility`.
  - Sin ella, el `POST` crea la ruta privada y el `PUT` no la cambia. Pasar a `public` fija `published_at`.
  - Responden `{ id, updatedAt, visibility, moderation }`.
  - Publicar o retirar no toca `moderation`: una ruta oculta o bloqueada sigue así aunque su dueño la vuelva a publicar.
- **`GET /routes?near=lat,lng`** devuelve las curadas y las rutas de usuario públicas y visibles cuyo centroide está a 30 km o menos de `near`: las 20 más cercanas (`COMMUNITY_ROUTES`), todo ordenado por distancia.
  - Sin `near`, solo las curadas, como antes.
  - Un resumen nunca lleva nada del dueño.
- **`GET /routes/:id`:** una ruta de usuario pública y visible la lee cualquiera, sin token (`cache-control: public, max-age=60`). Una privada, oculta o bloqueada responde `404 route_not_found` a todos menos a su dueño, que la lee con su token como hasta ahora.
- **`GET /routes/:id/status`**, solo para el dueño (`X-Edit-Token`): `{ visibility, moderation, publishedAt }`. Sin el token correcto, `404 route_not_found`, igual que la lectura.
- **`POST /routes/:id/reports`** `{ reason }`, con `X-Device-Id`.
  - Solo admite rutas de usuario públicas y visibles; para cualquier otra (curada, privada, oculta o inexistente) responde `404 route_not_found`.
  - Responde siempre `{ received: true }`: `201` si el reporte es nuevo y `200` si se repite o lo envía el dueño de la ruta (su `X-Device-Id`), que no cuenta. La respuesta no dice cuántos reportes hay ni si la ruta se ocultó.
  - Cuando los reportes abiertos llegan a 3 dispositivos distintos, la ruta pasa a `hidden` (`moderated_at` = ahora) y el log lo anota con el id de la ruta.
  - Límite: 10 por minuto y por IP (`REPORT_RATE_LIMIT_PER_MINUTE`).
- **Moderación del responsable** (`ADMIN_TOKEN`), con las reglas de `POST /admin/push`: sin un token válido el endpoint no existe (`404`), con otro token responde `403`, y admite 5 intentos por minuto y por IP. Funciona aunque el push esté apagado.
  - `GET /admin/moderation`: las rutas ocultas, las bloqueadas y las que tienen reportes abiertos, con los reportes por motivo.
  - `POST /admin/routes/:id/moderation` `{ action }`:
    - `block` la retira (`blocked`) y cierra sus reportes abiertos;
    - `restore` la devuelve a `visible` y cierra sus reportes abiertos.
- **Borrar** una ruta borra sus reportes.

### Web

- **Registro de «Mis rutas».**
  - Cada ruta lleva su `visibility`; las ya guardadas se leen como `private`.
  - Publicar o retirar es una edición más: sube `rev`, la ruta queda `pending` y la cola de subida manda el `PUT` con `visibility`. Así funciona sin conexión y con reintentos, como el resto.
- **Creador, paso Revisar (C4):**
  - un interruptor «Publicar para la comunidad», apagado por defecto; al editar una ruta, con su valor;
  - la ayuda: «Quien use Rumbo cerca podrá verla y recorrerla, sin saber quién la creó.»;
  - encendido, un aviso: «Lo verán desconocidos: no incluyas tu casa ni datos personales.»
- **Pantalla final (C5):** si se publicó, lo dice («Publicada para la comunidad», o que se publicará al conectar).
- **Detalle de una ruta propia (S03):**
  - una línea de estado:
    - «Privada: solo tú la ves.»
    - «Publicada: la ven quienes usen Rumbo cerca.»
    - «Oculta por reportes: la revisaremos.»
    - «Retirada por moderación.»
  - un botón **Publicar** o **Dejar de publicar**, junto a Editar ruta y Eliminar ruta;
  - el estado de moderación se pide con `GET /routes/:id/status` al abrir, si la ruta es pública y hay conexión.
- **Mis rutas (S02):** las tarjetas de las rutas publicadas llevan la etiqueta «Publicada».
- **Explorar (S01)** pide las rutas cercanas con `GET /routes?near=` (la posición redondeada a 3 decimales) cuando conoce la posición:
  - al tocar «Mi ubicación»;
  - o al abrir Explorar, si el permiso de ubicación ya está concedido (Permissions API). En ese caso lee la posición una vez, sin preguntar nada.
  - **Lista:**
    - las curadas, como ahora;
    - después, la sección «De la comunidad, cerca de ti», con las RouteCards de esas rutas y la etiqueta «De la comunidad». Las propias ya publicadas no se repiten: salen como «Creada por ti».
    - Sin posición, una tarjeta invita a tocar «Mi ubicación» para ver las rutas de la comunidad cercanas.
  - **Mapa:**
    - también los puntos de las rutas de la comunidad;
    - si se conoce la posición al abrir, el encuadre inicial es el de las rutas cercanas, o la posición del usuario si no hay ninguna.
  - Para tener los puntos, la app pide el bundle de cada ruta de la comunidad listada (`GET /routes/:id`, hasta 20). No se guardan para uso sin conexión hasta que el usuario las descarga, igual que las curadas.
- **Detalle de una ruta de la comunidad (S03):**
  - la etiqueta «De la comunidad»;
  - si la ruta no está en el idioma de la app, la línea «Esta ruta está en {idioma}»;
  - al final, un botón discreto **Reportar ruta** abre una hoja con los motivos y [Enviar], y confirma con «Gracias. La revisaremos.» El dispositivo recuerda qué rutas reportó y no vuelve a ofrecerlo.
  - Los motivos:
    - spam o publicidad;
    - contenido ofensivo;
    - un lugar peligroso o de acceso prohibido;
    - expone datos personales o una vivienda;
    - información falsa o lugares que no existen;
    - otro motivo.
- **Recorrer** una ruta de la comunidad es igual que recorrer una curada.
- **Analytics:** `route_published`, `route_unpublished` y `route_reported` (`{ reason }`), sin nada que identifique la ruta.

## Consecuencias

- Rumbo deja de depender de las rutas curadas: en cualquier ciudad puede haber rutas, y quien llega a un sitio ve lo que prepararon los de allí.
- **Riesgos conocidos:**
  - **Reportes inventados:** el `X-Device-Id` lo elige el cliente, así que alguien podría inventarse 3 dispositivos y ocultar una ruta. Solo la oculta hasta la revisión (no la borra), y el límite por IP lo frena. Con cuentas, los reportes contarían por cuenta.
  - **Contenido de terceros a desconocidos:** una ruta publicada lleva a otras personas los textos, enlaces y vídeos que eligió su creador.
    - El enlace se abre siempre tras un diálogo que enseña su dominio.
    - El vídeo de YouTube no carga nada de YouTube hasta pulsar play.
    - Las fichas con IA las escribe el servidor, con fuentes (ADR 0003).
    - El reporte es la red para todo lo demás.
  - **Privacidad del creador:** publicar enseña los lugares que eligió. La app avisa al publicar, y ninguna respuesta pública lleva el dispositivo ni el token.
  - **Idioma:** las fichas se quedan en el idioma en que se crearon (ADR 0001), y el detalle lo avisa. Traducirlas queda para después.
  - **Sin aviso de reportes:** el responsable no recibe ninguna notificación cuando una ruta se oculta. Revisa `GET /admin/moderation` (DEPLOY.md).

## Alternativas descartadas

- **Pública por defecto, o siempre pública:** expone lugares que el creador quizá no quería enseñar.
- **Un apodo del creador:** sin cuentas, cualquiera puede usar cualquier apodo, y habría que moderarlos.
- **Cuentas ya:** mucho más trabajo y más datos personales que proteger. Quedan para después.
- **Aprobar cada ruta antes de publicarla:** lo más seguro, pero cada ruta esperaría al responsable.
- **Compartir por enlace privado:** sigue pendiente, con un token de lectura distinto del de edición (ADR 0002).
