# Rumbo · Plan de la versión 2: retos, cuentas y gamificación

> **Estado:** borrador para revisar (2026-10-09). La versión 1 termina con la fase 7.3 ([PROJECT_PLAN.md](PROJECT_PLAN.md)). Este documento es la guía para construir la versión 2: qué se hace, con qué reglas, qué datos se guardan, cómo se protege la privacidad y en qué orden se construye. Las decisiones que faltan están en el §14, cada una con una recomendación.
> **Idiomas:** español, inglés y portugués de Portugal, como la versión 1 ([ADR 0001](adr/0001-multilenguaje.md)).

## 0. Cómo usar este documento

- **Se perfecciona antes de empezar.** Ninguna fase arranca con decisiones del §14 abiertas que le afecten.
- **Mismas reglas de trabajo que la versión 1** ([PROJECT_PLAN](PROJECT_PLAN.md) §0 y §3):
  - los tres módulos desacoplados;
  - los contratos en paquetes compartidos, validados con Zod;
  - código en inglés y documentación en español;
  - tests en verde antes de pasar de fase;
  - despliegue solo cuando lo pide el responsable del proyecto, primero la API y después la web.
- **Cada decisión de peso tiene su ADR** (§11.7). Al cerrar cada fase se actualizan `PROJECT_PLAN.md` (o este documento), `DESIGN.md`, `SECURITY.md` y `DEPLOY.md`.
- **Este plan no es asesoramiento jurídico.** El aviso de privacidad y los términos (§8) deben revisarlos un profesional antes de abrir los retos al público.

## 1. Qué es la versión 2

Rumbo tendrá **dos maneras de usarse, separadas y claras**:

- **Explorar (modo libre):** la guía de bolsillo de la versión 1. Rutas oficiales y de la comunidad, la guía con IA, crear rutas propias y descubrir cada lugar al llegar. **Sin cuenta, sin fricción.**
- **Retos (modo reto):** competir sobre el terreno.
  - Un **anfitrión** crea un reto sobre una ruta: puntos de control en orden, el tiempo límite que quiera y sus reglas de puntos. Lo comparte con un enlace o un código.
  - Los **participantes** se unen, lo juegan en la calle y quedan en una **clasificación**.
  - El anfitrión ve quién ganó: el apodo de cada participante, sus puntos y su tiempo.
  - Para ser anfitrión o participante **hace falta una cuenta**: así cada uno se identifica y guarda sus puntos, sus retos hechos y sus insignias.

Todo, **cumpliendo el RGPD**: datos mínimos, un aviso de privacidad claro, derechos que se ejercen desde la app y plazos de conservación limitados.

## 2. Principios

1. **Explorar sigue sin cuenta.** Nada de lo que hoy funciona sin registrarse pasa a exigirlo.
2. **Datos mínimos** (RGPD, art. 5.1.c). Se piden:
   - un **correo**, solo para entrar, nunca visible;
   - un **apodo público**;
   - la **confirmación de la edad mínima**.

   Nada de nombre real, fecha de nacimiento, teléfono ni foto de perfil.
3. **El servidor manda en los retos.** La hora de inicio y de fin, los puntos y la clasificación los calcula el servidor con los eventos del intento, nunca a partir de lo que diga el móvil. El móvil muestra una puntuación provisional calculada con las mismas reglas (§9.1).
4. **La ubicación, solo la imprescindible.** De un intento se guardan las **llegadas a los puntos de control** (hora y posición en ese momento), nunca un seguimiento continuo. Las posiciones se borran a los 90 días de cerrarse el reto (§8.8).
5. **La seguridad física, antes que la velocidad.** Los retos se juegan en la vía pública: avisos claros, sin bonificaciones que premien la temeridad (§5.9).
6. **Sin premios reales.** Los concursos con premio tienen su propia regulación. Rumbo da puntos e insignias, no premios, y los términos lo dicen (§8.4).
7. **Como la versión 1:** accesible (WCAG 2.2 AA), trilingüe y, donde se pueda, sin conexión.

## 3. Separar la app: Explorar y Retos

### 3.1 Navegación

La barra inferior pasa de 4 a 5 elementos:

| Pestaña | Contenido | ¿Cuenta? |
|---|---|---|
| **Explorar** (brújula) | Lo de la versión 1: rutas oficiales y de la comunidad, mapa (Puntos y Rutas) y la guía con IA | No |
| **Retos** (trofeo) | Retos cerca de ti, unirse con código, los retos en los que participas y los que organizas | Sí, para todo salvo ver qué es |
| **Crear** (+, destacado) | Elegir «Ruta para explorar» (el creador de la v1) o «Reto» | Solo para «Reto» |
| **Mis rutas** (marcador) | Las rutas creadas en este dispositivo y, con sesión, las de la cuenta | No |
| **Perfil** (persona) | Sin sesión: entrar y los Ajustes de siempre. Con sesión: apodo, puntos, insignias, historial, privacidad y Ajustes | Opcional |

### 3.2 Primer arranque

Tras elegir el idioma (S00), una pantalla nueva, **«¿Cómo quieres usar Rumbo?»**, con dos tarjetas:

- **Explorar a tu ritmo:** «Rutas y una guía con IA que te cuenta cada lugar al llegar. Sin cuenta.»
- **Retos:** «Compite con amigos en rutas con tiempo y puntos, o crea las tuyas. Necesitas una cuenta.»

La elección solo decide la pestaña inicial: las dos se pueden usar siempre. Si elige Retos, va a entrar (A1); puede saltarlo y quedarse en Explorar.

### 3.3 Qué cambia en Explorar

- Las rutas en **modo reto** dejan de listarse en Explorar: viven en Retos. Explorar muestra rutas en modo libre.
- **Mis rutas** sigue funcionando sin cuenta. Con sesión, se ofrece llevar las rutas del dispositivo a la cuenta (§4.6).
- Lo demás no cambia: comunidad, portadas, guía con IA y push.

### 3.4 Las rutas en modo reto de la versión 1

Hoy cualquiera puede crear una ruta en modo reto y recorrerla sola, con su cronómetro. En la versión 2 un reto es algo con cuenta, anfitrión y clasificación. Qué pasa con esas rutas es la decisión **D7** (§14). La recomendación:

