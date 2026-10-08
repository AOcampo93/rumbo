# ADR 0003 · Guía con IA: la IA propone, Wikidata verifica y cada lugar se descubre al llegar

- **Estado:** aceptada (2026-10-08).
- **Afecta a:** `route-spec` (`PointContent.quiz`), `api-contract`, `event-system` (`ai_template`), `route-builder` (`summary`), `apps/api` (IA, presupuestos y tablas), `apps/web` (creador y llegada) y la seguridad ([SECURITY.md](../SECURITY.md)).

## Contexto

La visión del producto es una **guía de bolsillo**: en un sitio que no conoces, la app te sugiere qué ver, eliges, la ruta se arma sola y cada lugar lo descubres al llegar (ficha, consejo y pregunta rápida), siempre con fuentes.

La fase 6 dejó el creador sin IA: las rutas de usuario llevaban `contents` vacío, y el [ADR 0002](0002-rutas-de-usuario.md) anunció que la lista cerrada se abriría solo para lo que escribiera el servidor. Al diseñar la fase 7 hubo que decidir:

- **Dónde puede inventar la IA.** Un modelo que propone lugares o escribe datos de un sitio real puede equivocarse con total aplomo.
- **De dónde salen los lugares y sus coordenadas.** El creador las guarda y el motor las usa para detectar la llegada.
- **Cuándo se generan las fichas y si el usuario las ve** antes de llegar.
- **Cómo evitar que el cliente falsifique fichas,** ahora que la API acepta `contents`.
- **Cuánto cuesta y cuánto puede llegar a costar,** con una clave de pago en un servidor compartido.
- **Qué pasa sin conexión y sin IA.**
- **Qué restricciones tiene el modelo elegido.**

## Decisión

### 1. La IA propone y Wikidata y Wikipedia verifican

- El modelo elige los lugares sugeridos **de una lista de candidatos** que arma el servidor con la geobúsqueda de Wikipedia. Los nombres y las posiciones salen de esa lista, nunca del modelo, y un id que no esté en ella se descarta.
- El servidor ordena el recorrido (vecino más cercano) y quita los últimos lugares si no caben en el tiempo del usuario.
- Cada sugerencia lleva una anécdota que dice por qué ir, no qué se va a aprender.

### 2. Una ficha se apoya en una fuente, por este orden

1. El artículo de Wikipedia del lugar, por su QID de Wikidata, en el idioma del usuario (respaldo: en, es, pt).
2. Si no hay artículo, la búsqueda web del proveedor (3 búsquedas como máximo), con citas.
3. Si tampoco hay nada fiable, una ficha corta y honesta: «no hemos encontrado información fiable…».

La IA solo resume y estructura. Las fuentes se muestran siempre que la ficha las tiene (la honesta no), y las imágenes son reales, de Wikimedia Commons con autor y licencia. **Nunca se inventan datos.**

### 3. Sin spoilers

- Las fichas se preparan al crear la ruta, pero el creador solo enseña su estado («Ficha lista · 3 fuentes»). «Ver ficha» pide confirmación antes de abrirla.
- Lo que hay en cada lugar se descubre al llegar.

### 4. La trivia va dentro de la ficha

- `PointContent.quiz` es opcional: una pregunta, de 2 a 4 opciones, la correcta y una explicación. Sale de la misma llamada, así que no cuesta más, viaja con la ficha y funciona sin conexión.
- `ai_template` la puntúa: 10 puntos si el resultado de la vista trae la respuesta correcta.

### 5. El servidor verifica las fichas

- Guarda cada ficha que genera (`ai_contents`) con el SHA-256 de su JSON canónico sin `id`. `POST` y `PUT /routes` solo aceptan fichas cuyo hash conoce: si no, `422 unverified_content`.
- Esto se suma a la lista cerrada de `checkUserRoute` (imágenes solo de `upload.wikimedia.org`, el idioma de la ruta, `generated.by: 'ai'` y hasta 30 fichas).
- El cliente transporta la ficha sin tocarla.

### 6. Se genera al crear la ruta, una vez por lugar, y viaja en el bundle

- La caché guarda una ficha por (lugar o hash del punto propio, idioma, versión del prompt, intereses) y la sirve gratis a todos.
- La ficha va en `contents` del bundle, en IndexedDB, y sus fotos se piden con CORS al preparar la ruta para que el service worker las guarde.
- «Regenerar» envía `fresh: true`: salta la caché, gasta una generación y guarda la ficha nueva con una clave propia. La anterior sigue valiendo para las rutas que ya la usan.

### 7. Costes y límites

- `AI_DAILY_BUDGET_USD` (5), `AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY` (40) y límites por IP (30 fichas y 20 sugerencias por minuto). El gasto se estima con los tokens y los precios configurados, y queda anotado en `ai_generations`.
- Sin clave, o con el presupuesto agotado, el creador sigue con fichas básicas.

### 8. El proveedor

