# ADR 0005 · Portadas de las rutas (fotos de los usuarios) y vista de rutas en el mapa

- **Estado:** aceptada (2026-10-09). Fase 7.3.
- **Afecta a:** `api-contract` (`MEDIA_LIMITS`, `isOwnMediaUrl` y la portada en `checkUserRoute`), `route-builder` (`RouteDraft.coverImage`), `apps/api` (migración 0004, `POST /media`, `GET /media/:file` y limpieza), `apps/web` (portada en el creador, ilustraciones por interés, mapa de Explorar y filtro) y la seguridad ([SECURITY.md](../SECURITY.md)).

## Contexto

Tras probar la fase 7.2, el responsable del proyecto pidió:

- **una foto de portada** al crear una ruta, y, si no se pone ninguna, una imagen genérica según su tipo (sus intereses: historia, arte, arquitectura…);
- en el mapa de Explorar, además de los pines sueltos, **una vista de rutas** con los pines unidos, distinguidas por color o por actividad;
- que el filtro del mapa no liste rutas por su nombre («Leiria histórica» es contenido de la app, no algo fijo de ella).

Hasta ahora una ruta de usuario no podía tener portada (`checkUserRoute` la rechazaba) y las imágenes solo venían de Wikimedia.

## Decisión

Las dos primeras decisiones las tomó el responsable del proyecto el 2026-10-09.

1. **La portada es tu foto o una de tus lugares.** Al crear o editar una ruta se puede subir una foto del móvil (cámara o galería) o elegir una de las fotos de Wikimedia de sus fichas. Sin portada, la app muestra la **ilustración** del primer interés de la ruta (azulejo con el icono del tema, sin licencias de terceros) y, si no tiene intereses, el azulejo de siempre.
2. **La vista de rutas colorea por actividad.** El mapa de Explorar alterna **Puntos** (los pines, como ahora) y **Rutas** (los puntos unidos en su orden). El color depende de la actividad (a pie, corriendo, en bici), y cada actividad tiene además su tipo de línea (continua, trazos largos, trazos cortos), para no depender solo del color. La leyenda lleva solo esas entradas. Al tocar una ruta, se resalta y sale su nombre.
3. **El filtro no lista rutas.** En lugar de una fila por ruta, filtra por **origen** (oficiales, de la comunidad, tuyas) y por **intereses**. Siguen los lugares de interés y las categorías.

### Fotos de los usuarios (servidor)

- **Subir:** `POST /media`, con `X-Device-Id` y la foto como cuerpo (`image/jpeg`, `image/png` o `image/webp`, hasta 4 MB: `MEDIA_LIMITS`). El móvil la reduce antes a 1600 px como mucho.
- **Procesar:** el servidor la decodifica (con `sharp`), la endereza según su orientación, la reduce a 1600 px como mucho y la guarda como JPEG **sin ningún metadato** (ni la posición GPS ni el modelo del móvil). Lo que no se puede decodificar es `415 unsupported_media`.
- **Guardar:** en Postgres (tabla `media`, migración 0004), con un id aleatorio de 128 bits. Responde `{ id, url, width, height, bytes }`, con la `url` absoluta en este servidor.
- **Servir:** `GET /media/<id>.jpg`, con un día de caché (el responsable puede borrar una foto), `nosniff` y una CSP que no deja ejecutar nada. El service worker de la web pide estas fotos primero a la red.
- **Usar:** la `url` va en `spec.coverImage` (solo `url` y `alt`). `checkUserRoute` admite como portada una foto propia o una de las fotos de las fichas de la ruta, igual que en la ficha (crédito y licencia incluidos). El servidor comprueba además que la foto propia existe, es de su origen, la subió el dueño de la ruta y no es la portada de otra ruta (`422 unverified_content` si no). Una ruta que guarda la misma portada que ya tenía se acepta aunque el responsable haya borrado la foto.
- **Limpiar:** una foto que ninguna ruta usa se borra a la semana (subidas abandonadas, portadas cambiadas y rutas borradas). La semana deja subir días después una ruta guardada sin conexión.
- **Límites:** por IP, 10 subidas por minuto. Por dispositivo, 30 al día. En todo el servidor, un tope de espacio (`MEDIA_MAX_TOTAL_MB`, 300 MB por defecto; pasado el tope, `503 unavailable`).
- **Moderación:**
  - una portada ofensiva se reporta con su ruta (motivo «Contenido ofensivo»);
  - el responsable puede borrar una foto concreta con `DELETE /admin/media/:id` (`ADMIN_TOKEN`), y la app muestra entonces la ilustración.

## Consecuencias

- Cada ruta puede tener su cara: una foto propia, una de sus lugares o, al menos, la ilustración de su tema.
- **Riesgos conocidos:**
  - **Fotos de desconocidos en rutas públicas:** el reporte y el borrado del responsable son la red. No hay revisión previa (ADR 0004).
  - **La foto de una ruta privada:** su dirección es aleatoria e imposible de adivinar, pero quien la tenga la ve sin token. Solo aparece en el bundle, que de una ruta privada solo lee su dueño.
  - **Espacio y copias de seguridad:** las fotos van en la base de datos, así que entran en las copias diarias. Con el tope de 300 MB, las copias (máximo 2 GB) guardarían menos días: si el uso crece, habrá que moverlas a un volumen o a un almacenamiento de objetos.
  - **Sin conexión no se sube:** la foto se sube al elegirla. Sin conexión, la app lo dice y la ruta se guarda sin portada.

## Alternativas descartadas

- **Solo fotos de los lugares:** más simple y sin moderación de fotos ajenas, pero no deja usar una foto propia.
- **Fotos genéricas de bancos de imágenes** para el respaldo: licencias y estilo ajenos. Las ilustraciones propias encajan con la marca.
- **Un color por ruta en la vista de rutas:** la leyenda tendría que nombrar cada ruta, justo lo que se quiere evitar.
- **Guardar las fotos en disco** (un volumen de Coolify): no entran en las copias de la base de datos y piden configurar el servidor compartido. Queda para cuando haga falta.