- pasan a Explorar como **«ruta en orden»**: se recorren igual, con el orden y el tiempo, pero sin puntos de clasificación;
- su dueño, con cuenta, puede convertirlas en un reto con un toque («Convertir en reto»).

## 4. Cuentas

### 4.1 Qué se guarda

| Dato | Para qué | Visible para |
|---|---|---|
| Correo | Entrar y los avisos de la cuenta (enlace de acceso, cambios importantes) | Nadie más |
| Apodo | Identificarse en los retos y en las clasificaciones | Público dentro de los retos |
| Confirmación de edad mínima (con fecha) | Cumplir la edad mínima (§8.5) | Nadie |
| Idioma | Los correos y los avisos en su idioma | Nadie |
| Intereses (opcional) | Rellenar el creador y afinar las sugerencias de la IA | Nadie |
| Versiones del aviso de privacidad y de los términos aceptadas, con fecha | Demostrar el consentimiento y la aceptación (RGPD, art. 7) | Nadie |
| Identificador del proveedor (si entra con Google) | Reconocer la cuenta | Nadie |

**Avatar:** generado a partir del apodo (iniciales sobre un azulejo de la paleta), sin subir fotos (D12). Evita moderar fotos de caras y datos biométricos.

### 4.2 Cómo se entra

Decisión **D1** (§14). Recomendado: **enlace al correo y Google**.

- **Enlace al correo** («magic link»): se escribe el correo y llega un enlace de un solo uso que caduca a los 15 minutos. No hay contraseñas que guardar, recuperar ni que puedan robarse.
- **Google:** OAuth 2.0 con PKCE, `state` y `nonce`; solo los ámbitos `openid email profile`, y solo con un correo verificado.
- **Fuera de la v2:** Apple (exige la cuenta de desarrollador de pago; tiene sentido con la app nativa) y llaves de acceso (passkeys, buena mejora para una versión siguiente).
- **Cuentas iguales:** el mismo correo por enlace o por Google es la misma cuenta.

### 4.3 Sesiones