- `AiProvider` es una interfaz de una sola operación (`structured`). La implementación es la de Anthropic (`AI_PROVIDER=anthropic`, `AI_MODEL=claude-sonnet-5-5`).
- Ese modelo rechaza una `temperature` distinta de la suya y un `tool_choice` forzado. Se usa `tool_choice: auto`, `output_config.effort` (`AI_EFFORT`, `low`), una validación estricta con Zod y un reintento.
- Los tests usan un proveedor falso y respuestas grabadas. El proveedor real se mide a mano.

### 9. Idioma

Cada petición va en el idioma de la app y lo generado se queda en él ([ADR 0001](0001-multilenguaje.md)). El portugués es el de Portugal.

### 10. Fuera de la fase 7

Los eventos y las rutas de otros usuarios pasan a la fase 8.

## Alternativas consideradas

- **Que la IA genere los lugares libremente.** Inventaría lugares o coordenadas que no se pueden verificar, y las coordenadas son lo que el motor usa para detectar la llegada. Con candidatos de Wikipedia, la IA solo elige y ordena.
- **Mostrar (y editar) las fichas en el creador.** Destripa lo que se iba a descubrir al llegar. Queda una vista previa, tras confirmar, para quien quiera verla. Editar el texto se aplaza.
- **Búsqueda web primero.** Cuesta unas 3,3 veces más (~0,056 frente a ~0,017 USD), tarda casi el doble (~10 s frente a 5-7 s) y trae fuentes más dispares. Solo se usa si el lugar no tiene artículo.
- **Generar al llegar.** Obliga a tener conexión y a esperar de 5 a 12 s en la calle, justo en el momento clave. Además gasta con cada visita y no funciona sin conexión.
- **Aceptar las fichas que mande el cliente,** validadas solo con Zod. Un esquema válido no prueba que una ficha salga de una fuente real: cualquiera podría poner su texto o sus imágenes bajo «Generado con IA a partir de Wikipedia».
- **Forzar la herramienta (`tool_choice`) y fijar la temperatura,** la forma habitual de conseguir una salida estructurada estable. El modelo elegido no lo admite: se hace con `auto`, validación y un reintento.

## Consecuencias

- **Costes** (medidos el 2026-10-08 con los precios por defecto): unos 0,017 USD por ficha de Wikipedia, 0,056 con búsqueda web y 0,012 por sugerencia. Una ruta de 8 lugares sin nada en caché cuesta unos 0,14 USD, y con 5 USD al día caben unas 35 así. Los lugares ya generados salen de la caché, gratis. El presupuesto es una estimación, no la factura.
- **Latencia:** una ficha tarda de 5 a 12 s (hasta 90 s en el peor caso) y una sugerencia, de 6 a 9 s. Por eso se generan al crear la ruta: el creador prepara 2 fichas a la vez y enseña el progreso. La generación sigue en el servidor aunque el cliente se vaya; se paga igual y quien reintente la recibe gratis.
- **Sin conexión:** la ficha y su trivia viajan en el bundle, y las fotos se guardan al preparar la ruta (esperando 15 s como máximo). Crear las fichas sí necesita conexión: sin ella quedan marcadas y se preparan al volver, o se usa la ficha básica.
- **Sin IA** (sin clave, sin presupuesto o sin conexión) el creador sigue funcionando con fichas básicas. El paso Fichas nunca bloquea el avance.
- **Dependencias externas:** el proveedor de IA y Wikimedia. Si Wikimedia falla mientras se prepara una ficha, la petición falla (`502`) en vez de guardar para todos una ficha sin su foto.
- **Contrato:** `PointContent.quiz`, `RouteDraft.summary`, los cuerpos de `/content/generate` (con `fresh`) y `/suggest/places`, cinco códigos de error nuevos y `checkUserRoute` abierto a las fichas verificadas. Está reflejado en el plan (§6.4, §11 y §12). Una migración (0001) con dos tablas que no se podan.
- **Privacidad:** al proveedor van nombres y textos públicos de lugares, los intereses, el idioma y, solo en un punto propio, su posición redondeada a 3 decimales (unos 110 m). Nunca el dispositivo, la IP ni la posición del usuario ([SECURITY.md](../SECURITY.md)).
- **Una ficha en caché es para todos:** su nombre sale de Wikidata y no del cliente, para que nadie pueda envenenarla. Cambiar el prompt sube `PROMPT_VERSION` y genera fichas nuevas, pero las antiguas siguen siendo válidas.
- **Calidad:** la IA puede malinterpretar una fuente. Se mitiga con las fuentes a la vista, la marca «Generado con IA» y la ficha honesta cuando no hay información.
- **Límites conocidos:**
  - El tope por dispositivo se esquiva con otro `X-Device-Id`: lo que frena de verdad son el presupuesto global y los límites por IP.
  - Quien agote el presupuesto deja a los demás sin IA nueva hasta las 00:00 UTC.
  - Que las anécdotas no hagan spoilers depende del prompt, no del código.
  - Cerrar la ficha con el gesto de deslizar después de responder no puntúa la trivia.
- **Operación:** la clave, la migración y el gasto se llevan como dice [DEPLOY.md](../DEPLOY.md).
- **Futuro:** eventos y rutas de otros usuarios (fase 8), editar fichas, invalidar fichas cuando cambian los intereses y regenerarlas en otro idioma.
