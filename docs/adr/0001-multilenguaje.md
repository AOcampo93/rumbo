# ADR 0001 · Multilenguaje: español, inglés y portugués

- **Estado:** aceptada (2026-10-07).
- **Afecta a:** `route-spec`, `geo-engine`, `event-system`, `apps/web`, `apps/api` y el pipeline de IA.

## Contexto

El plan inicial tenía la interfaz en español e inglés y dejaba el portugués para el futuro. La app pasa a ser **trilingüe desde la v1**: español, inglés y portugués de Portugal, como en los mockups. Hay que decidir:

- cómo se elige el idioma;
- cómo cambia la interfaz;
- cómo se guardan los textos de las rutas;
- en qué idioma trabaja la IA.

## Decisión

### 1. Idiomas y elección

- **Idiomas:** `es`, `en` y `pt`. `pt` es portugués de Portugal (BCP-47 `pt-PT`, con trato de «tu»).
- **Elección única:** el idioma se elige **una sola vez**, en el primer arranque, en la pantalla S00 Idioma (`/welcome`), y se guarda.
- **Preselección:** la pantalla marca de entrada el idioma del navegador (`navigator.languages`). Si no es uno de los tres, marca español.
- **Cambios posteriores:** S00 no vuelve a aparecer; para cambiar de idioma está Ajustes (S12).

### 2. Interfaz

- **Catálogos:** vue-i18n (Composition API), con un catálogo por idioma en `apps/web/src/i18n/{es,en,pt}.json`. Son la fuente de verdad de los textos de la interfaz. La tabla de microcopy de `DESIGN.md` es la referencia en español.
- **Cambio en vivo, sin recargar.** `useLocale()` centraliza el cambio:
  - el idioma activo de vue-i18n;
  - el atributo `<html lang>`, para los lectores de pantalla;
  - `intl.setLocale()` del SDK de ArcGIS, para los popups y controles del mapa;
  - el store `settings`, que lo persiste. Se lee antes de montar la app para que no haya parpadeo.
- **Formatos:** números, distancias, duraciones y fechas con `Intl` según el idioma: «3,4 km» en es/pt y «3.4 km» en en. Plurales con vue-i18n.
- **Sin conexión:** los tres catálogos se precachean en el service worker, así que el cambio de idioma funciona sin red.
- **Test de CI:** comprueba que los tres catálogos tienen las mismas claves y los mismos parámetros.

### 3. Contenido de las rutas

- **Textos cortos con `LocalizedText`:** nombre y resumen de la ruta, nombres de los puntos, textos de las acciones personalizadas (quiz, toast, redirect, info_sheet) y `alt` de las imágenes.

  ```ts
  export type Locale = 'es' | 'en' | 'pt';
  export type LocalizedText = string | Partial<Record<Locale, string>>;
  ```

  Un `string` simple está en el idioma de origen (`spec.locale`). Así, una ruta de usuario monolingüe no necesita nada especial y una ruta curada puede traer los tres idiomas.
- **Fichas por idioma:** hay una `PointContent` por idioma, en `RouteBundle.contents[contentRef][locale]`.
- **Respaldo:** si falta el idioma del usuario se usa el siguiente de la cadena: idioma del usuario → `spec.locale` → `en` → `es` → `pt`. Cuando se usa un respaldo, la interfaz lo indica: «Contenido disponible en español».
- **Sin conexión:** al iniciar una ruta se descarga su bundle con todos los idiomas, que es poco texto. Se puede cambiar de idioma a mitad de recorrido sin red.
- **Rutas curadas:** la CI exige los tres idiomas (`validate:routes --require-locales es,en,pt`).
- **Ni el motor ni el sistema de eventos producen texto:**
  - `EngineState.target` ya no lleva `name`: la interfaz resuelve el nombre por `pointId`;
  - el sistema de eventos pasa claves de traducción con parámetros (`UiText`) al `UiAdapter` y al `FeedbackAdapter`, que traducen con el idioma activo. Incluye las notificaciones.
- **`hashRouteSpec` cubre solo los campos que usa el motor:** puntos, posiciones, radios, orden, ajustes, trazado y triggers. Deja fuera los textos y el contenido de las acciones: corregir o traducir un texto, o ajustar un quiz, no invalida los recorridos guardados.

### 4. IA generativa

- **Idioma de cada petición:** el del usuario. El cliente envía siempre `locale`, que es obligatorio en `POST /api/v1/content/generate`.
- **Fuentes por idioma:** QID de Wikidata → *sitelinks* → la Wikipedia de ese idioma. Si no hay artículo en ese idioma, se usa el de otro como fuente, pero **la ficha sale siempre en el idioma del usuario** y `sources` enlaza el artículo que se usó de verdad.
- **Prompt:** fija el idioma de salida de forma explícita (por ejemplo: portugués europeo, trato de «tu»).
- **Lo generado se queda en su idioma**, aunque el usuario cambie de idioma después. Regenerar en otro idioma queda para el futuro.
- **Creador de rutas:** ya no pregunta el idioma; la ruta toma el de la app.
- **Caché y costes:** la caché de generaciones ya separaba por idioma. Además, `ai_generations` guarda `locale` para medir el coste por idioma.

## Consecuencias

- **Contratos:** cambian las secciones 6, 8 y 9 del plan antes de escribir código. Como aún no hay datos, `specVersion` sigue en 1 y no hace falta migración.
- **Contenido:** las rutas curadas se escriben en tres idiomas.
- **Diseño:** las pantallas deben aguantar textos más largos (es y pt ocupan en torno a un 30 % más que en). Se revisan a 360 px en los tres idiomas.
- **Otros idiomas:** añadir pt-BR u otro idioma es añadir un catálogo y una entrada en `Locale`.