- Una cookie `rumbo_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, con `Path=/`. La web y la API comparten origen, así que no hace falta CORS ni guardar tokens en el almacenamiento del navegador, donde un XSS podría leerlos.
- El token es aleatorio (32 bytes). El servidor guarda solo su hash y lo compara en tiempo constante.
- **Caducidad:** 30 días sin uso, renovándose al usarse. Se rota al entrar.
- **Cerrar sesión:** en este dispositivo o en todos.
- **CSRF:** las peticiones que cambian algo con la cookie exigen además una cabecera propia (`X-Rumbo-CSRF: 1`) y un `Origin` igual al del sitio.
- **El `X-Device-Id` sigue existiendo,** para lo que no necesita cuenta (Explorar, analítica, push). Con sesión, la API sabe además qué cuenta es.

### 4.4 Alta

1. Entrar (A1) con el correo o con Google.
2. **Completar el perfil** (A3), solo la primera vez:
   - el apodo: único (sin distinguir mayúsculas ni acentos), de 3 a 20 caracteres (letras, números, `_`, `.` y `-`), con una lista de nombres reservados («admin», «rumbo», «moderador»…) y un filtro básico de insultos en los tres idiomas;
   - la casilla de edad: «Tengo al menos 16 años» (D2);
   - la aceptación del aviso de privacidad y de los términos, con enlaces a los dos textos y su versión registrada.
3. Opcional: los intereses.

### 4.5 Perfil y ajustes

- El apodo se puede cambiar una vez cada 30 días (D14). En las clasificaciones sale siempre el apodo actual.
- Idioma, intereses, notificaciones y los Ajustes de la v1 (tema, «Sol», unidades, simulación, estadísticas).
- **Sesiones:** «Cerrar sesión» y «Cerrar sesión en todos los dispositivos».

### 4.6 Mis rutas y la cuenta

Al entrar por primera vez en un dispositivo con rutas propias, se ofrece **«Guardar tus rutas en tu cuenta»** (D11):

- el dispositivo envía el id y el token de edición de cada una, y el servidor las pasa a la cuenta (`owner_user_id`; la columna existe desde la fase 6);
- desde entonces se editan con la sesión, desde cualquier dispositivo con esa cuenta;
- las rutas que no se suben siguen solo en el dispositivo.

### 4.7 Borrar la cuenta y exportar los datos

- **Exportar** (Perfil → Privacidad y datos): un JSON con la cuenta, los consentimientos, las rutas, los retos organizados, los intentos (con sus posiciones si aún se guardan) y las insignias. Se descarga al momento: es el derecho de acceso y de portabilidad (arts. 15 y 20).
- **Borrar** (D8): pide confirmar escribiendo el apodo y cierra todas las sesiones. Se borran:
  - el correo, las identidades, los intereses y los consentimientos;
  - sus rutas, y sus fotos con ellas;
  - **las posiciones de sus intentos.**

  En las clasificaciones de otros, sus resultados quedan como **«Participante eliminado»**, sin apodo, para no romper las de los demás. Sus retos organizados se cierran y su anfitrión pasa a «Anfitrión eliminado».
- Las copias de seguridad guardan los datos borrados hasta 14 días ([DEPLOY.md](DEPLOY.md)), y el aviso de privacidad lo dice.

### 4.8 Correos

- Un proveedor de correo transaccional con servidores en la UE (D10). La clave, como variable de Coolify solo de ejecución.
- El dominio con SPF, DKIM y DMARC.
- **Plantillas en los tres idiomas:**
  - enlace de acceso;
  - «Tu cuenta se ha borrado»;
  - cambios del aviso de privacidad, si los hay.
- Nada de publicidad.
- **Límites:** enlaces de acceso por correo (3 cada 15 minutos) y por IP. La respuesta es siempre la misma, exista la cuenta o no.

## 5. Retos

### 5.1 Conceptos

| Concepto | Qué es |
|---|---|
| **Ruta** | La geografía y el contenido: puntos, radios, fichas y lo que pasa al llegar (lo de la v1). Una ruta de reto va en orden (`mode: 'challenge'`) |
| **Reto** | Una competición sobre una ruta, con anfitrión, reglas de puntos, tiempo límite, ventana de juego, visibilidad y código. Una misma ruta puede tener varios retos |
| **Anfitrión** | La cuenta que crea el reto. Ve a todos los participantes y sus resultados |
| **Participante** | Una cuenta que se ha unido al reto |
| **Intento** | Una partida de un participante: la empieza y la termina el servidor |
| **Punto de control** | Un punto de la ruta en el reto; los obligatorios se hacen en orden |
| **Clasificación** | El mejor intento válido de cada participante, ordenado (§5.6) |

### 5.2 Crear un reto (anfitrión)

Desde Crear → «Reto», o desde una ruta propia → «Convertir en reto». Un asistente de cuatro pasos:

1. **La ruta:** una nueva (el creador de la v1 en modo reto) o una de Mis rutas, que pasa a ir en orden.
2. **Las reglas** (§5.5): puntos por punto de control, por pregunta acertada y por tiempo que sobra; el **tiempo límite libre**, en minutos (de 5 a 600, o sin límite); y los intentos por participante (D4).
3. **Cuándo y quién** (D5):
   - la ventana de juego (abre y cierra, en la hora de la zona del reto);
   - la visibilidad: «Solo con enlace o código» o «Público cerca» (en Retos cerca de ti, a 30 km o menos, como las rutas de la comunidad);
   - el máximo de participantes (opcional);
   - quién ve la clasificación (D3).
4. **Revisar y publicar:** el resumen de las reglas, el aviso de seguridad (§5.9) y **Publicar el reto**. Al publicarlo sale un **código** de 6 caracteres (sin letras ambiguas: ni 0/O ni 1/I), un enlace y un QR.

Un reto publicado no cambia de reglas ni de ruta mientras alguien tenga un intento hecho. El anfitrión puede ampliar la ventana, cerrarlo antes o cancelarlo, y los participantes reciben un aviso.

### 5.3 Unirse

- Desde **Retos cerca de ti**, un **enlace**, un **código** o un **QR**.
- **Sin sesión:** se explica el reto y se pide entrar. Al volver, sigue en el reto.
- **Antes de unirse** se muestra:
  - las reglas, la ventana y la distancia;
  - el aviso de seguridad;
  - qué se registra: «Durante el reto guardamos la hora y la posición de tus llegadas a los puntos de control para validar tu resultado. Las posiciones se borran 90 días después de que termine el reto.»

  Y el botón **Unirme**.
- **Dejar el reto:** posible antes de jugarlo; después, el resultado se queda.

### 5.4 Jugar un intento

1. **Preparar** (como S04):
   - el GPS es obligatorio, con su permiso;
   - **la simulación no está disponible en los retos**: para practicar está el modo práctica (una prueba sin puntuar, como «Probar ruta»);
   - se comprueba que el reto está abierto y que quedan intentos.
2. **Empezar:** `POST /challenges/:id/attempts`. El servidor apunta la hora de inicio y devuelve el intento, las reglas y el hash de la ruta. Hace falta conexión para empezar.
3. **Recorrido** (una variante de S05):
   - el cronómetro del tiempo límite y la puntuación provisional;
   - los puntos de control en orden y, en cada uno, lo que el creador eligió al llegar (ficha, pregunta, vídeo…).
4. **Cada llegada** se envía al servidor (`POST /attempts/:id/checkpoints`): el punto, la hora del móvil, la posición (redondeada a 4 decimales, unos 11 m), la precisión y la respuesta, si hubo pregunta. Sin conexión, se guarda en una cola y se envía al volver (§7).
5. **Terminar:** al llegar al último punto obligatorio, al acabar el tiempo o con «Terminar». Hace `POST /attempts/:id/finish`, el servidor apunta la hora de fin y calcula el resultado.
6. **Resultado** (R6):
   - los puntos con su desglose (por punto, por pregunta y por tiempo) y el tiempo;
   - el puesto en la clasificación, si la ve (D3);
   - las insignias ganadas.

### 5.5 Puntuación

Las reglas viven en el reto, no en la ruta, y las aplican el móvil (provisional) y el servidor (definitiva) con la misma función (§9.1). Los valores por defecto (D6), que el anfitrión puede cambiar:

| Regla | Por defecto | Rango |
|---|---|---|
| Punto de control alcanzado | 100 pts | 0–1000 |
| Punto de control opcional alcanzado | 50 pts | 0–1000 |
| Pregunta acertada (la trivia de la ficha o una propia) | 50 pts | 0–1000 |
| Tiempo que sobra, si hay límite y se termina | 10 pts por minuto entero | 0–100 por minuto |
| Tope de la bonificación por tiempo | 30 % de los puntos de control y las preguntas | fijo (§5.9) |
| Fuera de tiempo | El intento termina solo: cuentan lo alcanzado y las respuestas, sin bonificación | — |
| Desempate | Menos tiempo; si sigue, quien terminó antes | — |

### 5.6 Clasificación

- Cuenta **el mejor intento válido** de cada participante: más puntos; a igualdad, menos tiempo; y luego quien terminó antes.
- **Estados de un intento:** en curso, terminado, fuera de tiempo, abandonado, **en revisión** (lo marcaron las reglas antitrampas, §7), anulado (por el anfitrión, con motivo) y descalificado.
- Muestra el puesto, el apodo, el avatar, los puntos, el tiempo, los puntos de control alcanzados y una marca si el intento se registró sin conexión.
- **El líder:** la tarjeta del reto lo muestra («Líder: @apodo · 820 pts»), y la clasificación lo destaca.
- **Quién la ve:** D3. Recomendado: el anfitrión y los participantes.

### 5.7 Panel del anfitrión

- Participantes unidos, intentos en curso con su progreso (sin posición en vivo) y resultados.
- **Anular** un resultado, con motivo: el participante recibe un aviso con el motivo. **Revisar** los intentos en revisión: validarlos o anularlos.
- Cerrar el reto antes de tiempo, ampliar la ventana o cancelarlo.
- **Exportar CSV** con puesto, apodo, puntos y tiempo, nunca el correo.
- **Avisos push:** alguien terminó, hay un nuevo líder y el reto se cierra en 1 hora.

### 5.8 Notificaciones

Por push (la infraestructura de la fase 7.1) y solo con el permiso del usuario:

- **Para el participante:** el reto abre, se cierra en 24 horas, tu resultado fue anulado o revisado, y la clasificación final.
- **Para el anfitrión:** el primer participante, un participante terminó, un nuevo líder y el cierre del reto.
- Cada aviso, en el idioma de la suscripción. Respetan las horas de silencio de la v1 (22:00 a 08:00), salvo los de un reto en curso.

### 5.9 Seguridad física y conducta

- **Aviso antes de unirse y antes de cada intento:** «Los retos se juegan en la calle. Respeta las normas de tráfico, no entres en propiedades privadas y no corras riesgos por ganar tiempo.»
- **Para no premiar la temeridad:**
  - la bonificación por tiempo tiene tope (§5.5);
  - las velocidades imposibles marcan el intento (§7);
  - en bici, el aviso añade el casco y el carril.
- **El anfitrión** es responsable de que sus puntos de control estén en lugares públicos, seguros y accesibles (términos, §8.4). Se puede reportar un reto (§7.3).

## 6. Gamificación

- **Puntos de cada reto** (§5.5) y **puntos Rumbo** acumulados en el perfil: la suma de los mejores intentos válidos.
- **Historial:** los retos jugados (puesto, puntos, fecha) y los organizados (participantes y ganador).
- **Insignias**, definidas en código (no se suben ni se editan), con sus textos en los tres idiomas. El catálogo inicial:

| Insignia | Se gana al… |
|---|---|
| Primer paso | Terminar tu primer reto |
| Constante | Terminar 5 retos |
| Sabelotodo | Acertar todas las preguntas de un reto (al menos 3) |
| Contrarreloj | Terminar un reto con tiempo límite sin pasarte |
| Podio | Quedar entre los 3 primeros de un reto con al menos 5 participantes |
| Anfitrión | Organizar tu primer reto con al menos 3 participantes |
| Explorador | Recorrer 10 rutas en Explorar (cuenta solo si tienes sesión) |

- **El líder** de cada reto destaca en su tarjeta y en su clasificación (§5.6).
- **Fuera de la v2:** niveles, clasificaciones globales o por ciudad, rachas, retos por equipos y premios (§15).

## 7. Antitrampas

Una clasificación invita a hacer trampas. La web no puede detectar un GPS falso: eso llega con la app nativa (§15). La v2 hace lo que se puede hacer bien.

### 7.1 Lo que asegura el servidor

- **El tiempo:** el inicio y el fin los pone el servidor. El tiempo de un intento es su diferencia, nunca lo que diga el móvil.
- **El orden:** el servidor rechaza una llegada fuera de orden a un punto obligatorio.
- **El radio:** la posición de la llegada tiene que estar dentro del radio del punto más la precisión declarada, con un máximo de 50 m de margen.
- **Velocidades plausibles** entre llegadas seguidas (en línea recta) y en total (la distancia de la ruta entre el tiempo):

| Actividad | Velocidad máxima plausible | Más del doble |
|---|---|---|
| A pie | 10 km/h | El intento queda **en revisión** |
| Corriendo | 25 km/h | En revisión |
| En bici | 45 km/h | En revisión |

  Por encima del máximo pero por debajo del doble, el intento sigue válido con una marca que ve el anfitrión.
- **Las llegadas sin conexión** se aceptan si llegan antes de que se cierre el reto y sus horas encajan entre el inicio y el fin del servidor. La clasificación las marca como «registrado sin conexión».
- **Ni simulación ni pruebas:** la app nunca empieza un intento en simulación o en modo práctica. Si llega uno marcado como simulado, el servidor lo rechaza.

### 7.2 Lo que decide una persona

- El anfitrión revisa los intentos en revisión y puede anular cualquiera, con motivo.
- Un participante puede reportar un resultado (§7.3).
- **Cuentas múltiples:** una por correo. No se pueden impedir del todo, y para eso está la anulación del anfitrión.

### 7.3 Reportes y moderación

- Se reutiliza el sistema de la fase 7.2 (reportes y moderación con `ADMIN_TOKEN`), ahora también para **retos**, **apodos** y **resultados**.
- Con cuentas, los reportes cuentan **por cuenta**, no por dispositivo: 3 cuentas distintas ocultan un reto o cambian un apodo ofensivo por «Jugador123» hasta la revisión.
- Una pantalla de moderación para el responsable del proyecto (hoy se hace con `curl`) entra en la v2.5, protegida por una cuenta con rol de moderador.

## 8. Privacidad y RGPD

### 8.1 Responsable del tratamiento

- El responsable del proyecto, como persona física (decisión **D9**: el nombre o la marca, y un correo de contacto dedicado a la privacidad).
- Sin delegado de protección de datos (DPD): no es obligatorio a esta escala (art. 37). Si la app crece, se revisa.
- **La autoridad de control** depende del país del usuario: la CNPD en Portugal y la AEPD en España.

### 8.2 Inventario de datos

| Dato | Para qué | Base jurídica (RGPD, art. 6) | Quién lo ve | Cuánto se guarda |
|---|---|---|---|---|
| Correo, apodo, edad confirmada, idioma, intereses | La cuenta | Contrato (6.1.b) | El apodo, público en los retos; lo demás, nadie | Mientras exista la cuenta |
| Aceptaciones del aviso y de los términos | Demostrarlas | Obligación legal (6.1.c) | Nadie | Mientras exista la cuenta y 3 años después |
| Sesiones (hash, fechas, navegador abreviado) | Mantener la sesión y la seguridad | Contrato e interés legítimo (6.1.f) | Su dueño, en «Sesiones» | 30 días sin uso |
| Enlaces de acceso (hash) | Entrar | Contrato | Nadie | 15 minutos, o hasta usarse |
| Participación e intentos (horas, puntos, estado) | Jugar el reto y la clasificación | Contrato | Anfitrión y participantes (D3) | Mientras exista el reto. Al borrar la cuenta, anonimizados |
| Posición y precisión de cada llegada | Validar el resultado (§7) | Contrato e interés legítimo | El anfitrión ve el estado de validación, no las posiciones | **90 días tras cerrarse el reto**; después se borran y quedan las horas y los puntos |
| Retos organizados | Organizarlos | Contrato | Los participantes (y el público, si es público) | Mientras exista la cuenta |
| Reportes | Moderar | Interés legítimo | El responsable del proyecto | Hasta resolverse y 1 año después |
| Lo de la v1 sin cuenta (`X-Device-Id`, rutas, analítica, push y fotos) | Lo descrito en [SECURITY.md](SECURITY.md) | Contrato; analítica y push, con consentimiento (6.1.a) | Lo de la v1 | Lo de la v1 |
| Logs del servidor (sin datos personales en claro, como en la v1) | Seguridad y errores | Interés legítimo | El responsable del proyecto | 14 días |

### 8.3 Aviso de privacidad

- **Una página propia** (`/privacy`, «Aviso de privacidad» en los tres idiomas), con versión y fecha. Se enlaza desde:
  - el alta (A3);
  - Perfil → Privacidad y datos;
  - el pie de Ajustes;
  - la tienda de apps, cuando llegue la nativa.
- **Contenido** (arts. 13 y 14), en lenguaje claro:
  1. Quién es el responsable y cómo contactar.
  2. Qué datos se tratan, para qué y con qué base (el §8.2, en lenguaje llano).
  3. Encargados y destinatarios (§8.7), y las transferencias fuera de la UE con sus garantías.
  4. Plazos de conservación.
  5. Derechos: acceso, rectificación, supresión, portabilidad, oposición, limitación y retirar el consentimiento. Cómo ejercerlos (en la app y por correo) y el derecho a reclamar ante la autoridad.
  6. La edad mínima (§8.5).
  7. La seguridad, en general.
  8. Cómo se avisa de los cambios.
- **Un cambio importante** exige volver a aceptar al entrar, y se registra la nueva versión.
- **Explorar sin cuenta** también lo enlaza (hoy hay una hoja de consentimiento de estadísticas, S00b).

### 8.4 Términos de uso

Una página propia (`/terms`) en los tres idiomas, que se acepta en el alta:

- qué es Rumbo y que es gratuito;
- la conducta (sin contenido ofensivo, sin suplantar a nadie, sin trampas);
- **la seguridad en los retos** (§5.9): cada uno juega bajo su responsabilidad y respetando la ley;
- las responsabilidades del anfitrión (lugares públicos y seguros, nada de premios ni apuestas a través de Rumbo);
- la moderación (qué se puede ocultar o borrar y por qué);
- la licencia del contenido que sube el usuario, para mostrarlo en la app;
- el cierre de cuentas por abuso;
- la limitación de responsabilidad y la ley aplicable.

### 8.5 Menores

- **Edad mínima para tener cuenta:** D2. Recomendado: **16 años**, la edad de consentimiento digital por defecto del RGPD (art. 8), sin depender de cada país (Portugal la baja a 13 y España a 14).
- Se confirma con una casilla, sin pedir la fecha de nacimiento (dato mínimo).
- Explorar sin cuenta sigue abierto a todos.

### 8.6 Derechos desde la app

- **Acceso y portabilidad:** «Descargar mis datos» (JSON, §4.7).
- **Rectificación:** editar el perfil.
- **Supresión:** «Borrar mi cuenta» (§4.7).
- **Oposición y retirar el consentimiento:** los interruptores de estadísticas y de push.
- **Lo demás:** por correo al contacto de privacidad, con respuesta en un mes como máximo (art. 12.3).

### 8.7 Encargados y terceros

| Quién | Para qué | Datos | Dónde |
|---|---|---|---|
| Contabo (VPS) | Alojamiento de la API, la base de datos y la web | Todos los del servidor | UE (Alemania) |
| Proveedor de correo (D10) | Enviar los correos de la cuenta | Correo, idioma y el contenido del correo | UE, recomendado |
| Google (si se entra con Google) | Identificar al usuario | El identificador y el correo que Google comparte | Google es responsable independiente de su inicio de sesión |
| Servicios push (Google, Apple, Mozilla y Microsoft) | Entregar los avisos | Los avisos, cifrados, y la dirección del navegador | Según el navegador |
| Esri (mapa base) | Mostrar el mapa | La IP del dispositivo, al pedir las teselas | — |
| Wikimedia y YouTube (sin cookies) | Fotos y vídeos de las fichas | La IP del dispositivo, al cargarlos | — |
| Anthropic (IA) | Escribir las fichas y las sugerencias | Nombres y posiciones de **lugares**, nunca datos de usuarios | EE. UU. Sin datos personales |

Hace falta un contrato de encargado (art. 28) con el alojamiento y con el proveedor de correo; los proveedores grandes lo ofrecen en sus condiciones.

### 8.8 Conservación y borrado automático

Un trabajo diario (como la limpieza de fotos de la v1):

- borra las posiciones de los intentos de los retos cerrados hace más de 90 días;
- borra las sesiones caducadas y los enlaces de acceso usados o caducados;
- termina de borrar las cuentas pedidas hace más de 30 días, si el borrado se hace en dos pasos (D8).

### 8.9 Brechas de seguridad

Un procedimiento escrito en `SECURITY.md`:

- detectarla y contenerla;
- evaluar el riesgo;
- notificar a la autoridad en 72 horas si hay riesgo para las personas (art. 33) y a los afectados si el riesgo es alto (art. 34);
- registrarla siempre.

### 8.10 Registro de actividades de tratamiento

Un documento interno (`docs/privacy/registro-tratamientos.md`) con las actividades del §8.2 (art. 30). A esta escala no siempre es obligatorio, pero ordena el trabajo y sirve si la autoridad pregunta.

### 8.11 Cookies y almacenamiento

- La cookie de sesión y el almacenamiento local (IndexedDB y `localStorage`) son **técnicos y necesarios**: no piden consentimiento (ePrivacy, art. 5.3), pero el aviso los explica.
- La analítica sigue con su consentimiento (v1). No hay cookies de terceros ni publicidad.

## 9. Arquitectura y datos

### 9.1 Paquetes

- **`@rumbo/scoring` (nuevo, TS puro):** `ChallengeRules` (Zod) y `scoreAttempt(rules, route, events, timeLimit)`, que devuelve el total y el desglose. Lo usan la web (puntuación provisional) y la API (definitiva): una sola definición, como las acciones en `route-spec`.
- **`@rumbo/api-contract`:** los esquemas nuevos: `Me`, `ChallengeSummary`, `Challenge`, `ChallengeRules` (reexportado), `Attempt`, `CheckpointEvent`, `LeaderboardEntry`, `HostPanel` y los códigos de error nuevos (`unauthenticated`, `forbidden_role`, `challenge_closed`, `attempt_limit`, `nickname_taken`, `out_of_order`, `outside_radius`…).
- **`@rumbo/geo-engine` y `@rumbo/event-system`:** sin cambios de diseño. El modo reto ya existe. El cronómetro y la puntuación provisional salen de `scoring`, y las preguntas puntúan con las reglas del reto.
- **`@rumbo/route-builder`:** el creador de retos reutiliza el de rutas en modo reto. Las reglas no van en la ruta.

### 9.2 Base de datos (tablas nuevas)

| Tabla | Columnas principales |
|---|---|
| `users` | `id` uuid, `email` (único, sin distinguir mayúsculas), `email_verified_at`, `nickname` (único, sin distinguir mayúsculas ni acentos), `nickname_changed_at`, `locale`, `interests` jsonb, `age_confirmed_at`, `role` (`user`\|`moderator`), `created_at`, `deleted_at` |
| `auth_identities` | `user_id`, `provider` (`google`), `subject`. Único (`provider`, `subject`) |
| `login_tokens` | `token_hash` (pk), `email`, `expires_at`, `used_at` |
| `sessions` | `id`, `user_id`, `token_hash` (único), `created_at`, `last_seen_at`, `expires_at`, `user_agent` (abreviado), `revoked_at` |
| `consents` | `user_id`, `document` (`privacy`\|`terms`), `version`, `accepted_at` |
| `challenges` | `id`, `route_id`, `host_user_id`, `rules` jsonb, `time_limit_s`, `opens_at`, `closes_at`, `max_attempts`, `max_participants`, `visibility` (`link`\|`public`), `leaderboard` (D3), `join_code` (único), `status` (`draft`\|`open`\|`closed`\|`cancelled`), timestamps |
| `challenge_participants` | `challenge_id`, `user_id`, `joined_at`, `left_at` |
| `attempts` | `id` uuid, `challenge_id`, `user_id`, `route_spec_hash`, `started_at`, `finished_at` (los dos del servidor), `status`, `score`, `breakdown` jsonb, `elapsed_ms`, `flags` jsonb, `annul_reason` |
| `attempt_checkpoints` | `attempt_id`, `point_id`, `reached_at_client`, `received_at`, `lat` y `lng` (4 decimales; nulos tras 90 días), `accuracy_m`, `answer_correct`, `points`, `flags`, `offline` |
| `user_badges` | `user_id`, `badge_id`, `earned_at`, `challenge_id` |

- **En lo que ya existe:**
  - `routes.owner_user_id` pasa a usarse;
  - `route_reports` admite también retos, apodos y resultados (o una tabla `reports` general: se decide en el ADR del §11.7);
  - `push_subscriptions` gana un `user_id` opcional, para avisar a la cuenta en todos sus dispositivos.
- **Migraciones:** como en la v1, aplicadas al arrancar, solo añadiendo, y comprobadas sobre una base con datos de la v1.

### 9.3 API (resumen)

| Grupo | Endpoints |
|---|---|
| Entrar | `POST /auth/email/start` · `POST /auth/email/verify` · `GET /auth/google/start` · `GET /auth/google/callback` · `POST /auth/logout` (`?all=1`) |
| Cuenta | `GET /me` · `PATCH /me` (apodo, idioma, intereses) · `POST /me/consents` · `GET /me/sessions` · `DELETE /me/sessions/:id` · `GET /me/export` · `DELETE /me` · `POST /me/claim-routes` |
| Retos | `GET /challenges?near=` (públicos y abiertos) · `GET /challenges/:id` · `POST /challenges` · `PATCH /challenges/:id` · `POST /challenges/:id/close` · `DELETE /challenges/:id` (cancelar) · `POST /challenges/join` (`{ code }`) · `POST /challenges/:id/join` · `POST /challenges/:id/leave` |
| Intentos | `POST /challenges/:id/attempts` (empezar) · `POST /attempts/:id/checkpoints` · `POST /attempts/:id/finish` · `GET /attempts/:id` |
| Clasificación y anfitrión | `GET /challenges/:id/leaderboard` · `GET /challenges/:id/host` (panel) · `POST /attempts/:id/annul` · `POST /attempts/:id/validate` · `GET /challenges/:id/export.csv` |
| Perfil | `GET /me/history` · `GET /me/badges` · `GET /users/:nickname` (perfil público mínimo: apodo, avatar, insignias y puntos Rumbo) |
| Moderación | Lo de la v1, más los reportes de retos, apodos y resultados, y un rol `moderator` para la pantalla de moderación |

Todo con los mismos criterios de la v1: Zod, errores por código, límites por IP y por cuenta, logs sin datos personales y OpenAPI.

### 9.4 Web

- **Tiendas Pinia nuevas:** `account` (la sesión y el perfil), `challenges` y `attempt` (el intento en curso, con su cola de llegadas en IndexedDB).
- **Rutas nuevas:**
  - `/welcome/mode`, `/login` y `/login/check`;
  - `/profile`, `/profile/privacy`, `/privacy` y `/terms`;
  - `/challenges`, `/challenges/join`, `/challenges/:id`, `/challenges/:id/play`, `/challenges/:id/result` y `/challenges/:id/leaderboard`;
  - `/host/new` y `/host/:id`.
- **El recorrido de un reto** reutiliza `RunView`, con un modo «reto»: el cronómetro del servidor, la puntuación provisional y sin simulación ni «Editar ruta».
- **Sin conexión:** se ve el reto y la clasificación guardados; un intento en curso sigue y encola sus llegadas. Empezar y terminar necesitan red; si falta al terminar, el intento queda «terminando» y se cierra al volver la red, con la hora de la última llegada.

### 9.5 Seguridad (además de la v1)

- Sesiones y CSRF (§4.3), enlaces de acceso (§4.2) y OAuth con PKCE.
- **Autorización comprobada en el servidor:**
  - solo el anfitrión ve su panel y anula;
  - solo un participante empieza intentos;
  - solo el dueño edita su ruta o su perfil.

  Con tests de «otro usuario no puede» en cada endpoint.
- **Límites nuevos:** los enlaces de acceso, el alta, los cambios de apodo, unirse con código (contra adivinar códigos) y las llegadas por intento.
- **Los secretos nuevos** (la clave del proveedor de correo y el cliente OAuth de Google) van en `apps/api/.env` y en Coolify, solo de ejecución.

### 9.6 Variables de entorno nuevas (borrador)

`SESSION_TTL_DAYS` (30) · `LOGIN_LINK_TTL_MIN` (15) · `EMAIL_PROVIDER` · `EMAIL_API_KEY` (secreto) · `EMAIL_FROM` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` (secreto) · `MIN_ACCOUNT_AGE` (16) · `CHECKPOINT_POSITION_RETENTION_DAYS` (90) · `CHALLENGE_JOIN_RATE_LIMIT_PER_MINUTE`

## 10. Pantallas nuevas (para DESIGN)

| Id | Pantalla |
|---|---|
| S00c | ¿Cómo quieres usar Rumbo? (dos tarjetas) |
| A1 | Entrar: el correo y «Continuar con Google» |
| A2 | Revisa tu correo: reenviar a los 60 s y «Usar otro correo» |
| A3 | Completar el perfil: apodo (comprobado al escribir), edad, aviso y términos |
| P1 | Perfil: avatar, apodo, puntos Rumbo, insignias, historial, Ajustes y cerrar sesión |
| P2 | Editar perfil: apodo (y cuándo se puede volver a cambiar), idioma e intereses |
| P3 | Privacidad y datos: descargar mis datos, sesiones, borrar mi cuenta, y enlaces al aviso y a los términos |
| R1 | Retos: sin sesión, qué son y Entrar; con sesión, cerca de ti, unirse con código, participando y organizados por mí |
| R2 | Detalle de un reto: portada, reglas, ventana, distancia, el líder, participantes, Unirme o Jugar |
| R3 | Unirse con código: 6 casillas, pegar y escanear QR |
| R4 | Preparar el intento: GPS, aviso de seguridad, intentos que quedan y Empezar |
| R5 | Recorrido de reto: S05 con cronómetro, puntuación provisional y estado de envío de las llegadas |
| R6 | Resultado del intento: puntos con desglose, tiempo, puesto e insignias |
| R7 | Clasificación: puestos, el líder destacado, tu posición fija abajo, y marcas de revisión y sin conexión |
| H1 | Crear reto: ruta → reglas → cuándo y quién → revisar y publicar |
| H2 | Panel del anfitrión: participantes, en curso, resultados, revisar y anular, cerrar, exportar |
| H3 | Compartir el reto: código grande, enlace, QR y compartir del sistema |
| L1 | Aviso de privacidad |
| L2 | Términos de uso |

Los mockups se diseñan antes de cada fase con el sistema de diseño de la v1 ([DESIGN.md](DESIGN.md)).

## 11. Fases de construcción

### Fase 2.0: base legal y cuentas

- [ ] El aviso de privacidad y los términos (borrador en los tres idiomas, para la revisión jurídica), con las páginas `/privacy` y `/terms` y su versión.
- [ ] Las cuentas: el enlace al correo (y Google, según D1), las sesiones con cookie y CSRF, el alta con apodo, edad y aceptaciones, y el perfil mínimo.
- [ ] Descargar mis datos, borrar mi cuenta, sesiones y cerrar sesión en todos los dispositivos.
- [ ] Guardar las rutas del dispositivo en la cuenta (D11).
- [ ] El trabajo de conservación (§8.8) y el procedimiento de brechas (§8.9).
- **DoD:**
  - tests de la API (alta, enlaces, sesiones, CSRF, borrado y exportación) y e2e (alta por correo con el proveedor simulado, borrar la cuenta);
  - una revisión de seguridad;
  - el aviso de privacidad revisado por el responsable del proyecto;
  - el ADR de cuentas.

### Fase 2.1: separar Explorar y Retos

- [ ] La navegación de 5 pestañas, la pantalla S00c, Perfil con los Ajustes dentro, y la pestaña Retos sin sesión y con sesión (aún vacía).
- [ ] Explorar sin rutas en modo reto, y lo que decida D7 con las de la v1.
- **DoD:** e2e de los dos caminos de arranque; sin regresiones de Explorar (las e2e de la v1 en verde).

### Fase 2.2: retos para anfitriones

- [ ] El paquete `scoring` con las reglas y sus tests.
- [ ] Crear el reto (H1), compartirlo (H3: código, enlace y QR), el detalle (R2), unirse (R3) y Retos cerca de ti.
- [ ] Ampliar la ventana, cerrar y cancelar, con sus avisos.
- **DoD:** tests de autorización (solo el anfitrión) y e2e de crear y unirse con dos cuentas.

### Fase 2.3: jugar y puntuar

- [ ] El intento con el servidor como reloj: empezar, enviar las llegadas (con la cola sin conexión) y terminar; el recorrido de reto (R5) y el resultado (R6).
- [ ] La puntuación definitiva en el servidor con `scoring`, y las validaciones del §7.1.
- **DoD:**
  - tests de la API con trayectos grabados (válidos, fuera de orden, fuera del radio, velocidades imposibles, sin conexión);
  - e2e de un intento completo con un «GPS de pruebas» que solo existe en el entorno de tests (nunca en producción).

### Fase 2.4: clasificación y panel del anfitrión

- [ ] La clasificación (R7) con sus reglas de orden y visibilidad (D3), el líder en la tarjeta del reto, y el panel del anfitrión (H2: revisar, anular, cerrar y exportar CSV).
- [ ] Los avisos push del §5.8, por cuenta.
- **DoD:** tests de orden y desempate, de visibilidad y de anulación; e2e del anfitrión anulando un resultado.

### Fase 2.5: gamificación y moderación

- [ ] Los puntos Rumbo, el historial, las insignias del §6 y el perfil público mínimo.
- [ ] Los reportes de retos, apodos y resultados, el rol de moderador y la pantalla de moderación.
- **DoD:** tests de cada insignia (gana, no gana, no se repite); e2e de reportar un apodo y que el moderador lo cambie.

### 11.6 Para todas las fases

- Los textos en los tres idiomas.
- Accesibilidad (lector de pantalla, teclado y contraste «Sol»).
- La documentación actualizada.
- La CI en verde.
- El despliegue cuando lo pida el responsable del proyecto, primero la API.

### 11.7 ADR previstos

- **0006,** cuentas y sesiones (métodos de acceso, cookie y CSRF).
- **0007,** retos (modelo, reglas y clasificación).
- **0008,** privacidad (inventario, bases jurídicas y conservación).
- **0009,** antitrampas (lo que se valida y lo que decide una persona).

## 12. Tests y criterios de aceptación de la versión 2

- **Un anfitrión y tres participantes de prueba**, en el entorno de tests:
  - el anfitrión crea un reto con tiempo límite y reglas propias, y lo comparte por código;
  - los tres se unen y lo juegan (uno sin conexión en un tramo, otro con una velocidad imposible);
  - la clasificación los ordena bien, marca el que va sin conexión, deja en revisión el imposible, y el anfitrión lo anula;
  - las insignias salen.
- **Un usuario borra su cuenta:** sus datos desaparecen, sus resultados quedan anonimizados en la clasificación de otro reto, y su exportación previa contenía todo lo del §4.7.
- **Explorar sigue funcionando sin cuenta,** exactamente como en la v1.
- **Las posiciones de los intentos** se borran a los 90 días de cerrarse el reto (test del trabajo de conservación con un reloj inyectado).

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| El registro espanta a la gente | Explorar sigue sin cuenta; los retos explican por qué piden una antes de pedirla |
| GPS falso en los retos | Las validaciones del §7 y la anulación del anfitrión; la detección real llega con la app nativa |
| Retos peligrosos (velocidad, propiedades privadas) | Avisos, tope de bonificación, términos y reportes |
| Apodos o retos ofensivos | Filtro básico, reportes por cuenta y moderación |
| Cumplimiento legal incompleto | La revisión jurídica antes de abrir los retos (§0), el inventario (§8.2) y el registro (§8.10) |
| Correos que no llegan (spam) | Un proveedor serio, SPF, DKIM y DMARC, y «Usar otro correo» y reenviar en A2 |
| La base de datos crece (intentos y llegadas) | Las posiciones se borran a los 90 días; índices por reto y por cuenta |

## 14. Decisiones pendientes

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Cómo se entra | Enlace al correo · Google · los dos · añadir passkeys | **Enlace al correo y Google**; passkeys más adelante |
| D2 | Edad mínima | 16 · la de cada país (13 en Portugal, 14 en España) | **16**: una sola regla en toda la UE y sin consentimiento parental |
| D3 | Quién ve la clasificación | Solo el anfitrión · anfitrión y participantes · pública | **Anfitrión y participantes**, y que el anfitrión pueda hacerla pública |
| D4 | Intentos por participante | Siempre 1 · lo decide el anfitrión · ilimitados | **Lo decide el anfitrión, 1 por defecto**; si hay más, cuenta el mejor |
| D5 | Visibilidad de los retos | Solo con enlace o código · también públicos cerca | **Con enlace o código por defecto**, y la opción de público cerca |
| D6 | Puntos por defecto | Los del §5.5 u otros | **Los del §5.5** (100 por punto, 50 por pregunta, 10 por minuto, tope del 30 %) |
| D7 | Las rutas en modo reto de la v1 | Pasan a «ruta en orden» en Explorar · se borran · se quedan como están | **Ruta en orden** en Explorar, con «Convertir en reto» para su dueño con cuenta |
| D8 | Al borrar la cuenta | Borrar todo · anonimizar los resultados en retos ajenos · borrado en dos pasos (30 días para arrepentirse) | **Anonimizar en retos ajenos y borrar todo lo demás al momento**; el arrepentimiento, solo con la exportación previa |
| D9 | Responsable y contacto de privacidad | Nombre o marca, y un correo dedicado | Lo decide el responsable del proyecto (por ejemplo, un correo `privacidad@` en su dominio) |
| D10 | Proveedor de correo | Uno con servidores en la UE u otro con garantías de transferencia | **Uno con servidores en la UE** |
| D11 | ¿Mis rutas en la cuenta? | Sí, sincronizadas entre dispositivos · no, solo en el dispositivo | **Sí**, ofreciéndolo al entrar |
| D12 | Avatar | Generado a partir del apodo · subir foto | **Generado**: sin fotos de caras que moderar |
| D13 | Retos por equipos | En la v2 · más adelante | **Más adelante** (§15) |
| D14 | Cambiar el apodo | Libre · una vez cada 30 días | **Una vez cada 30 días** |

## 15. Fuera del alcance de la versión 2

- Premios, sorteos y pagos.
- Clasificaciones globales o por ciudad, niveles y rachas.
- Retos por equipos.
- La app nativa (Capacitor): avisos de llegada con la pantalla apagada y detección de GPS falso. Será la base de una versión siguiente.
- Iniciar sesión con Apple (con la app nativa) y llaves de acceso.
- Chat o comentarios entre participantes.
- Lo que la v1 dejó pendiente y no es de retos: compartir rutas privadas por enlace, traducir fichas, mapas sin conexión, GPX y el panel de analytics ([PROJECT_PLAN](PROJECT_PLAN.md) §16, fase 8).

## 16. Glosario

- **Anfitrión:** la cuenta que crea un reto y ve su clasificación completa.
- **Intento:** una partida de un participante en un reto, con inicio y fin del servidor.
- **Punto de control:** un punto de la ruta de un reto.
- **Puntos Rumbo:** la suma de los mejores intentos válidos de una cuenta.
- **En revisión:** un intento que las reglas antitrampas marcaron y que el anfitrión debe validar o anular.
- **Ruta en orden:** una ruta de Explorar con los puntos en orden y tiempo, sin clasificación (lo que eran las rutas de reto de la v1, según D7).
